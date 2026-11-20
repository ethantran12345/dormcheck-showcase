import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  DORM_HEALTH_COLUMNS,
  missingKeyFields,
  type DormHealthRow,
} from '@/lib/dormDataHealth';

async function fetchHealthRows(): Promise<DormHealthRow[]> {
  const { data, error } = await supabase
    .from('master_housing')
    .select(DORM_HEALTH_COLUMNS)
    .limit(10000);
  if (error) throw error;
  return (data ?? []) as unknown as DormHealthRow[];
}

/**
 * Dashboard "Data health" card: how many room-type rows have every key field
 * (photo, rate, address, map location, description) and the worst offenders,
 * each linking straight to its edit page.
 */
export function DataHealthCard() {
  const query = useQuery({
    queryKey: ['admin-dorm-health'],
    queryFn: fetchHealthRows,
    staleTime: 60_000,
  });

  const rows = query.data ?? [];
  const scored = rows
    .map((row) => ({ row, missing: missingKeyFields(row) }))
    .filter((s) => s.missing.length > 0)
    .sort((a, b) => b.missing.length - a.missing.length);
  const complete = rows.length - scored.length;
  const worst = scored.slice(0, 5);

  return (
    <div className="rounded-xl border border-border bg-card shadow-raised p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="w-4 h-4 text-malachite-800" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">Data health</h2>
      </div>
      {query.isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : query.isError ? (
        <p className="text-sm text-foreground">Couldn't check dorm data.</p>
      ) : (
        <>
          <p className="text-sm text-foreground">
            <span className="text-2xl font-bold">{complete}</span>
            <span className="text-muted-foreground"> of {rows.length} room types have complete data</span>
          </p>
          {worst.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every room type has a photo, rate, address, map location, and description.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {worst.map(({ row, missing }) => (
                <li key={row.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link
                    to={`/admin/dorms/${row.id}`}
                    className="min-w-0 truncate font-medium text-malachite-800 hover:underline"
                  >
                    {row.residence_hall ?? `Row ${row.id}`}
                  </Link>
                  <span className="shrink-0 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                    missing {missing.join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {scored.length > worst.length && (
            <p className="text-xs text-muted-foreground">
              + {scored.length - worst.length} more with gaps - see{' '}
              <Link to="/admin/dorms" className="font-medium text-malachite-800 hover:underline">
                Manage Dorms
              </Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}
