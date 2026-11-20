#!/usr/bin/env node
/**
 * migration-gate - the pre-promotion gate that actually tests the database.
 *
 *   npm run gate:migrations           # the full four-step sequence
 *   npm run gate:migrations -- --list # step 3's extraction only (no Docker, no network)
 *
 * WHY THIS EXISTS (read before weakening any step)
 * ------------------------------------------------
 * It replaces `.github/workflows/staging-sync.yml` + release.mjs's "staging" gate,
 * deleted 2026-08-06. That pair never validated anything on any commit: `STAGING_DB_URL`
 * was never set, so the workflow took its "Skip when staging is not configured yet"
 * branch on every run — checkout, migrate and seed were all skipped and the job still
 * reported green. Its entire green history was decoration, it was named as evidence in a
 * pre-release recommendation that had to be withdrawn mid-release, and because
 * `lane:ship`'s trunk guard reads the newest dev run across ALL workflows, its outage
 * failures also blocked shipping lanes that had nothing to do with it.
 *
 * There is NO staging tier and none is planned (docs/release-gates.md). Prod is the first
 * real database any migration meets. So the gate does not pretend to be a pre-prod
 * environment — it asserts four things that can be checked without one:
 *
 *   1. CLEAN APPLY FROM ZERO   `supabase db reset` + `npm run test:db`
 *      Migrations reach prod via MCP under APPLY-time stamps, so prod's history is not
 *      the repo's filename order. A migration set that only works in the order prod
 *      happened to apply it is broken for every fresh replay (CI, a new machine, any
 *      future restore) and has silently shipped twice — 2026-07-26 and 2026-08-05.
 *      This is the only step that runs the files in the order the repo declares.
 *
 *   2. BACKUP FRESHNESS        `node scripts/db-preflight.mjs`
 *      The destructive-migration backup gate. Unchanged; it just moved inside this
 *      sequence so the four steps are contiguous and are run as one unit.
 *
 *   3. LIVE-OBJECT PROBE       every object the release-set migrations touch, in prod
 *      A migration file is a claim about prod's schema. This checks the claim against
 *      pg_catalog: for a migration prod HAS applied, every object it creates must exist
 *      (a miss is a block); for one prod has not, the objects are listed as the apply
 *      set, because promoting code that reads an object prod lacks is the failure mode
 *      that has no staging tier to catch it.
 *
 *   4. SECURITY ADVISORS AFTER APPLY   advisors/security vs docs/security/advisor-baseline.json
 *      Run AFTER the applies that have already happened, which is the only time it can
 *      see what they did. On 2026-08-06 this caught six real WARNs that every other gate
 *      in the repo — including the staging job reporting green — missed entirely.
 *
 * THERE IS NO BYPASS ENV VAR, deliberately. `SKIP_STAGING_GATE` existed because the
 * thing it skipped was not a real check. Every step here is; a red step is a finding.
 *
 * Env: SUPABASE_ACCESS_TOKEN (steps 3+4; a Supabase personal access token),
 *      DC_SUPABASE_PROD_REF (default abcdefghijklmnopqrst),
 *      DC_MIGRATION_GATE_BASE (release base, default origin/main).
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadLedgerMap, mappedApplied } from './lib/ledger-map.mjs';

const LEDGER = loadLedgerMap();   // asserted file ↔ prod-row map, see scripts/lib/ledger-map.mjs
import {
  pendingMigrationFiles,
  stripSqlComments,
  listMigrationFiles,
  migrationVersion,
} from './lib/migrations.mjs';

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const say = (s = '') => console.log(s);
const REF = process.env.DC_SUPABASE_PROD_REF || 'abcdefghijklmnopqrst';
const BASE = process.env.DC_MIGRATION_GATE_BASE || undefined;
const LIST_ONLY = process.argv.includes('--list');
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_PAT;

const failures = [];
const fail = (step, why) => { failures.push({ step, why }); say(`  ${C.r}${C.b}✗ ${why}${C.x}`); };

// ── SQL parsing ─────────────────────────────────────────────────────────────
// Split on `;` at dollar-quote depth 0. A function body is full of semicolons and
// routinely contains the very keywords below (`drop table` inside a trigger body is
// real DDL at call time, but it is NOT this file creating an object), so a naive
// split would both mis-slice statements and invent objects that no migration declares.
function splitStatements(sql) {
  const out = [];
  let start = 0;
  let tag = null;
  for (let i = 0; i < sql.length; i++) {
    if (tag) {
      if (sql.startsWith(tag, i)) { i += tag.length - 1; tag = null; }
      continue;
    }
    const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i, i + 64));
    if (m) { tag = m[0]; i += tag.length - 1; continue; }
    if (sql[i] === ';') { out.push(sql.slice(start, i)); start = i + 1; }
  }
  out.push(sql.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

const ID = String.raw`(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const QNAME = String.raw`(?:(${ID})\s*\.\s*)?(${ID})`;
const unquote = (s) => (s || '').replace(/^"(.*)"$/, '$1');
/** -> { schema, name } with `public` as the default schema. */
const qual = (schema, name) => ({ schema: unquote(schema) || 'public', name: unquote(name) });

