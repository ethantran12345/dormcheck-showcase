/**
 * migrations.mjs - shared detection of PENDING and DESTRUCTIVE Supabase migrations.
 *
 * One source of truth for two consumers so the gate and the reporter can never
 * disagree about what "destructive" means:
 *   - scripts/db-preflight.mjs  (the hard gate: refuses a destructive apply w/o a fresh backup)
 *   - scripts/repo-state.mjs    (the reporter: surfaces pending destructive migrations)
 *
 * "Pending" = migration files that would reach prod but aren't on the release base
 * (origin/main) yet — plus anything uncommitted/untracked in the working tree, since
 * an agent may run the gate before committing. "Destructive" = the DDL that can lose
 * data or drop objects (drop table/column/constraint, truncate, column type change).
 *
 * THE TRAP: the two callers share this predicate but NOT its domain, so a clean result
 * from one is not a clean result from the other.
 *   - repo-state.mjs scans only what is git-pending vs origin/main.
 *   - db-preflight.mjs scans that PLUS `unappliedMigrationFiles()` — migrations already
 *     committed on main but absent from the Management API's applied set.
 * A migration that is merged to origin/main and still unapplied in prod is therefore
 * INVISIBLE to repo-state and caught only by db-preflight. That is why the session:begin
 * banner reports a pending count and never a destructiveness verdict: only the caller
 * that queries prod's applied set can honestly render one.
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';
import { mappedApplied } from './ledger-map.mjs';

const MIGRATIONS_DIR = 'supabase/migrations';

const g = (cmd) => {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
};
const gLines = (cmd) => g(cmd).split('\n').map((s) => s.trim()).filter(Boolean);

// Destructive DDL patterns. Deliberately tight — matches the classes that lose data or
// drop objects, and NOTHING that only adds (so `alter type ... add value`, a non-destructive
// enum extension, must NOT match: that's why the type-change pattern is anchored to
// `alter column ... type`, never bare `alter ... type`).
export const DESTRUCTIVE_PATTERNS = [
  { kind: 'drop table/view/schema/type', re: /\bdrop\s+(table|view|materialized\s+view|schema|type)\b/gi },
  { kind: 'drop column', re: /\bdrop\s+column\b/gi },
  { kind: 'truncate', re: /\btruncate\b/gi },
  { kind: 'drop constraint', re: /\bdrop\s+constraint\b/gi },
  { kind: 'column type change', re: /\balter\s+column\s+\S+\s+(set\s+data\s+)?type\b/gi },
];

/**
 * Blank out SQL comments while PRESERVING every byte offset and line number, so match
 * positions still map to real line numbers. Block/line comments become spaces (newlines
 * kept). We intentionally do NOT blank dollar-quoted function bodies: a trigger/function
 * body that drops a table IS a destructive apply and must still be caught.
 */
export function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/--[^\n]*/g, (m) => ' '.repeat(m.length));
}

/**
 * True if the statement containing `index` is a GRANT or REVOKE.
 *
 * GRANT/REVOKE are privilege DCL, not destructive DDL, but their privilege lists spell
 * out the very keywords this scanner looks for. `REVOKE INSERT, UPDATE, TRUNCATE,
 * REFERENCES, TRIGGER ON public.mfa_backup_codes FROM authenticated` REMOVES the ability
 * to truncate — the safest possible direction — yet a bare /\btruncate\b/ read it as a
 * destructive migration and made db:preflight demand a fresh backup for it (observed
 * 2026-08-02 on 20260901000003_security_backup_code_mint_and_private_views.sql, while the
 * genuinely destructive `drop table ... cascade` in that same batch lived in a different
 * file entirely). A gate that cries wolf is a gate that gets waved through, so these are
 * now skipped.
 *
 * We walk back to the previous statement terminator rather than testing the matched line,
 * because a privilege list is routinely wrapped across lines and the keyword often lands
 * on a line that does not itself contain the word GRANT or REVOKE.
 */
function inGrantOrRevoke(clean, index) {
  const stmtStart = clean.lastIndexOf(';', index) + 1;
  return /^\s*(grant|revoke)\b/i.test(clean.slice(stmtStart, index));
}

