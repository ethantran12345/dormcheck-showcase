/**
 * prod-ledger-map — the asserted file ↔ prod-ledger-row mapping (docs/audits/prod-apply-2026-09-07.md §7).
 *
 * MCP apply_migration stamps prod with the apply-time version, so a repo file's own version
 * never appears in the ledger and every ledger-based "applied?" test reads it as pending
 * forever. The map asserts the join; these tests pin the two safety properties: a mapping is
 * only recorded when the live ledger confirms it, and it only counts while prod still holds it.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  descriptiveName, loadLedgerMap, saveLedgerMap, mappedApplied, planRecord, verifyLedgerMap,
} from '../../scripts/lib/ledger-map.mjs';
import { unappliedMigrationFiles } from '../../scripts/lib/migrations.mjs';

const FILE = '20261005000000_admin_policies_drop_is_admin_predicate.sql';
const ROWS = [
  { version: '20260907010606', name: 'admin_policies_drop_is_admin_predicate' },
  { version: '20260907011057', name: 'role_change_flag_reset' },
  { version: '20260806164121', name: 'remote_schema' },
  { version: '20260807000000', name: 'remote_schema' },
];
const MIGRATIONS = [FILE, '20261006000000_role_change_flag_reset.sql', '20261007000000_account_deletion_fk_on_delete.sql'];
type Entry = { prodVersion: string; prodName?: string; recordedOn?: string };
const ledgerWith = (map: Record<string, Entry>) => ({ project_ref: 'abcdefghijklmnopqrst', map });
const plan = (over: Partial<Parameters<typeof planRecord>[0]> = {}) => planRecord({
  file: FILE, prodVersion: '20260907010606', ledger: ledgerWith({}), ledgerRows: ROWS,
  migrationFiles: MIGRATIONS, today: '2026-09-07', evidence: 'docs/audits/prod-apply-2026-09-07.md', recordedBy: 'test', ...over,
});

describe('descriptiveName', () => {
  it('strips the 14-digit stamp and .sql', () => {
    expect(descriptiveName(FILE)).toBe('admin_policies_drop_is_admin_predicate');
    expect(descriptiveName('supabase/migrations/' + FILE)).toBe('admin_policies_drop_is_admin_predicate');
  });
});

describe('planRecord — records only what the live ledger confirms', () => {
  it('accepts a version prod holds under this file\'s descriptive name', () => {
    const p = plan();
    expect(p.ok).toBe(true);
    expect(p.entry).toMatchObject({ prodVersion: '20260907010606', prodName: 'admin_policies_drop_is_admin_predicate', recordedOn: '2026-09-07' });
  });
  it('refuses a version prod does not hold', () => {
    const p = plan({ prodVersion: '20260907999999' });
    expect(p.ok).toBe(false);
    expect(p.reasons.join(' ')).toMatch(/no row with version 20260907999999/);
  });
  it('refuses a row named for a different migration', () => {
    const p = plan({ prodVersion: '20260907011057' });
    expect(p.ok).toBe(false);
    expect(p.reasons.join(' ')).toMatch(/named "role_change_flag_reset"/);
  });
  it('refuses a file that is not a repo migration', () => {
    const p = plan({ file: '20261099000000_nothing.sql' });
    expect(p.ok).toBe(false);
    expect(p.reasons.join(' ')).toMatch(/not a file in supabase\/migrations/);
  });
  it('refuses a malformed version stamp', () => {
    expect(plan({ prodVersion: '2026-09-07' }).ok).toBe(false);
  });
  it('refuses to remap a file to a second prod version', () => {
    const p = plan({ ledger: ledgerWith({ [FILE]: { prodVersion: '20260907011057', prodName: 'x' } }) });
    expect(p.ok).toBe(false);
    expect(p.reasons.join(' ')).toMatch(/already mapped to 20260907011057/);
  });
  it('refuses a prod version another file already claims', () => {
    const p = plan({ ledger: ledgerWith({ 'other.sql': { prodVersion: '20260907010606', prodName: 'admin_policies_drop_is_admin_predicate' } }) });
    expect(p.ok).toBe(false);
    expect(p.reasons.join(' ')).toMatch(/already claimed by other.sql/);
  });
  it('is idempotent for an identical mapping', () => {
    const existing = { prodVersion: '20260907010606', prodName: 'admin_policies_drop_is_admin_predicate', recordedOn: '2026-09-07' };
    const p = plan({ ledger: ledgerWith({ [FILE]: existing }) });
    expect(p.ok).toBe(true);
    expect(p.unchanged).toBe(true);
    expect(p.entry).toBe(existing);
  });
  it('does not turn a duplicate prod name (remote_schema) into a mapping for the wrong file', () => {
    const p = plan({ file: '20261007000000_account_deletion_fk_on_delete.sql', prodVersion: '20260806164121' });
    expect(p.ok).toBe(false);
  });
});

describe('mappedApplied — the map asserts, the ledger decides', () => {
  const ledger = ledgerWith({ [FILE]: { prodVersion: '20260907010606', prodName: 'admin_policies_drop_is_admin_predicate' } });
  it('is true while prod still holds the mapped version (array or Set applied sets)', () => {
    expect(mappedApplied(FILE, { versions: ['20260907010606'] }, ledger)).toBe(true);
    expect(mappedApplied('supabase/migrations/' + FILE, { versions: new Set(['20260907010606']) }, ledger)).toBe(true);
  });
  it('is false when prod no longer holds the mapped version', () => {
    expect(mappedApplied(FILE, { versions: ['20260101000000'] }, ledger)).toBe(false);
  });
  it('is false for an unmapped file and for an unverifiable applied set', () => {
    expect(mappedApplied('20261006000000_role_change_flag_reset.sql', { versions: ['20260907011057'] }, ledger)).toBe(false);
    expect(mappedApplied(FILE, { versions: null }, ledger)).toBe(false);
    expect(mappedApplied(FILE, { versions: ['20260907010606'] }, null)).toBe(false);
  });
});

describe('unappliedMigrationFiles with a ledger map', () => {
  const files = MIGRATIONS.map((f) => 'supabase/migrations/' + f);
  const applied = { versions: ['20260907010606', '20260907011057'], names: ['admin_policies_drop_is_admin_predicate', 'role_change_flag_reset'] };
  it('without a map every MCP-applied file still reads as pending (unchanged behaviour)', () => {
    expect(unappliedMigrationFiles(files, applied)).toEqual(files);
  });
  it('a mapped file drops out only when prod holds its mapped version', () => {
    const ledger = ledgerWith({
      [FILE]: { prodVersion: '20260907010606', prodName: 'admin_policies_drop_is_admin_predicate' },
      '20261007000000_account_deletion_fk_on_delete.sql': { prodVersion: '20260907011422', prodName: 'account_deletion_fk_on_delete' },
    });
    expect(unappliedMigrationFiles(files, applied, ledger)).toEqual([
      'supabase/migrations/20261006000000_role_change_flag_reset.sql',           // not mapped → still pending
      'supabase/migrations/20261007000000_account_deletion_fk_on_delete.sql',    // mapped, but prod (here) lacks 20260907011422 → pending
    ]);
  });
  it('accepts a Set-shaped applied set like the gate passes', () => {
    const ledger = ledgerWith({ [FILE]: { prodVersion: '20260907010606', prodName: 'admin_policies_drop_is_admin_predicate' } });
    const setApplied = { versions: new Set(['20260907010606']), names: new Set() };
    expect(unappliedMigrationFiles(files, setApplied, ledger)).toEqual(files.slice(1));
  });
});

describe('verifyLedgerMap', () => {
  it('reports mappings prod no longer confirms, by version or by name', () => {
    const ledger = ledgerWith({
      [FILE]: { prodVersion: '20260907010606', prodName: 'admin_policies_drop_is_admin_predicate' },
      'b.sql': { prodVersion: '20260907011057', prodName: 'something_else' },
      'c.sql': { prodVersion: '20269999999999', prodName: 'gone' },
    });
    const problems = verifyLedgerMap(ledger, ROWS);
    expect(problems.map((p) => p.file).sort()).toEqual(['b.sql', 'c.sql']);
  });
});

describe('load/save', () => {
  it('a missing file is an empty map; saving sorts keys and keeps the comment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-map-'));
    try {
      const path = join(dir, 'prod-ledger-map.json');
      expect(loadLedgerMap(path)).toEqual({ project_ref: null, map: {} });
      saveLedgerMap({ project_ref: 'x', map: { 'b.sql': { prodVersion: '2' }, 'a.sql': { prodVersion: '1' } } }, path);
      const raw = JSON.parse(readFileSync(path, 'utf8'));
      expect(Object.keys(raw.map)).toEqual(['a.sql', 'b.sql']);
      expect(raw._comment).toMatch(/ledger:record/);
      expect(loadLedgerMap(path).map['a.sql'].prodVersion).toBe('1');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
