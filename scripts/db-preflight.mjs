#!/usr/bin/env node
/**
 * db-preflight - the gate that stands between an agent and a destructive prod migration.
 *
 *   npm run db:preflight            # report + decide; NEVER applies anything
 *
 * Why this exists: nothing stopped an agent from applying a `drop column` / `truncate`
 * to prod on the strength of a verbal "backup's confirmed, go ahead." A verbal
 * confirmation is not evidence. This gate takes the backup timestamp from the Supabase
 * Management API — or it refuses. The rule (also in CLAUDE.md + the supabase-backend
 * rule): the timestamp comes from the API, or the work stops.
 *
 * "Pending" = a migration the PROD DATABASE hasn't applied yet, from two sources:
 *   1. git — not on the release base (origin/main) yet, and
 *   2. prod DB — committed (even on main) but absent from the Management API's applied set.
 *   Source 2 is why a migration like drop_university_resources, which rode along on main
 *   but was never run against prod, is still gated: git alone would call it "not pending."
 *
 * Decision:
 *   - No pending migration is destructive        -> PASS (nothing dangerous to gate).
 *   - A pending migration IS destructive, and:
 *       · newest verified backup ≤ 24h old       -> PASS (proceed with care).
 *       · newest backup > 24h old                -> EXIT 1.
 *       · backup status can't be determined      -> EXIT 1 (fail closed — never guess).
 *
 * It reports only. It has no code path that applies, resets, or restores anything.
 *
 * Backup source:  GET https://api.supabase.com/v1/projects/<ref>/database/backups
 * Applied source: GET https://api.supabase.com/v1/projects/<ref>/database/migrations
 *   Both need a personal access token in SUPABASE_ACCESS_TOKEN (or SUPABASE_PAT). Without it,
 *   backup status is "undeterminable" and any git-pending destructive apply is refused. The
 *   prod-applied cross-check also needs the token; when it can't run, the gate says so loudly
 *   (committed-but-unapplied destructive migrations go unchecked) rather than passing silently.
 *
 * Config (env): DC_SUPABASE_PROD_REF (default abcdefghijklmnopqrst),
 *   DC_PREFLIGHT_MAX_BACKUP_AGE_H (default 24), DC_PREFLIGHT_BASE (release base ref).
 * Test-only (DC_PREFLIGHT_TEST=1, prints a loud banner — a test run is NEVER a real gate):
 *   DC_PREFLIGHT_FAKE_BACKUP  = "none" | "<hoursAgo>"          (inject a backup age),
 *   DC_PREFLIGHT_FAKE_APPLIED = "error" | "<v1>,<v2>,..."      (inject the prod-applied version set).
 */
import { scanPendingDestructive, scanFiles, listMigrationFiles, unappliedMigrationFiles, nameMatched } from './lib/migrations.mjs';
import { LEDGER_MAP_PATH, loadLedgerMap, mappedApplied } from './lib/ledger-map.mjs';

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const say = (s = '') => console.log(s);
const REF = process.env.DC_SUPABASE_PROD_REF || 'abcdefghijklmnopqrst';
const MAX_AGE_MS = (Number(process.env.DC_PREFLIGHT_MAX_BACKUP_AGE_H) || 24) * 3600_000;
const TEST = process.env.DC_PREFLIGHT_TEST === '1';
const argBase = (() => { const i = process.argv.indexOf('--base'); return i > -1 ? process.argv[i + 1] : undefined; })();
const BASE = argBase || process.env.DC_PREFLIGHT_BASE || undefined;

const ageStr = (ms) => { const h = ms / 3600_000; return h < 1 ? `${Math.round(h * 60)}m` : `${h.toFixed(1)}h`; };

/**
 * Newest verified backup for the prod project.
 * -> { ts: Date|null, source, detail, error }.  ts=null means "could not determine".
 */
