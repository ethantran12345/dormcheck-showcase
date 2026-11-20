import { describe, expect, it } from 'vitest';
import { coerceDormRow } from './dormCsvCoerce';

describe('coerceDormRow', () => {
  it('coerces a good row per column type', () => {
    const result = coerceDormRow({
      residence_hall: '  Litchfield Towers  ',
      floors: '22',
      wifi_and_cable: 'yes',
      capacity: '1800',
      details: '',
    });

    expect(result).toEqual({
      status: 'ok',
      values: {
        residence_hall: 'Litchfield Towers',
        floors: 22,
        wifi_and_cable: true,
        // `capacity` is a text column in master_housing — it stays a string.
        capacity: '1800',
        details: null,
      },
    });
  });

  it('rejects the whole row when a numeric cell is not a number', () => {
    const result = coerceDormRow({ residence_hall: 'Sutherland', floors: 'thre' });

    expect(result).toEqual({
      status: 'rejected',
      column: 'floors',
      rawValue: 'thre',
      reason: 'expected a number',
    });
  });

  it('accepts the documented boolean spellings, case-insensitively', () => {
    for (const [raw, expected] of [
      ['true', true],
      ['TRUE', true],
      ['Yes', true],
      ['1', true],
      ['false', false],
      ['No', false],
      ['0', false],
    ] as const) {
      expect(coerceDormRow({ meal_plan_options: raw })).toEqual({
        status: 'ok',
        values: { meal_plan_options: expected },
      });
    }
  });

  it('rejects the whole row on an unparseable boolean cell', () => {
    const result = coerceDormRow({ residence_hall: 'Nordenberg', meal_plan_options: 'maybe' });

    expect(result).toEqual({
      status: 'rejected',
      column: 'meal_plan_options',
      rawValue: 'maybe',
      reason: 'expected true/false, yes/no, or 1/0',
    });
  });

  it('treats blank and missing cells as null rather than rejecting', () => {
    expect(coerceDormRow({ residence_hall: '   ', floors: '', wifi_and_cable: undefined })).toEqual({
      status: 'ok',
      values: { residence_hall: null, floors: null, wifi_and_cable: null },
    });
  });
});
