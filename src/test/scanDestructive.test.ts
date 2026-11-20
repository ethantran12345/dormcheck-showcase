import { describe, expect, it } from 'vitest';

// The db:preflight gate's scanner. Plain ESM, no .d.ts — but `allowJs` resolves it,
// so a @ts-expect-error here is itself an error (TS2578, caught by typecheck:ratchet).
import { scanDestructive } from '../../scripts/lib/migrations.mjs';

type Hit = { kind: string; line: number; snippet: string };
const kinds = (sql: string) => (scanDestructive(sql) as Hit[]).map((h) => h.kind);

/**
 * db:preflight refuses to let a destructive migration reach prod without a fresh backup.
 * Its value depends entirely on the signal being trustworthy: a gate that fires on safe
 * statements gets waved through, and then it is not a gate at all.
 *
 * The false positive these tests pin down was found 2026-08-02 — a REVOKE of the TRUNCATE
 * privilege was reported as a truncate, while the batch's real `drop table ... cascade`
 * sat in a different file.
 */
describe('scanDestructive', () => {
  it('does not flag a REVOKE that merely names TRUNCATE in its privilege list', () => {
    const sql =
      'REVOKE INSERT, UPDATE, TRUNCATE, REFERENCES, TRIGGER ON public.mfa_backup_codes FROM authenticated;';
    expect(kinds(sql)).toEqual([]);
  });

  it('does not flag a GRANT naming TRUNCATE', () => {
    expect(kinds('GRANT TRUNCATE ON public.t TO service_role;')).toEqual([]);
  });

  // The privilege list is routinely wrapped, and the keyword often lands on a line that
  // does not itself contain the word REVOKE — which is why the check walks back to the
  // previous statement terminator rather than testing the matched line.
  it('does not flag a multi-line REVOKE', () => {
    const sql = ['REVOKE', '  INSERT, UPDATE,', '  TRUNCATE', 'ON public.t FROM authenticated;'].join('\n');
    expect(kinds(sql)).toEqual([]);
  });

  it('still flags a real TRUNCATE', () => {
    expect(kinds('truncate table public.t;')).toEqual(['truncate']);
  });

  it('still flags a real TRUNCATE that follows a REVOKE in the same file', () => {
    const sql = ['REVOKE TRUNCATE ON public.t FROM authenticated;', 'TRUNCATE public.t;'].join('\n');
    expect(kinds(sql)).toEqual(['truncate']);
  });

  it('still flags the destructive classes this batch actually contained', () => {
    expect(kinds('drop table if exists public.university_resources cascade;')).toEqual([
      'drop table/view/schema/type',
    ]);
    expect(kinds('ALTER TABLE public.t DROP CONSTRAINT IF EXISTS c;')).toEqual(['drop constraint']);
    expect(kinds('alter table t drop column c;')).toEqual(['drop column']);
  });

  it('reports the line number of the real hit, not the skipped one', () => {
    const sql = ['REVOKE TRUNCATE ON public.t FROM authenticated;', '', 'drop table public.t;'].join('\n');
    const hits = scanDestructive(sql) as Hit[];
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(3);
  });

  it('still ignores destructive statements inside comments', () => {
    expect(kinds('-- drop table public.t;\nselect 1;')).toEqual([]);
  });
});
