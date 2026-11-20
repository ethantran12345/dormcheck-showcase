import type { TablesInsert } from '@/integrations/supabase/types';

/**
 * Per-column type coercion for the admin dorm CSV importer.
 *
 * The CSV parser hands every cell back as a string, but `master_housing` has
 * numeric and boolean columns. Postgres coerces on the way in, so a malformed
 * cell surfaces as an opaque DB error instead of "row 4, column floors".
 * Parse + validate here, before the insert, and reject the whole row on a bad
 * cell — a silent `null` in a capacity/floors field is worse than a failed row.
 *
 * Pure: no Supabase client, no React. The only import is a type (erased).
 */

export type MasterHousingInsert = TablesInsert<'master_housing'>;

export type MasterHousingColumn = keyof MasterHousingInsert;

/**
 * Column kinds, checked against the generated Insert type rather than
 * hand-maintained beside it: `satisfies` rejects a name that isn't a real
 * column, and the exhaustiveness guard below fails the build if the schema
 * gains a non-string column nobody classified. Everything not listed here is a
 * `string | null` column and is passed through trimmed.
 */
const NUMERIC_COLUMNS = [
  'id',
  'floors',
  'latitude',
  'longitude',
] as const satisfies readonly MasterHousingColumn[];

const BOOLEAN_COLUMNS = [
  'meal_plan_options',
  'wifi_and_cable',
  'heat_and_air_conditioning',
  'window_coverings',
] as const satisfies readonly MasterHousingColumn[];

/** Every column whose value isn't just `string | null`. */
type NonStringColumn = {
  [K in MasterHousingColumn]-?: NonNullable<MasterHousingInsert[K]> extends string ? never : K;
}[MasterHousingColumn];

type Unclassified = Exclude<
  NonStringColumn,
  (typeof NUMERIC_COLUMNS)[number] | (typeof BOOLEAN_COLUMNS)[number]
>;

// Build-time guard: if this errors, master_housing gained a non-string column
// that must be added to NUMERIC_COLUMNS or BOOLEAN_COLUMNS above.
const _allNonStringColumnsClassified: Unclassified extends never ? true : never = true;
void _allNonStringColumnsClassified;

const NUMERIC = new Set<string>(NUMERIC_COLUMNS);
const BOOLEAN = new Set<string>(BOOLEAN_COLUMNS);

const TRUE_LITERALS = new Set(['true', 'yes', '1']);
const FALSE_LITERALS = new Set(['false', 'no', '0']);

export type DormRowValues = Partial<MasterHousingInsert>;

/**
 * String discriminant, not a boolean one: this project compiles with
 * `strict: false`, and without `strictNullChecks` TypeScript widens `true` /
 * `false` literals to `boolean`, so an `ok: boolean` union never narrows.
 */
export type CoerceRowResult =
  | { status: 'ok'; values: DormRowValues }
  | { status: 'rejected'; column: string; rawValue: string; reason: string };

/**
 * Coerce one parsed CSV record into typed column values.
 *
 * Callers must hand in real `master_housing` column names — `parseDormCsv()`
 * already filters unknown headers out, and `DORM_CSV_COLUMNS` is `satisfies`-
 * checked against this table's columns.
 *
 * Empty cells become `null`. The first bad cell rejects the whole row and
 * reports which column failed and what was in it.
 */
export function coerceDormRow(rec: Record<string, string | undefined>): CoerceRowResult {
  const values: Record<string, string | number | boolean | null> = {};

  for (const [column, raw] of Object.entries(rec)) {
    const trimmed = (raw ?? '').trim();
    if (trimmed.length === 0) {
      values[column] = null;
      continue;
    }

    if (NUMERIC.has(column)) {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) {
        return { status: 'rejected', column, rawValue: trimmed, reason: 'expected a number' };
      }
      values[column] = n;
      continue;
    }

    if (BOOLEAN.has(column)) {
      const lowered = trimmed.toLowerCase();
      if (TRUE_LITERALS.has(lowered)) {
        values[column] = true;
      } else if (FALSE_LITERALS.has(lowered)) {
        values[column] = false;
      } else {
        return {
          status: 'rejected',
          column,
          rawValue: trimmed,
          reason: 'expected true/false, yes/no, or 1/0',
        };
      }
      continue;
    }

    values[column] = trimmed;
  }

  return { status: 'ok', values: values as DormRowValues };
}
