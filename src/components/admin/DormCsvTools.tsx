import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { logDormEdit } from '@/hooks/useDormEdits';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  diffDormCsv,
  parseDormCsv,
  serializeDormsCsv,
  type DormCsvDiff,
  type DormCsvRecord,
} from '@/lib/dormCsv';
import { coerceDormRow, type MasterHousingInsert } from '@/lib/dormCsvCoerce';
import type { Tables } from '@/integrations/supabase/types';

type MasterHousingRow = Tables<'master_housing'>;

async function fetchAllRows(): Promise<MasterHousingRow[]> {
  const { data, error } = await supabase.from('master_housing').select('*').limit(10000);
  if (error) throw error;
  return data ?? [];
}

/** Export + reviewed CSV import for master_housing. Never applies silently. */
export function DormCsvTools() {
  const { universityId } = useAuth();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [diff, setDiff] = useState<DormCsvDiff | null>(null);
  /** Per-row reasons the last import rejected something, shown after the dialog closes. */
  const [importErrors, setImportErrors] = useState<string[]>([]);

  const exportCsv = async () => {
    setBusy(true);
    try {
      const rows = await fetchAllRows();
      const blob = new Blob([serializeDormsCsv(rows)], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `master_housing-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Exported ${rows.length} rows`);
    } catch (err) {
      console.error('[DormCsvTools] export failed', err);
      toast.error('Export failed');
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File) => {
    setBusy(true);
    setImportErrors([]);
    try {
      const text = await file.text();
      const { records, ignoredColumns } = parseDormCsv(text);
      if (records.length === 0) {
        toast.error('No data rows found in that file.');
        return;
      }
      const existing = await fetchAllRows();
      setDiff(diffDormCsv(records, existing, ignoredColumns));
    } catch (err) {
      console.error('[DormCsvTools] import parse failed', err);
      toast.error('Could not read that CSV.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const applyDiff = async () => {
    if (!diff) return;
    setApplying(true);
    let applied = 0;
    let inserted = 0;
    let failed = 0;
    const errors: string[] = [];
    try {
      // Field updates: same write + audit path as a manual edit.
      for (const change of diff.changes) {
        try {
          const { data, error } = await supabase
            .from('master_housing')
            .update({ [change.field]: change.newValue } as Partial<MasterHousingRow>)
            .eq('id', change.id)
            .select('id');
          if (error) throw error;
          if (!data || data.length === 0) throw new Error('0 rows affected (RLS?)');
          await logDormEdit(change.id, change.field, change.oldValue, change.newValue);
          applied++;
        } catch (err) {
          failed++;
          errors.push(
            `${change.residence_hall} · ${change.field}: ${err instanceof Error ? err.message : 'update failed'}`,
          );
          console.error('[DormCsvTools] update failed', change, err);
        }
      }

      // New rows (no id in the CSV). Tenant scope comes from the importer's
      // university; a superadmin with no university must add rows in-app.
      // `master_housing.id` is a plain NOT NULL bigint PK — no sequence, no
      // identity — so the importer mints the next id itself. A racing writer
      // just loses the PK uniqueness check and lands in `failed`, never a
      // silent overwrite.
      let nextId = diff.newRows.length > 0 ? await nextDormId() : 0;
      for (const [i, rec] of diff.newRows.entries()) {
        const label = `New row ${i + 1} (${rowLabel(rec)})`;
        if (!universityId) {
          failed++;
          errors.push(`${label}: no university on your account — add this dorm in-app instead.`);
          continue;
        }
        const { id: _id, ...fields } = rec;
        const coerced = coerceDormRow(fields);
        if (coerced.status === 'rejected') {
          // A bad cell rejects the whole row: importing it with a null in a
          // capacity/floors field is worse than not importing it at all.
          failed++;
          errors.push(
            `${label}: column "${coerced.column}" — ${coerced.reason}, got "${coerced.rawValue}". Row not imported.`,
          );
          continue;
        }
        try {
          // Consume the id even if the insert fails, so one bad row can't make
          // every following row retry the same (possibly taken) id.
          const row: MasterHousingInsert = {
            ...coerced.values,
            id: nextId++,
            university_id: universityId,
          };
          const { data, error } = await supabase
            .from('master_housing')
            .insert(row)
            .select('id')
            .single();
          if (error) throw error;
          await logDormEdit(data.id, 'csv_import.new_row', null, JSON.stringify(rec));
          inserted++;
        } catch (err) {
          failed++;
          errors.push(`${label}: ${err instanceof Error ? err.message : 'insert failed'}`);
          console.error('[DormCsvTools] insert failed', rec, err);
        }
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-dorms-list'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-dorm-health'] }),
        queryClient.invalidateQueries({ queryKey: ['dorms'] }),
      ]);
      setImportErrors(errors);
      if (failed > 0) {
        toast.error(`Applied ${applied} changes, ${inserted} new rows; ${failed} failed.`, {
          description: errors.slice(0, 3).join(' · '),
        });
      } else {
        toast.success(`Applied ${applied} changes${inserted ? `, ${inserted} new rows` : ''}.`);
      }
      setDiff(null);
    } finally {
      setApplying(false);
    }
  };

  const totalToApply = diff ? diff.changes.length + diff.newRows.length : 0;

  return (
    <>
      {importErrors.length > 0 && (
        <div
          role="status"
          className="mb-2 rounded-card border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
        >
          <p className="mb-1 font-medium">
            {importErrors.length} {importErrors.length === 1 ? 'row was' : 'rows were'} not imported
          </p>
          <ul className="list-disc space-y-0.5 pl-4">
            {importErrors.map((message, i) => (
              <li key={i}>{message}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void exportCsv()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Export CSV
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="h-4 w-4" />
          Import CSV
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          aria-label="Choose CSV file to import"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
      </div>

      <Dialog open={diff != null} onOpenChange={(open) => !open && !applying && setDiff(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review import</DialogTitle>
            <DialogDescription>
              Nothing is applied until you confirm. Every applied change is audited like a manual
              edit.
            </DialogDescription>
          </DialogHeader>
          {diff && (
            <div className="space-y-3 text-sm">
              <p className="font-medium text-foreground">
                {diff.changes.length} field {diff.changes.length === 1 ? 'change' : 'changes'},{' '}
                {diff.newRows.length} new {diff.newRows.length === 1 ? 'row' : 'rows'},{' '}
                {diff.unmatched.length} unmatched
              </p>
              {diff.ignoredColumns.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Ignored columns: {diff.ignoredColumns.join(', ')}
                </p>
              )}
              {diff.changes.length > 0 && (
                <div className="max-h-60 overflow-y-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted text-left uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Hall</th>
                        <th className="px-3 py-2 font-medium">Field</th>
                        <th className="px-3 py-2 font-medium">From</th>
                        <th className="px-3 py-2 font-medium">To</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {diff.changes.map((c, i) => (
                        <tr key={`${c.id}-${c.field}-${i}`}>
                          <td className="px-3 py-1.5">{c.residence_hall}</td>
                          <td className="px-3 py-1.5 font-mono">{c.field}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{c.oldValue ?? '(empty)'}</td>
                          <td className="px-3 py-1.5 font-medium">{c.newValue ?? '(empty)'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {diff.newRows.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  New rows (no id): {diff.newRows.map((r) => rowLabel(r)).join('; ')}
                </p>
              )}
              {diff.unmatched.length > 0 && (
                <p className="text-xs text-amber-800">
                  Unmatched ids (skipped): {diff.unmatched.map((r) => r.id).join(', ')}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={applying}
              onClick={() => setDiff(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={applying || totalToApply === 0}
              onClick={() => void applyDiff()}
              className="bg-malachite-800 text-white hover:bg-malachite-900"
            >
              {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : `Apply ${totalToApply} changes`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function rowLabel(rec: DormCsvRecord): string {
  return [rec.residence_hall, rec.accomodation].filter(Boolean).join(' / ') || '(unnamed)';
}

/** Next free `master_housing.id` — the PK has no sequence or identity default. */
async function nextDormId(): Promise<number> {
  const { data, error } = await supabase
    .from('master_housing')
    .select('id')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.id ?? 0) + 1;
}
