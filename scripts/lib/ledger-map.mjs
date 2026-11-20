/**
 * ledger-map.mjs — the ASSERTED map between repo migration files and the rows prod's
 * `supabase_migrations.schema_migrations` actually holds for them.
 *
 * THE PROBLEM. The Supabase MCP `apply_migration` stamps the ledger with the APPLY-TIME
 * version and the descriptive name you pass it — `20261005000000_admin_policies_drop_is_admin_
 * predicate.sql` lands as version `20260907010606`, name `admin_policies_drop_is_admin_predicate`.
 * The file's own version never appears in prod, so every ledger-based "is this applied?" test
 * (`db:preflight`, `gate:migrations`) reads the file as pending forever. Until 2026-09-07 the
 * only mitigation was `nameMatched()` in migrations.mjs, which is deliberately PRESENTATION
 * ONLY: prod names are not unique (`remote_schema` twice), so a name hit alone must never mark
 * a destructive file applied.
 *
 * THE FIX. `supabase/registry/prod-ledger-map.json` records `file → {prodVersion, prodName}`
 * and is written ONLY by `npm run ledger:record`, which refuses any mapping the live ledger
 * does not confirm (row with that version exists AND is named for this file). Consumers treat
 * a mapped file as applied only while prod STILL HOLDS that version — the map asserts, the
 * ledger decides. A mapped version prod no longer has (restored backup, reset branch) makes
 * the file pending again, which is the safe direction.
 *
 * Pure functions here; I/O is confined to load/save so everything else is unit-testable.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

export const LEDGER_MAP_PATH = 'supabase/registry/prod-ledger-map.json';

const COMMENT =
  'Asserted name<->stamp map between repo migration files and the rows prod’s supabase_migrations.schema_migrations holds for them. ' +
  'MCP apply_migration stamps the ledger with the APPLY-TIME version and the descriptive name, so a file’s own version never appears in prod. ' +
  'Written only by `npm run ledger:record -- <file> <prodVersion>`, which refuses a mapping the live ledger does not confirm. ' +
  'Read by scripts/lib/migrations.mjs (db:preflight) and scripts/migration-gate.mjs: a mapped file counts as applied only while prod still holds that version. ' +
  'Never hand-edit. Evidence for each row lives in the transcript it names.';

/** `20261005000000_admin_policies_drop_is_admin_predicate.sql` → `admin_policies_drop_is_admin_predicate`. */
export function descriptiveName(file) {
  return basename(file).replace(/\.sql$/, '').replace(/^\d{14}_/, '');
}

/** Load the map; a missing file is an empty map, never an error. */
export function loadLedgerMap(path = LEDGER_MAP_PATH) {
  if (!existsSync(path)) return { project_ref: null, map: {} };
  const j = JSON.parse(readFileSync(path, 'utf8'));
  return { project_ref: j.project_ref ?? null, map: j.map && typeof j.map === 'object' ? j.map : {} };
}

export function saveLedgerMap(ledger, path = LEDGER_MAP_PATH) {
  const sorted = Object.fromEntries(Object.keys(ledger.map).sort().map((k) => [k, ledger.map[k]]));
  const out = { _comment: COMMENT, project_ref: ledger.project_ref ?? null, map: sorted };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
  return out;
}

export function mappedEntry(file, ledger) {
  return ledger?.map?.[basename(file)] ?? null;
}

function hasVersion(applied, version) {
  const v = applied?.versions;
  if (!v) return false;
  const s = String(version);
  return v instanceof Set ? v.has(s) : Array.from(v).map(String).includes(s);
}

/**
 * True only when the map asserts this file landed in prod under `prodVersion` AND the
 * applied set (from the Management API) still holds that version. The map never overrides
 * the ledger.
 */
export function mappedApplied(file, applied, ledger) {
  const e = mappedEntry(file, ledger);
  if (!e || !e.prodVersion) return false;
  return hasVersion(applied, e.prodVersion);
}

/**
 * Decide whether `file → prodVersion` may be recorded. Pure: the caller supplies the live
 * ledger rows (`[{version, name}]`) and the repo's migration basenames.
 *
 * Refuses when: the file is not a repo migration; the version is not a 14-digit stamp; prod
 * has no row with that version; that row is named for a different migration; the file is
 * already mapped elsewhere; or another file already claims that prod version. Recording an
 * identical mapping twice is a no-op (`ok: true, unchanged: true`).
 */
export function planRecord({ file, prodVersion, ledger, ledgerRows, migrationFiles, today, evidence, recordedBy }) {
  const base = basename(file);
  const reasons = [];
  const version = String(prodVersion ?? '').trim();
  if (!migrationFiles.includes(base)) reasons.push(`${base} is not a file in supabase/migrations/`);
  if (!/^\d{14}$/.test(version)) reasons.push(`prod version must be a 14-digit stamp, got "${version}"`);
  const desc = descriptiveName(base);
  const row = ledgerRows.find((r) => String(r.version) === version);
  if (!row) {
    reasons.push(`prod ledger has no row with version ${version}`);
  } else {
    const rowName = String(row.name ?? '');
    const full = base.replace(/\.sql$/, '');
    if (rowName !== desc && rowName !== full) {
      reasons.push(`ledger row ${version} is named "${rowName}", but ${base} would be "${desc}"`);
    }
  }
  const existing = ledger.map[base];
  if (existing && String(existing.prodVersion) !== version) {
    reasons.push(`${base} is already mapped to ${existing.prodVersion}; a file has exactly one prod row`);
  }
  const claimant = Object.entries(ledger.map).find(([k, v]) => k !== base && String(v.prodVersion) === version);
  if (claimant) reasons.push(`prod version ${version} is already claimed by ${claimant[0]}`);
  if (reasons.length) return { ok: false, reasons, entry: null, unchanged: false };
  if (existing && String(existing.prodVersion) === version) {
    return { ok: true, reasons: [], entry: existing, unchanged: true };
  }
  const entry = {
    prodVersion: version,
    prodName: String(row.name),
    recordedOn: today,
    recordedBy: recordedBy || null,
    evidence: evidence || null,
  };
  return { ok: true, reasons: [], entry, unchanged: false };
}

/** Re-check every mapping against live rows; returns the entries prod no longer confirms. */
export function verifyLedgerMap(ledger, ledgerRows) {
  const byVersion = new Map(ledgerRows.map((r) => [String(r.version), String(r.name ?? '')]));
  const problems = [];
  for (const [file, e] of Object.entries(ledger.map)) {
    const name = byVersion.get(String(e.prodVersion));
    if (name === undefined) problems.push({ file, problem: `prod no longer holds version ${e.prodVersion}` });
    else if (name !== String(e.prodName)) problems.push({ file, problem: `prod row ${e.prodVersion} is now named "${name}", map says "${e.prodName}"` });
  }
  return problems;
}
