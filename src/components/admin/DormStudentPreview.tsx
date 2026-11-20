import { Suspense, lazy, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { deduplicateDorms } from '@/hooks/useDorms';
import type { Tables } from '@/integrations/supabase/types';

type MasterHousingRow = Tables<'master_housing'>;

const DormDetail = lazy(() =>
  import('@/components/DormDetail').then((m) => ({ default: m.DormDetail })),
);

async function fetchHallRows(hall: string): Promise<MasterHousingRow[]> {
  const { data, error } = await supabase
    .from('master_housing')
    .select('*')
    .eq('residence_hall', hall);
  if (error) throw error;
  return data ?? [];
}

/**
 * "What students see" panel: renders the REAL student DormDetail component
 * (never a lookalike) for the building containing `row`, with `row`'s current
 * (possibly unsaved) values substituted in. Students see buildings merged from
 * every room-type row of the hall, so the preview merges the same way.
 */
export function DormStudentPreview({ row }: { row: MasterHousingRow }) {
  const hall = row.residence_hall?.trim() ?? '';

  const siblings = useQuery({
    queryKey: ['admin-dorm-siblings', hall],
    queryFn: () => fetchHallRows(hall),
    enabled: hall.length > 0,
    staleTime: 30_000,
  });

  const dorm = useMemo(() => {
    const others = (siblings.data ?? []).filter((r) => r.id !== row.id);
    const merged = deduplicateDorms([row, ...others]);
    return (
      merged.find(
        (d) =>
          d.id === String(row.id) ||
          d.variants?.some((v) => v.id === String(row.id)) ||
          merged.length === 1,
      ) ?? merged[0] ?? null
    );
  }, [siblings.data, row]);

  return (
    <section
      aria-label="What students see"
      className="rounded-xl border border-border bg-card shadow-raised overflow-hidden flex flex-col"
    >
      <div className="flex items-center gap-2 border-b border-border bg-muted px-4 py-2.5">
        <Eye className="w-4 h-4 text-malachite-800" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">What students see</h2>
        <span className="text-xs text-muted-foreground">updates as you edit, before saving</span>
      </div>
      <div className="relative overflow-y-auto max-h-[75vh] bg-background">
        {siblings.isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : dorm ? (
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            }
          >
            <DormDetail
              dorm={dorm}
              photos={[]}
              onBack={() => {}}
              allDorms={[]}
            />
          </Suspense>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Set a residence hall name to preview the student view.
          </p>
        )}
      </div>
    </section>
  );
}