async function latestBackup() {
  if (TEST && process.env.DC_PREFLIGHT_FAKE_BACKUP !== undefined) {
    const v = process.env.DC_PREFLIGHT_FAKE_BACKUP;
    if (v === 'none') return { ts: null, source: 'TEST', detail: 'injected: undeterminable', error: 'injected none' };
    const hrs = Number(v);
    if (Number.isNaN(hrs)) return { ts: null, source: 'TEST', detail: `bad DC_PREFLIGHT_FAKE_BACKUP=${v}`, error: 'bad inject' };
    return { ts: new Date(Date.now() - hrs * 3600_000), source: 'TEST', detail: `injected ${hrs}h old`, error: null };
  }

  const token = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_PAT;
  if (!token) return { ts: null, source: 'api', detail: 'no SUPABASE_ACCESS_TOKEN in env', error: 'no-token' };

  const url = `https://api.supabase.com/v1/projects/${REF}/database/backups`;
  let res, json;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  } catch (e) {
    return { ts: null, source: 'api', detail: `request failed: ${String(e.message || e)}`, error: 'fetch' };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ts: null, source: 'api', detail: `HTTP ${res.status} ${res.statusText} ${body.slice(0, 160)}`, error: `http-${res.status}` };
  }
  try { json = await res.json(); } catch { return { ts: null, source: 'api', detail: 'unparseable JSON', error: 'parse' }; }

  // Candidate timestamps: completed logical/physical backups + newest physical/PITR marker.
  const cands = [];
  for (const b of json.backups || []) {
    const ok = !b.status || /complete|available|done/i.test(String(b.status));
    if (ok && b.inserted_at) cands.push(new Date(b.inserted_at));
  }
  const pd = json.physical_backup_data || {};
  const unix = pd.latest_physical_backup_date_unix ?? pd.latest_physical_backup_date;
  if (unix) cands.push(new Date(Number(unix) * 1000));

  const valid = cands.filter((d) => d instanceof Date && !Number.isNaN(d.getTime()));
  if (!valid.length) {
    const pitr = json.pitr_enabled ? ' (PITR enabled but no timestamp returned)' : '';
    return { ts: null, source: 'api', detail: `no completed backup timestamp in API response${pitr}`, error: 'no-backup' };
  }
  const ts = new Date(Math.max(...valid.map((d) => d.getTime())));
  return { ts, source: 'api', detail: `${valid.length} backup timestamp(s), newest ${ts.toISOString()}${json.pitr_enabled ? ', PITR on' : ''}`, error: null };
}

/**
 * The set of migration versions the PROD database has already applied.
 * -> { versions: string[]|null, names: string[], detail, error }.
 * versions=null means "could not determine" (no token / API error) — the caller must
 * then say the prod-applied cross-check didn't run, never silently treat main as applied.
 */
async function appliedSet() {
  if (TEST && process.env.DC_PREFLIGHT_FAKE_APPLIED !== undefined) {
    const v = process.env.DC_PREFLIGHT_FAKE_APPLIED;
    if (v === 'error') return { versions: null, names: [], detail: 'injected: undeterminable', error: 'injected error' };
    const versions = v.split(',').map((s) => s.trim()).filter(Boolean);
    return { versions, names: [], detail: `injected ${versions.length} applied version(s)`, error: null };
  }

  const token = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_PAT;
  if (!token) return { versions: null, names: [], detail: 'no SUPABASE_ACCESS_TOKEN in env', error: 'no-token' };

  const url = `https://api.supabase.com/v1/projects/${REF}/database/migrations`;
  let res, json;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  } catch (e) {
    return { versions: null, names: [], detail: `request failed: ${String(e.message || e)}`, error: 'fetch' };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { versions: null, names: [], detail: `HTTP ${res.status} ${res.statusText} ${body.slice(0, 160)}`, error: `http-${res.status}` };
  }
  try { json = await res.json(); } catch { return { versions: null, names: [], detail: 'unparseable JSON', error: 'parse' }; }

  const rows = Array.isArray(json) ? json : (json.migrations || []);
  const versions = rows.map((r) => String(r.version)).filter(Boolean);
  const names = rows.map((r) => r.name).filter(Boolean);
  if (!versions.length) return { versions: null, names: [], detail: 'no applied migrations in API response', error: 'empty' };
  return { versions, names, detail: `${versions.length} applied, newest ${versions[versions.length - 1]}`, error: null };
}

function fail(lines) {
  say('');
  say(`${C.r}${C.b}✗ PREFLIGHT FAILED — do NOT apply any migration to prod.${C.x}`);
  for (const l of lines) say(`  ${l}`);
  say('');
  process.exit(1);
}

