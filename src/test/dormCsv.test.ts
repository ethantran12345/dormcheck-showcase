import { describe, expect, it } from 'vitest';
import { diffDormCsv, parseCsv, parseDormCsv, serializeDormsCsv } from '@/lib/dormCsv';
import type { Tables } from '@/integrations/supabase/types';

type Row = Tables<'master_housing'>;

const row = (over: Partial<Row>): Row =>
  ({
    id: 1,
    residence_hall: 'Holland Hall',
    accomodation: 'Double',
    housing_type: 'On-Campus Housing',
    rate_per_term: '4,330.00',
    rent_period: null,
    capacity: 'Houses 600 students',
    address: null,
    mailing_address: null,
    who_lives_here: null,
    details: 'Classic hall "on the hill", cozy',
    ...over,
  }) as Row;

describe('dormCsv', () => {
  it('round-trips quoted fields with commas and quotes', () => {
    const csv = serializeDormsCsv([row({})]);
    const grid = parseCsv(csv);
    expect(grid).toHaveLength(2);
    const rec = parseDormCsv(csv).records[0];
    expect(rec.rate_per_term).toBe('4,330.00');
    expect(rec.details).toBe('Classic hall "on the hill", cozy');
  });

  it('diffs rate changes, new rows, and unmatched ids', () => {
    const existing = [row({ id: 1 }), row({ id: 2, accomodation: 'Triple', rate_per_term: '3,725.00' })];
    const csv = [
      'id,residence_hall,rate_per_term',
      '1,Holland Hall,"4,500.00"',
      '2,Holland Hall,"3,725.00"',
      ',New Hall,"5,000.00"',
      '99,Ghost Hall,"1.00"',
    ].join('\n');
    const { records, ignoredColumns } = parseDormCsv(csv);
    const diff = diffDormCsv(records, existing, ignoredColumns);
    expect(diff.changes).toEqual([
      {
        id: 1,
        residence_hall: 'Holland Hall',
        field: 'rate_per_term',
        oldValue: '4,330.00',
        newValue: '4,500.00',
      },
    ]);
    expect(diff.newRows).toHaveLength(1);
    expect(diff.newRows[0].residence_hall).toBe('New Hall');
    expect(diff.unmatched).toHaveLength(1);
    expect(diff.unmatched[0].id).toBe('99');
  });

  it('ignores unknown columns and reports them', () => {
    const { ignoredColumns, records } = parseDormCsv('id,nonsense\n1,zap');
    expect(ignoredColumns).toEqual(['nonsense']);
    expect(records[0]).toEqual({ id: '1' });
  });

  it('only diffs columns present in the file', () => {
    const existing = [row({ id: 1 })];
    const { records, ignoredColumns } = parseDormCsv('id,rate_per_term\n1,"4,330.00"');
    const diff = diffDormCsv(records, existing, ignoredColumns);
    expect(diff.changes).toHaveLength(0);
  });
});