/**
 * Objects one migration file declares, in statement order.
 * -> [{ kind, schema, name, table?, present }]  — `present` is what prod should look
 * like AFTER this statement: true for a create, false for a drop. Later statements
 * (and later files) overwrite earlier ones, which is what makes the ubiquitous
 * `DROP TRIGGER IF EXISTS x; CREATE TRIGGER x` idiom resolve to "should exist".
 */
export function extractObjects(sql) {
  const objects = [];
  const push = (kind, schema, name, present, table) => {
    const q = qual(schema, name);
    if (!q.name || /[$]/.test(q.name)) return;   // parameterized / generated names: not probeable
    objects.push({ kind, schema: q.schema, name: q.name, table, present });
  };
  const re = (p, flags = 'i') => new RegExp(p, flags);

  for (const stmt of splitStatements(stripSqlComments(sql))) {
    let m;
    if ((m = re(String.raw`^create\s+table\s+(?:if\s+not\s+exists\s+)?${QNAME}`).exec(stmt))) push('table', m[1], m[2], true);
    else if ((m = re(String.raw`^drop\s+table\s+(?:if\s+exists\s+)?${QNAME}`).exec(stmt))) push('table', m[1], m[2], false);
    else if ((m = re(String.raw`^create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?${QNAME}`).exec(stmt))) push('view', m[1], m[2], true);
    else if ((m = re(String.raw`^drop\s+(?:materialized\s+)?view\s+(?:if\s+exists\s+)?${QNAME}`).exec(stmt))) push('view', m[1], m[2], false);
    else if ((m = re(String.raw`^create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+${QNAME}\s*\(`).exec(stmt))) push('function', m[1], m[2], true);
    else if ((m = re(String.raw`^drop\s+(?:function|procedure)\s+(?:if\s+exists\s+)?${QNAME}`).exec(stmt))) push('function', m[1], m[2], false);
    else if ((m = re(String.raw`^create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?(${ID})\s+on\s+${QNAME}`).exec(stmt))) push('index', m[2], m[1], true);
    else if ((m = re(String.raw`^drop\s+index\s+(?:concurrently\s+)?(?:if\s+exists\s+)?${QNAME}`).exec(stmt))) push('index', m[1], m[2], false);
    else if ((m = re(String.raw`^create\s+(?:or\s+replace\s+)?trigger\s+(${ID})[\s\S]*?\son\s+${QNAME}`).exec(stmt))) push('trigger', m[2], m[1], true, unquote(m[3]));
    else if ((m = re(String.raw`^drop\s+trigger\s+(?:if\s+exists\s+)?(${ID})\s+on\s+${QNAME}`).exec(stmt))) push('trigger', m[2], m[1], false, unquote(m[3]));
    else if ((m = re(String.raw`^create\s+policy\s+(${ID})\s+on\s+${QNAME}`).exec(stmt))) push('policy', m[2], m[1], true, unquote(m[3]));
    else if ((m = re(String.raw`^drop\s+policy\s+(?:if\s+exists\s+)?(${ID})\s+on\s+${QNAME}`).exec(stmt))) push('policy', m[2], m[1], false, unquote(m[3]));
    else if ((m = re(String.raw`^create\s+type\s+${QNAME}`).exec(stmt))) push('type', m[1], m[2], true);
    else if ((m = re(String.raw`^drop\s+type\s+(?:if\s+exists\s+)?${QNAME}`).exec(stmt))) push('type', m[1], m[2], false);
    else if ((m = re(String.raw`^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${QNAME}([\s\S]*)$`).exec(stmt))) {
      const t = qual(m[1], m[2]);
      const rest = m[3] || '';
      for (const c of rest.matchAll(re(String.raw`\badd\s+column\s+(?:if\s+not\s+exists\s+)?(${ID})`, 'gi'))) push('column', t.schema, unquote(c[1]), true, t.name);
      for (const c of rest.matchAll(re(String.raw`\bdrop\s+column\s+(?:if\s+exists\s+)?(${ID})`, 'gi'))) push('column', t.schema, unquote(c[1]), false, t.name);
      for (const c of rest.matchAll(re(String.raw`\badd\s+constraint\s+(${ID})`, 'gi'))) push('constraint', t.schema, unquote(c[1]), true, t.name);
      for (const c of rest.matchAll(re(String.raw`\bdrop\s+constraint\s+(?:if\s+exists\s+)?(${ID})`, 'gi'))) push('constraint', t.schema, unquote(c[1]), false, t.name);
      // RENAME CONSTRAINT old TO new — the closing half of the add-validate-drop-rename
      // swap that is MANDATORY for widening a CHECK (never DROP-then-ADD as two bare
      // statements: if the ADD fails the DROP may already have committed, leaving the
      // table with no CHECK at all). Without this case the probe sees only the ADD of
      // `x_new` and the DROP of `x`, and reports prod wrong in BOTH directions at once:
      // `x_new` MISSING (it was renamed away) and `x` STILL PRESENT (it is the rename's
      // target). That is exactly what step 3 reported on 2026-08-07 against
      // 20260916000000_moderation_actions_automated_image_screen.sql, whose end state was
      // correct and convalidated in prod. A gate that fails a migration for obeying a
      // standing rule teaches people to route around the gate.
      for (const c of rest.matchAll(re(String.raw`\brename\s+constraint\s+(${ID})\s+to\s+(${ID})`, 'gi'))) {
        push('constraint', t.schema, unquote(c[1]), false, t.name);
        push('constraint', t.schema, unquote(c[2]), true, t.name);
      }
    }
  }
  return objects;
}

