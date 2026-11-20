#!/usr/bin/env node
/**
 * ledger-record.mjs — assert that a repo migration file landed in prod under a given ledger
 * version, after the LIVE ledger confirms it. Writes supabase/registry/prod-ledger-map.json.
 *
 *   npm run ledger:record -- <migration file or basename> <prodVersion> [--evidence <path>] [--by <who>]
 *   npm run ledger:record -- --verify          # every mapping still confirmed by prod?
 *
 * Needs SUPABASE_ACCESS_TOKEN (Management API, read-only: GET /database/migrations). Without a
 * token it refuses rather than record an unconfirmed mapping — the whole point of the map is
 * that its rows are asserted, not inferred. Why this exists: docs/migration-history-divergence.md
 * and docs/audits/prod-apply-2026-09-07.md §7.
 */
import { basename } from 'node:path';
import { listMigrationFiles } from './lib/migrations.mjs';
import { LEDGER_MAP_PATH, loadLedgerMap, saveLedgerMap, planRecord, verifyLedgerMap } from './lib/ledger-map.mjs';

const REF = process.env.DC_SUPABASE_PROD_REF || 'abcdefghijklmnopqrst';
const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i > -1 ? argv[i + 1] : undefined; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && argv[i - 1] !== '--verify'));

async function liveLedgerRows() {
  const token = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_PAT;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set — refusing to record a mapping the live ledger has not confirmed.');
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/migrations`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Management API ${res.status} ${res.statusText}`);
  const json = await res.json();
  const rows = Array.isArray(json) ? json : (json.migrations || []);
  if (!rows.length) throw new Error('Management API returned no applied migrations');
  return rows.map((r) => ({ version: String(r.version), name: r.name }));
}

(async () => {
  const ledger = loadLedgerMap();
  if (!ledger.project_ref) ledger.project_ref = REF;
  if (ledger.project_ref !== REF) {
    console.error(`ledger:record: ${LEDGER_MAP_PATH} is for project ${ledger.project_ref}, but this run targets ${REF}.`);
    process.exit(1);
  }

  if (argv.includes('--verify')) {
    const rows = await liveLedgerRows();
    const problems = verifyLedgerMap(ledger, rows);
    const n = Object.keys(ledger.map).length;
    if (!problems.length) { console.log(`ledger:record --verify: ${n} mapping(s), every one still confirmed by prod ${REF}.`); process.exit(0); }
    console.error(`ledger:record --verify: ${problems.length} of ${n} mapping(s) no longer confirmed by prod ${REF}:`);
    for (const p of problems) console.error(`  ✗ ${p.file}: ${p.problem}`);
    process.exit(1);
  }

  const [fileArg, prodVersion] = positional;
  if (!fileArg || !prodVersion) {
    console.error('usage: npm run ledger:record -- <migration file> <prodVersion> [--evidence <path>] [--by <who>]   |   --verify');
    process.exit(2);
  }
  const rows = await liveLedgerRows();
  const migrationFiles = listMigrationFiles().map((f) => basename(f));
  const plan = planRecord({
    file: fileArg,
    prodVersion,
    ledger,
    ledgerRows: rows,
    migrationFiles,
    today: new Date().toISOString().slice(0, 10),
    evidence: flag('--evidence') || null,
    recordedBy: flag('--by') || process.env.USER || null,
  });
  const base = basename(fileArg);
  if (!plan.ok) {
    console.error(`ledger:record: refusing ${base} → ${prodVersion}`);
    for (const r of plan.reasons) console.error(`  ✗ ${r}`);
    process.exit(1);
  }
  if (plan.unchanged) {
    console.log(`ledger:record: ${base} → ${prodVersion} already recorded (${plan.entry.recordedOn}); nothing written.`);
    process.exit(0);
  }
  ledger.map[base] = plan.entry;
  saveLedgerMap(ledger);
  console.log(`ledger:record: ${base} → ${prodVersion} (${plan.entry.prodName}) confirmed by prod ${REF} and written to ${LEDGER_MAP_PATH}.`);
})().catch((e) => { console.error(`ledger:record: ${e.message || e}`); process.exit(1); });