(async () => {
  say(`${C.b}db:preflight${C.x}  prod ref ${C.d}${REF}${C.x}`);
  if (TEST) say(`${C.y}${C.b}  ⚠ TEST MODE — backup input may be injected; this run is NOT a valid preflight.${C.x}`);

  // 1a. Git-pending migrations (not on origin/main yet).
  const { base, files, destructive: gitDestructive } = scanPendingDestructive(BASE);
  say('');
  say(`${C.b}Git-pending migrations${C.x}  ${C.d}(vs ${base || 'no release base found — worktree only'})${C.x}`);
  if (!files.length) say(`  ${C.d}none pending.${C.x}`);
  else for (const f of files) {
    const hit = gitDestructive.find((d) => d.file === f);
    say(`  ${hit ? `${C.r}⚠${C.x}` : `${C.d}·${C.x}`} ${f}`);
  }

  // 1b. Prod-unapplied migrations (committed — even on main — but absent from the prod DB).
  const applied = await appliedSet();
  const ledger = loadLedgerMap();
  const allFiles = listMigrationFiles();
  const prodFiles = applied.versions ? unappliedMigrationFiles(allFiles, applied, ledger) : [];
  const ledgerMapped = applied.versions ? allFiles.filter((f) => mappedApplied(f, applied, ledger)) : [];
  const prodDestructive = applied.versions ? scanFiles(prodFiles) : [];
  say('');
  say(`${C.b}Prod-unapplied migrations${C.x}  ${C.d}(in repo, not yet in the prod DB)${C.x}`);
  if (ledgerMapped.length) say(`  ${C.d}ledger-mapped: ${ledgerMapped.length} file(s) read as applied via ${LEDGER_MAP_PATH} — prod still holds each mapped version.${C.x}`);
  if (!applied.versions) {
    say(`  ${C.y}unverified${C.x}  ${C.d}${applied.detail} — committed-but-unapplied destructive migrations are NOT being checked${C.x}`);
  } else if (!prodFiles.length) {
    say(`  ${C.d}none — every migration file is applied on prod.${C.x}`);
  } else {
    // PRESENTATION ONLY — the gate below still acts on the FULL union (see the
    // `nameMatched` note in scripts/lib/migrations.mjs). A migration applied via
    // the Supabase MCP is stamped with prod's APPLY-time version, so its repo
    // file matches neither prod's version nor prod's full basename and lands in
    // this list every run — a live 2026-07-26 run reported 18 unapplied of which
    // >=13 were provably applied. Splitting on a DESCRIPTIVE-NAME match keeps the
    // short "confirmed" list skimmable without ever removing anything from the
    // gate: over-reporting is safe, burying a real destructive migration is not.
    // Matching on the stripped name ALONE (i.e. treating a name hit as applied)
    // is deliberately NOT done — prod names are not unique (`remote_schema`
    // appears twice), so it would introduce false NEGATIVES.
    const confirmed = prodFiles.filter((f) => !nameMatched(f, applied));
    const unmatched = prodFiles.filter((f) => nameMatched(f, applied));
    const row = (f) => {
      const hit = prodDestructive.find((d) => d.file === f);
      say(`  ${hit ? `${C.r}⚠${C.x}` : `${C.d}·${C.x}`} ${f}`);
    };
    say('');
    say(`  ${C.b}CONFIRMED UNAPPLIED${C.x} ${C.d}(${confirmed.length}) — no migration of this name exists on prod${C.x}`);
    if (!confirmed.length) say(`    ${C.d}none.${C.x}`);
    else for (const f of confirmed) row(f);
    say('');
    say(`  ${C.b}UNMATCHED / POSSIBLY MCP-APPLIED${C.x} ${C.d}(${unmatched.length}) — prod HAS a migration with this descriptive`);
    say(`  ${C.d}name under a different version stamp. Likely already applied; still gated. Confirm with${C.x}`);
    say(`  ${C.d}\`list_migrations\` (match the name, ignore the timestamp) before acting.${C.x}`);
    if (!unmatched.length) say(`    ${C.d}none.${C.x}`);
    else for (const f of unmatched) row(f);
  }

  // Union both sources by file — the gate acts on anything destructive from either.
  const byFile = new Map();
  for (const d of [...gitDestructive, ...prodDestructive]) if (!byFile.has(d.file)) byFile.set(d.file, d);
  const destructive = [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file));

  if (destructive.length) {
    // Same PRESENTATION split as above — every entry here is gated either way.
    // A destructive file that is git-pending, or that prod has no same-named
    // migration for, is the one an agent must actually read; the rest are the
    // MCP-version-stamp phantoms and are penned separately so they can't bury it.
    const gitPendingFiles = new Set(files);
    const isPhantom = (d) => !gitPendingFiles.has(d.file) && nameMatched(d.file, applied);
    const real = destructive.filter((d) => !isPhantom(d));
    const phantom = destructive.filter(isPhantom);
    const block = (d) => {
      say(`  ${C.r}${d.file}${C.x}`);
      for (const h of d.hits) say(`     ${C.y}L${h.line}${C.x} ${C.b}${h.kind}${C.x}  ${C.d}${h.snippet}${C.x}`);
    };
    say('');
    say(`${C.r}${C.b}Destructive statements — ACT ON THESE (${real.length}):${C.x}`);
    if (!real.length) say(`  ${C.d}none in this group.${C.x}`);
    else for (const d of real) block(d);
    if (phantom.length) {
      say('');
      say(`${C.y}${C.b}Destructive statements — unmatched / possibly MCP-applied (${phantom.length}):${C.x}`);
      say(`  ${C.d}prod has a same-named migration under a different version stamp; still gated,${C.x}`);
      say(`  ${C.d}confirm with \`list_migrations\` before treating any of these as pending.${C.x}`);
      for (const d of phantom) block(d);
    }
  }

  // 2. Backup status (from the API — or undeterminable).
  const bk = await latestBackup();
  const age = bk.ts ? Date.now() - bk.ts.getTime() : null;
  say('');
  say(`${C.b}Latest backup${C.x}`);
  if (bk.ts) say(`  ${C.g}${bk.ts.toISOString()}${C.x}  (${ageStr(age)} old)  ${C.d}${bk.detail}${C.x}`);
  else say(`  ${C.y}undeterminable${C.x}  ${C.d}${bk.detail}${C.x}`);

  // 3. Decide.
  if (!destructive.length) {
    say('');
    say(`${C.g}${C.b}✓ PREFLIGHT PASS${C.x} — no destructive statement in any pending migration. Safe to proceed.`);
    say(`  ${C.d}A backup is not gated for non-destructive migrations, but expand/contract still applies.${C.x}`);
    process.exit(0);
  }

  // Destructive present -> a verified fresh backup is mandatory.
  if (!bk.ts) {
    fail([
      `${destructive.length} pending migration(s) contain destructive DDL, and the backup timestamp could not be verified.`,
      `A verbal "backup confirmed" is NOT accepted — the timestamp must come from the Supabase API.`,
      ``,
      `To proceed:`,
      `  1. Set a personal access token so this gate can read backup status:`,
      `       export SUPABASE_ACCESS_TOKEN=<supabase.com/dashboard/account/tokens>`,
      `  2. Re-run: npm run db:preflight`,
      ``,
      `There is NO way to take a backup on demand — the CLI and Management API expose only`,
      `\`backups list\` and \`backups restore\`, and PITR is disabled on this project. If the`,
      `newest backup then turns out to be too old, your only options are to WAIT for the next`,
      `scheduled daily backup (~08:08 UTC) or to enable PITR.`,
      ``,
      `Or split the migration expand/contract so nothing destructive ships this pass.`,
    ]);
  }
  if (age > MAX_AGE_MS) {
    fail([
      `${destructive.length} pending migration(s) are destructive, and the newest backup is ${ageStr(age)} old (limit ${ageStr(MAX_AGE_MS)}).`,
      `You CANNOT take a backup on demand — the Supabase CLI exposes only \`backups list\` and`,
      `\`backups restore\`, the Management API's /database/backups is read-only, and PITR is`,
      `disabled on this project. The only two real remediations are:`,
      `  · WAIT for the next scheduled daily backup (lands ~08:08 UTC), then re-run:`,
      `       npm run db:preflight`,
      `  · or enable PITR (billing decision) so a recovery point always exists.`,
      ``,
      `Or split the migration expand/contract so nothing destructive ships this pass.`,
    ]);
  }

  say('');
  say(`${C.g}${C.b}✓ PREFLIGHT PASS${C.x} — destructive migration is backed by a ${ageStr(age)}-old backup (≤ ${ageStr(MAX_AGE_MS)}).`);
  say(`  ${C.y}Proceed with care:${C.x} apply via apply_migration (never db push), and prefer expand/contract even so.`);
  if (TEST) { say(`  ${C.y}(TEST MODE — re-run without DC_PREFLIGHT_TEST against the real API before trusting this.)${C.x}`); }
  process.exit(0);
})();