// ── pairing: `-- requires: <migration>.sql` (BA-08) ─────────────────────────
// A migration header may declare that the file must never be applied unless the named
// migration is already applied in prod OR is part of the same apply set. The
// 20260910000000 → 20260911000000 marketplace-view pair had exactly that dependency and
// carried it only as prose; a selective apply of the first alone would have republished
// surnames to anonymous visitors. The declaration is a comment on purpose (the file stays
// valid SQL everywhere) and is enforced here, before any apply step runs. Same regex shape
// as the RLS coverage gate's `-- covers:`; one migration per line, repeatable.
const REQUIRES_LINE = /^[ \t]*--[ \t]*requires:[ \t]*(\S+\.sql)[ \t]*$/gim;
export function extractRequires(sql) {
  const out = [];
  for (const m of String(sql).matchAll(REQUIRES_LINE)) out.push(m[1]);
  return out;
}

/**
 * Pure decision: given the pending files (basename + sql) and prod's applied set (or null
 * when unverifiable), return every unmet `requires`. A requirement is met when its target
 * is in the same pending set, or when prod already applied it (version / basename /
 * descriptive-name match — the same three-way rule isApplied uses, passed in as `isAppliedFn`
 * so the decision can be unit-tested without a network).
 */
export function checkRequires(pending, isAppliedFn) {
  const inSet = new Set(pending.map((p) => basename(p.file)));
  const unmet = [];
  for (const p of pending) {
    for (const req of extractRequires(p.sql)) {
      if (inSet.has(req)) continue;
      const applied = isAppliedFn(req);
      if (applied === true) continue;
      unmet.push({
        file: basename(p.file),
        requires: req,
        reason: applied === null
          ? 'not in this apply set, and prod\'s applied set is unverifiable'
          : 'not in this apply set and not applied in prod',
      });
    }
  }
  return unmet;
}

const objId = (o) => `${o.kind}:${o.schema}.${o.table ? `${o.table}.` : ''}${o.name}`;
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** The catalog predicate that answers "is this object in the live database?". */
function existsSql(o) {
  const s = lit(o.schema), n = lit(o.name), t = lit(o.table || '');
  switch (o.kind) {
    case 'table':
      return `exists(select 1 from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname=${s} and c.relname=${n} and c.relkind in ('r','p','f'))`;
    case 'view':
      return `exists(select 1 from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname=${s} and c.relname=${n} and c.relkind in ('v','m'))`;
    case 'index':
      return `exists(select 1 from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname=${s} and c.relname=${n} and c.relkind in ('i','I'))`;
    case 'function':
      return `exists(select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname=${s} and p.proname=${n})`;
    case 'trigger':
      return `exists(select 1 from pg_trigger tg join pg_class c on c.oid=tg.tgrelid join pg_namespace ns on ns.oid=c.relnamespace where not tg.tgisinternal and tg.tgname=${n} and c.relname=${t} and ns.nspname=${s})`;
    case 'policy':
      return `exists(select 1 from pg_policies where schemaname=${s} and tablename=${t} and policyname=${n})`;
    case 'column':
      return `exists(select 1 from information_schema.columns where table_schema=${s} and table_name=${t} and column_name=${n})`;
    case 'constraint':
      return `exists(select 1 from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace ns on ns.oid=c.relnamespace where con.conname=${n} and c.relname=${t} and ns.nspname=${s})`;
    case 'type':
      return `exists(select 1 from pg_type ty join pg_namespace ns on ns.oid=ty.typnamespace where ns.nspname=${s} and ty.typname=${n})`;
    default:
      return 'null';
  }
}

