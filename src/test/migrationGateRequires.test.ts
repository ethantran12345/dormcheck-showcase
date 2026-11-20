/**
 * migration-gate step 0 — `-- requires:` pairing (BA-08, docs/audits/backend-audit-2026-09-06.md).
 *
 * 20260911000000 (first-name-only guest projection) depended on 20260910000000 being in
 * the same apply, and the only thing that said so was a paragraph in its header. The
 * declaration is now machine-readable and the gate refuses an apply set that would land
 * one half without the other.
 */
import { describe, it, expect } from 'vitest';
import { extractRequires, checkRequires } from '../../scripts/migration-gate.mjs';

describe('extractRequires', () => {
  it('reads one migration per header line, anywhere in the file', () => {
    const sql = [
      '-- requires: 20260910000000_marketplace_service_posts.sql',
      '--',
      '-- some prose that mentions requires: nothing.sql in passing',
      'CREATE VIEW x AS SELECT 1;',
      '  --requires:   20260830040000_marketplace_moderation_decision_backfill.sql  ',
    ].join('\n');
    expect(extractRequires(sql)).toEqual([
      '20260910000000_marketplace_service_posts.sql',
      '20260830040000_marketplace_moderation_decision_backfill.sql',
    ]);
  });
  it('is empty for a file with no declaration', () => {
    expect(extractRequires('CREATE TABLE t (id int);')).toEqual([]);
  });
});

describe('checkRequires', () => {
  const A = 'supabase/migrations/20260910000000_marketplace_service_posts.sql';
  const B = 'supabase/migrations/20260911000000_marketplace_public_first_name_only.sql';
  const bSql = '-- requires: 20260910000000_marketplace_service_posts.sql\nCREATE OR REPLACE VIEW v AS SELECT 1;';

  it('is satisfied when the required file is in the same apply set', () => {
    expect(checkRequires([{ file: A, sql: '' }, { file: B, sql: bSql }], () => false)).toEqual([]);
  });
  it('is satisfied when prod already applied the required file', () => {
    expect(checkRequires([{ file: B, sql: bSql }], (req) => req.startsWith('20260910000000'))).toEqual([]);
  });
  it('refuses the dependent half on its own', () => {
    const unmet = checkRequires([{ file: B, sql: bSql }], () => false);
    expect(unmet).toHaveLength(1);
    expect(unmet[0]).toMatchObject({
      file: '20260911000000_marketplace_public_first_name_only.sql',
      requires: '20260910000000_marketplace_service_posts.sql',
    });
    expect(unmet[0].reason).toMatch(/not applied in prod/);
  });
  it('refuses, and says why, when prod\'s applied set cannot be read', () => {
    const unmet = checkRequires([{ file: B, sql: bSql }], () => null);
    expect(unmet).toHaveLength(1);
    expect(unmet[0].reason).toMatch(/unverifiable/);
  });
  it('reports every unmet requirement, not just the first', () => {
    const sql = '-- requires: a.sql\n-- requires: b.sql\n';
    const unmet = checkRequires([{ file: 'supabase/migrations/z.sql', sql }], () => false);
    expect(unmet.map((u) => u.requires)).toEqual(['a.sql', 'b.sql']);
  });
});
