import type { Tables } from '@/integrations/supabase/types';
import type { MasterHousingColumn } from '@/lib/dormCsvCoerce';

type MasterHousingRow = Tables<'master_housing'>;

/**
 * CSV import/export for master_housing. Columns are the flat text fields an
 * operations person actually maintains in a spreadsheet (term rates above all).
 * `id` is the match key on import; rows without an id become inserts.
 */
export const DORM_CSV_COLUMNS = [
  'id',
  'residence_hall',
  'accomodation',
  'housing_type',
  'rate_per_term',
  'rent_period',
  'capacity',
  'address',
  'mailing_address',
  'who_lives_here',
  'details',
] as const satisfies readonly MasterHousingColumn[];

export type DormCsvColumn = (typeof DORM_CSV_COLUMNS)[number];
export type DormCsvRecord = Partial<Record<DormCsvColumn, string>>;

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function serializeDormsCsv(rows: MasterHousingRow[]): string {
  const header = DORM_CSV_COLUMNS.join(',');
  const lines = rows.map((row) =>
    DORM_CSV_COLUMNS.map((c) => csvEscape(row[c as keyof MasterHousingRow])).join(','),
  );
  return [header, ...lines].join('\r\n');
}

/** Minimal RFC 4180 parser: quoted fields, embedded commas/quotes/newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.length > 0)) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((f) => f.length > 0)) rows.push(row);
  return rows;
}

export type FieldChange = {
  id: number;
  residence_hall: string;
  field: DormCsvColumn;
  oldValue: string | null;
  newValue: string | null;
};

export type DormCsvDiff = {
  changes: FieldChange[];
  newRows: DormCsvRecord[];
  /** CSV rows whose id matches nothing in the database. */
  unmatched: DormCsvRecord[];
  /** Header columns in the file that aren't importable (ignored). */
  ignoredColumns: string[];
};

export function parseDormCsv(text: string): { records: DormCsvRecord[]; ignoredColumns: string[] } {
  const grid = parseCsv(text);
  if (grid.length === 0) return { records: [], ignoredColumns: [] };
  const header = grid[0].map((h) => h.trim());
  const known = new Set<string>(DORM_CSV_COLUMNS);
  const ignoredColumns = header.filter((h) => !known.has(h));
  const records = grid.slice(1).map((cells) => {
    const rec: DormCsvRecord = {};
    header.forEach((h, i) => {
      if (known.has(h)) rec[h as DormCsvColumn] = (cells[i] ?? '').trim();
    });
    return rec;
  });
  return { records, ignoredColumns };
}

const norm = (v: unknown): string => (v == null ? '' : String(v).trim());

export function diffDormCsv(
  records: DormCsvRecord[],
  existing: MasterHousingRow[],
  ignoredColumns: string[],
): DormCsvDiff {
  const byId = new Map(existing.map((r) => [String(r.id), r]));
  const changes: FieldChange[] = [];
  const newRows: DormCsvRecord[] = [];
  const unmatched: DormCsvRecord[] = [];

  for (const rec of records) {
    const idRaw = norm(rec.id);
    if (!idRaw) {
      newRows.push(rec);
      continue;
    }
    const current = byId.get(idRaw);
    if (!current) {
      unmatched.push(rec);
      continue;
    }
    for (const col of DORM_CSV_COLUMNS) {
      if (col === 'id' || !(col in rec)) continue;
      const next = norm(rec[col]);
      const prev = norm(current[col as keyof MasterHousingRow]);
      if (next !== prev) {
        changes.push({
          id: current.id,
          residence_hall: current.residence_hall ?? `Row ${current.id}`,
          field: col,
          oldValue: prev || null,
          newValue: next || null,
        });
      }
    }
  }
  return { changes, newRows, unmatched, ignoredColumns };
}