// ── Supabase Management API (read-only here) ────────────────────────────────
async function mgmt(path, init) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/**
 * Run one SELECT against prod. This gate NEVER writes: the guard below is not a
 * formality, it is the only thing standing between a typo in a probe builder and a
 * statement executed on the production database.
 */
async function query(sql) {
  if (!/^\s*select\b/i.test(sql)) throw new Error('migration-gate only ever runs SELECT');
  return mgmt('/database/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
}

/** Versions + descriptive names prod has applied, or null when unverifiable. */
async function appliedSet() {
  if (!TOKEN) return null;
  try {
    const json = await mgmt('/database/migrations');
    const rows = Array.isArray(json) ? json : (json.migrations || []);
    return {
      versions: new Set(rows.map((r) => String(r.version)).filter(Boolean)),
      names: new Set(rows.map((r) => r.name).filter(Boolean)),
    };
  } catch (e) {
    say(`  ${C.y}applied-set unverifiable: ${String(e.message || e)}${C.x}`);
    return null;
  }
}

/**
 * Has prod applied this file? Version match, full-basename match, or DESCRIPTIVE-name
 * match — the third because a migration applied through the MCP is stamped with prod's
 * apply-time version, so its repo filename matches neither of the first two. Here (unlike
 * db-preflight, where a name hit must never mark a destructive file "applied") the
 * consequence of a name hit is that we EXPECT its objects to exist and report a miss, so
 * the cautious direction is to include it.
 */
function isApplied(file, applied) {
  if (!applied) return null;
  const base = basename(file).replace(/\.sql$/, '');
  return applied.versions.has(migrationVersion(file))
    || applied.names.has(base)
    || applied.names.has(base.replace(/^\d{14}_/, ''))
    || mappedApplied(file, applied, LEDGER);   // asserted mapping, honoured while prod holds the version
}

// ── steps ───────────────────────────────────────────────────────────────────
function header(n, title) {
  say('');
  say(`${C.b}STEP ${n}/4  ${title}${C.x}`);
}

function stepRequires(files, applied) {
  say('');
  say(`${C.b}STEP 0/4  pairing  (every \`-- requires:\` in the release set is satisfied)${C.x}`);
  const pending = [];
  for (const f of files) {
    try { pending.push({ file: f, sql: readFileSync(f, 'utf8') }); } catch { /* listed-but-unreadable files are step 1's problem */ }
  }
  const unmet = checkRequires(pending, (req) => isApplied(req, applied));
  if (!unmet.length) {
    say(`  ${C.g}✓ ${pending.filter((p) => extractRequires(p.sql).length).length} migration(s) declare a requirement; all satisfied.${C.x}`);
    return;
  }
  for (const u of unmet) say(`  ${C.r}${u.file} requires ${u.requires} — ${u.reason}${C.x}`);
  fail(0, `${unmet.length} migration(s) would be applied without the migration they declare they require. Apply them together, in filename order, or not at all.`);
}

function stepCleanApply(files) {
  header(1, 'clean apply from zero  (supabase db reset + npm run test:db)');
  if (!files.length) {
    say(`  ${C.d}no migration in the release set — nothing to replay.${C.x}`);
    return;
  }
  say(`  ${C.d}${files.length} migration(s) in this release set; replaying the FULL set in filename order.${C.x}`);
  say(`  ${C.y}this resets the LOCAL Supabase stack (127.0.0.1:54322) — local data is discarded.${C.x}`);

  // Refuse before touching anything if ANOTHER worktree's stack holds the local ports.
  // `supabase db reset` would otherwise fail on a port bind and read as "the migrations are
  // broken", and a lane agent mid-verification would have had its database pulled out from
  // under it. Release from a quiet repo, or stop that stack first — deliberately not
  // automated: whose stack it is, is a question for a human.
  const project = (() => {
    try { return /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync('supabase/config.toml', 'utf8'))?.[1] || ''; }
    catch { return ''; }
  })();
  const foreign = (() => {
    try {
      return execSync("docker ps --format '{{.Names}}'", { encoding: 'utf8' })
        .split('\n').map((s) => s.trim()).filter((n) => n.startsWith('supabase_db_'))
        .map((n) => n.slice('supabase_db_'.length))
        .filter((p) => p && p !== project);
    } catch { return []; }
  })();
  if (foreign.length) {
    fail(1, `another worktree's Supabase stack is running (${foreign.join(', ')}) and holds the local ports. `
      + `Stop it (cd to that worktree, npx supabase stop) or release from a quiet repo — this step will not reset someone else's database.`);
    return;
  }

  try {
    execSync('npx supabase db reset', { stdio: 'inherit' });
  } catch {
    fail(1, 'supabase db reset failed — the migration set does not apply cleanly from zero, or the local stack is down (npx supabase start; Docker must be running).');
    return;
  }
  try {
    execSync('npm run --silent test:db', { stdio: 'inherit' });
  } catch {
    fail(1, 'npm run test:db failed against the freshly reset schema — a DB probe is red.');
    return;
  }
  say(`  ${C.g}✓ every migration applies from an empty database, and the DB probes pass on the result.${C.x}`);
}