/** Scan one SQL string; returns [{ kind, line, snippet }] for every destructive hit. */
export function scanDestructive(sql) {
  const clean = stripSqlComments(sql);
  const hits = [];
  for (const { kind, re } of DESTRUCTIVE_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(clean)) !== null) {
      if (m.index === re.lastIndex) re.lastIndex++; // guard zero-width
      if (inGrantOrRevoke(clean, m.index)) continue;
      const line = clean.slice(0, m.index).split('\n').length;
      const raw = sql.split('\n')[line - 1] || '';
      hits.push({ kind, line, snippet: raw.trim().slice(0, 120) });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

/** Resolve the release base ref (what prod already has). null if none is reachable. */
export function resolveBase(explicit) {
  const candidates = explicit ? [explicit] : ['origin/main', 'main'];
  for (const c of candidates) {
    if (g(`git rev-parse --verify --quiet ${c}^{commit}`)) return c;
  }
  return null;
}

/**
 * The set of migration files that could reach prod but aren't on `base` yet:
 *   committed (base...HEAD)  ∪  uncommitted-vs-HEAD  ∪  untracked.
 * Deletes are excluded (a removed file isn't an apply). Returns absolute-ish repo paths.
 */
export function pendingMigrationFiles(explicitBase) {
  const dir = 'supabase/migrations';
  const base = resolveBase(explicitBase);
  const set = new Set();
  if (base) for (const f of gLines(`git diff --diff-filter=AMR --name-only ${base}...HEAD -- ${dir}`)) set.add(f);
  for (const f of gLines(`git diff --diff-filter=AMR --name-only HEAD -- ${dir}`)) set.add(f);         // staged + unstaged
  for (const f of gLines(`git ls-files --others --exclude-standard -- ${dir}`)) set.add(f);            // untracked
  return { base, files: [...set].filter((f) => f.endsWith('.sql')).sort() };
}

/** Destructive scan over an explicit file list. Returns [{ file, hits:[...] }]. */
export function scanFiles(files) {
  const destructive = [];
  for (const file of files) {
    let sql;
    try { sql = readFileSync(file, 'utf8'); } catch { continue; } // deleted/unreadable in worktree
    const hits = scanDestructive(sql);
    if (hits.length) destructive.push({ file, hits });
  }
  return destructive;
}

/**
 * Scan every git-pending migration for destructive DDL.
 * Returns { base, files:[...], destructive:[{ file, hits:[...] }] }.
 */
export function scanPendingDestructive(explicitBase) {
  const { base, files } = pendingMigrationFiles(explicitBase);
  return { base, files, destructive: scanFiles(files) };
}

// ── Prod-applied detection ──────────────────────────────────────────────────
// Git "pending" (not on origin/main) is NOT the same as "not yet applied to the
// prod database": a migration can be committed to main yet never run against prod
// (e.g. drop_university_resources rode along on main but is unapplied). The backup
// gate must protect the prod DB, so it also treats a file the prod DB hasn't
// applied as pending — verified against the Management API's applied set.

/** Every migration .sql in the working tree (not just git-pending ones). */
export function listMigrationFiles() {
  let names;
  try { names = readdirSync(MIGRATIONS_DIR); } catch { return []; }
  return names.filter((n) => n.endsWith('.sql')).sort().map((n) => `${MIGRATIONS_DIR}/${n}`);
}

/** Leading numeric timestamp of a migration filename, e.g. 20260820030000. '' if none. */
export function migrationVersion(file) {
  const m = basename(file).match(/^(\d+)/);
  return m ? m[1] : '';
}

/**
 * Files the prod DB has NOT applied yet, given the applied set from the Management API.
 * A file counts as applied when the applied set holds its version prefix OR its full
 * basename-without-.sql (the latter absorbs the known version↔filename drift where a
 * migration was recorded under a rename, e.g. name "20260729000000_profiles_theme_preference").
 * Pure + deterministic so it's testable and injectable in TEST mode.
 */
/**
 * TRIAGE HELPER — presentation only, NEVER a gate input.
 *
 * True when prod has an applied migration whose DESCRIPTIVE name (basename minus
 * the leading 14-digit version) equals this file's. That is the fingerprint of a
 * migration applied through the Supabase MCP: prod stamps it with the APPLY-time
 * version, so `20260821000000_message_reactions.sql` shows up on prod as version
 * `20260722003545` / name `message_reactions` and matches neither test in
 * `unappliedMigrationFiles`.
 *
 * This is NOT used to mark anything applied. Prod names are not unique
 * (`remote_schema` appears twice), so treating a name hit as "applied" would turn
 * a noisy-but-safe over-report into a silent false NEGATIVE on a destructive
 * migration. It only sorts the report into two sections.
 */
export function nameMatched(file, applied) {
  const names = new Set(applied?.names || []);
  const desc = basename(file).replace(/\.sql$/, '').replace(/^\d{14}_/, '');
  return !!desc && names.has(desc);
}

export function unappliedMigrationFiles(files, applied, ledger = null) {
  const versions = new Set(Array.from(applied?.versions || []).map(String));
  const names = new Set(applied?.names || []);
  return files.filter((f) => {
    const ver = migrationVersion(f);
    const base = basename(f).replace(/\.sql$/, '');
    if (versions.has(ver) || names.has(base)) return false;
    // Third test (2026-09-07): an ASSERTED mapping in supabase/registry/prod-ledger-map.json,
    // honoured only while prod still holds the mapped version — see scripts/lib/ledger-map.mjs.
    if (ledger && mappedApplied(f, applied, ledger)) return false;
    return true;
  });
}