function stepPreflight() {
  header(2, 'backup freshness  (npm run db:preflight)');
  try {
    execSync('node scripts/db-preflight.mjs', { stdio: 'inherit' });
    say(`  ${C.g}✓ preflight pass.${C.x}`);
  } catch {
    fail(2, 'db:preflight failed — a pending destructive migration has no verified fresh backup. Read its output above.');
  }
}

async function stepProbe(files, applied) {
  header(3, 'live-object probe  (every object these migrations touch, checked in prod)');
  if (!files.length) {
    say(`  ${C.d}no migration in the release set — nothing to probe.${C.x}`);
    return;
  }

  // Later statements win, across files in filename order: a file that drops what an
  // earlier one created must not leave a "should exist" expectation behind.
  const expected = new Map();
  const owner = new Map();
  for (const f of files) {
    let sql;
    try { sql = readFileSync(f, 'utf8'); } catch { continue; }
    for (const o of extractObjects(sql)) { expected.set(objId(o), o); owner.set(objId(o), f); }
  }
  const objects = [...expected.values()];
  say(`  ${C.d}${objects.length} object(s) declared across ${files.length} migration file(s).${C.x}`);
  if (LIST_ONLY) {
    for (const o of objects) say(`    ${o.present ? '+' : '-'} ${objId(o)}   ${C.d}${owner.get(objId(o))}${C.x}`);
    return;
  }
  if (!objects.length) return;
  if (!TOKEN) {
    fail(3, 'SUPABASE_ACCESS_TOKEN is not set, so prod could not be probed. Export a token (supabase.com/dashboard/account/tokens) and re-run — an unprobed release is not a probed one.');
    return;
  }

  let rows;
  try {
    rows = await query(objects.map((o) => `select ${lit(objId(o))} as id, ${existsSql(o)} as present`).join('\nunion all\n'));
  } catch (e) {
    fail(3, `prod probe could not run: ${String(e.message || e)}`);
    return;
  }
  const live = new Map(rows.map((r) => [r.id, r.present === true || r.present === 't']));

  const missing = [];   // applied migration, object absent -> block
  const pending = [];   // unapplied migration -> the apply set, reported
  const stale = [];     // applied migration, dropped object still present -> block
  for (const o of objects) {
    const id = objId(o);
    const file = owner.get(id);
    const inProd = live.get(id);
    const app = isApplied(file, applied);
    if (app === null) continue;
    if (!app) { pending.push({ id, file, inProd }); continue; }
    if (o.present && !inProd) missing.push({ id, file });
    if (!o.present && inProd) stale.push({ id, file });
  }

  const byFile = (list) => {
    const m = new Map();
    for (const e of list) m.set(e.file, [...(m.get(e.file) || []), e.id]);
    return m;
  };

  if (missing.length) {
    say('');
    say(`  ${C.r}${C.b}MISSING IN PROD (${missing.length}) — prod records this migration as applied, but the object is not there:${C.x}`);
    for (const [f, ids] of byFile(missing)) { say(`    ${C.r}${f}${C.x}`); for (const id of ids) say(`      · ${id}`); }
  }
  if (stale.length) {
    say('');
    say(`  ${C.r}${C.b}STILL PRESENT IN PROD (${stale.length}) — this migration drops the object and prod still has it:${C.x}`);
    for (const [f, ids] of byFile(stale)) { say(`    ${C.r}${f}${C.x}`); for (const id of ids) say(`      · ${id}`); }
  }
  if (pending.length) {
    say('');
    say(`  ${C.y}${C.b}NOT YET IN PROD (${pending.length} object(s)) — the apply set for this release:${C.x}`);
    for (const [f, ids] of byFile(pending)) {
      say(`    ${C.y}${f}${C.x}`);
      for (const id of ids) say(`      · ${id}`);
    }
    say(`  ${C.d}prod is the first real database these meet — apply them with apply_migration (never db push),${C.x}`);
    say(`  ${C.d}then re-run this gate so step 3 confirms they landed and step 4 sees what they did.${C.x}`);
  }
  if (missing.length || stale.length) {
    fail(3, `${missing.length + stale.length} object(s) disagree with prod. Either the migration did not fully apply, or prod's applied-set names a migration whose file has since changed. Resolve before promoting.`);
  } else {
    say(`  ${C.g}✓ every object of every applied migration in this set is live in prod as declared.${C.x}`);
  }
}

function stepAdvisors() {
  header(4, 'security advisors after applying  (vs docs/security/advisor-baseline.json)');
  if (!TOKEN) {
    fail(4, 'SUPABASE_ACCESS_TOKEN is not set, so prod security advisors could not be read. This is the step that caught six real WARNs on 2026-08-06; skipping it silently is what the deleted staging job did.');
    return;
  }
  try {
    execSync('node .github/scripts/advisor-check.mjs', {
      stdio: 'inherit',
      env: { ...process.env, ADVISOR_TYPES: 'security', FAIL_ON_NEW: '1', OUT: process.env.OUT || '/tmp/advisor-release-gate.json' },
    });
    say(`  ${C.g}✓ no security advisor outside the committed baseline.${C.x}`);
  } catch {
    fail(4, 'prod has security advisor findings that are NOT in docs/security/advisor-baseline.json (listed above). Fix them, or record each one in the baseline with a reason — that is a reviewed, committed decision, not a bypass.');
  }
}

// ── run ─────────────────────────────────────────────────────────────────────
// Guarded so the module can be imported. `extractObjects` is exported and is the part
// most worth unit-testing (its statement-order "later wins" rule is subtle and got the
// RENAME CONSTRAINT case wrong until 2026-08-07), but before this guard any import ran
// the whole gate and called process.exit — so the export was unusable in practice.
// `node scripts/migration-gate.mjs` still satisfies this, so npm run gate:migrations
// is unchanged.
const INVOKED_DIRECTLY = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (INVOKED_DIRECTLY) await (async () => {
  say(`${C.b}migration gate${C.x}  ${C.d}prod ref ${REF}${C.x}`);
  const { base, files } = pendingMigrationFiles(BASE);
  say(`${C.d}release set: migrations not on ${base || '(no release base)'} — ${files.length} file(s).${C.x}`);
  for (const f of files) say(`  ${C.d}· ${f}${C.x}`);

  const applied = LIST_ONLY ? null : await appliedSet();
  if (!LIST_ONLY && !applied && files.length) {
    say(`  ${C.y}prod's applied set is unverifiable — step 3 cannot judge any file.${C.x}`);
  }

  if (LIST_ONLY) {
    await stepProbe(files, null);
    process.exit(0);
  }

  stepRequires(files, applied);
  stepCleanApply(files);
  stepPreflight();
  await stepProbe(files, applied);
  stepAdvisors();

  say('');
  if (failures.length) {
    say(`${C.r}${C.b}✗ MIGRATION GATE FAILED — ${failures.length} step(s):${C.x}`);
    for (const f of failures) say(`  ${C.r}step ${f.step}${C.x}  ${f.why}`);
    say('');
    say(`${C.d}There is no bypass flag. A red step here is a finding about prod, not friction.${C.x}`);
    process.exit(1);
  }
  say(`${C.g}${C.b}✓ MIGRATION GATE PASSED${C.x} — clean replay, backup verified, prod objects match, no new security advisor.`);
  say(`${C.d}Total migration files in repo: ${listMigrationFiles().length}.${C.x}`);
  process.exit(0);
})();
