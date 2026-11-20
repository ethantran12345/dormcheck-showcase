import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Scale, ArrowRight } from 'lucide-react';
import type { Dorm } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { safeImageSrc } from '@/lib/sanitize';
import { walkMinutesToCathedral, formatWalkToCathedral } from '@/lib/campusDistance';
import { toRoomTypeDisplayLabel } from '@/lib/dormUtils';

const MAX_COMPARE = 3;

interface CompareDormsTrayProps {
  /** The user's saved (hearted) dorms; the tray appears once 2+ are saved. */
  savedDorms: Dorm[];
  onDormClick: (dorm: Dorm) => void;
}

function roomTypesSummary(dorm: Dorm): string {
  const types = (dorm.roomTypes ?? []).filter(Boolean).map((t) => toRoomTypeDisplayLabel(String(t)));
  if (types.length === 0) return 'N/A';
  const unique = [...new Set(types)];
  return unique.slice(0, 4).join(', ') + (unique.length > 4 ? ` +${unique.length - 4}` : '');
}

function rateSummary(dorm: Dorm): string {
  const rate = dorm.semesterRate ?? 0;
  if (rate <= 0) return 'N/A';
  const period = dorm.rentPeriod === 'month' ? 'month' : 'semester';
  return `${dorm.minRate != null && dorm.minRate > 0 ? 'From ' : ''}$${rate.toLocaleString()} / ${period}`;
}

/**
 * Saved-hearts compare loop for the desktop explore split: a bar under the list
 * summarizing the shortlist, opening a side-by-side of 2-3 halls. The shortlist
 * itself is the saved-dorms set, already persisted to the profile.
 */
export function CompareDormsTray({ savedDorms, onDormClick }: CompareDormsTrayProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Default selection: first saved halls up to the cap; prune unhearted ones.
  useEffect(() => {
    setSelectedIds((prev) => {
      const stillSaved = prev.filter((id) => savedDorms.some((d) => d.id === id));
      const next = [...stillSaved];
      for (const d of savedDorms) {
        if (next.length >= MAX_COMPARE) break;
        if (!next.includes(d.id)) next.push(d.id);
      }
      return next;
    });
  }, [savedDorms]);

  const selectedDorms = useMemo(
    () => savedDorms.filter((d) => selectedIds.includes(d.id)),
    [savedDorms, selectedIds],
  );

  if (savedDorms.length < 2) return null;

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, id];
    });
  };

  const rows: { label: string; render: (d: Dorm) => React.ReactNode }[] = [
    { label: t('housing:explore.compareTray.rate'), render: (d) => rateSummary(d) },
    { label: t('housing:explore.compareTray.roomTypes'), render: (d) => roomTypesSummary(d) },
    { label: t('housing:explore.compareTray.whoLivesHere'), render: (d) => (d.audienceType === 'Freshman' ? t('housing:explore.compareTray.firstYear') : t('housing:explore.compareTray.upperclass')) },
    { label: t('housing:explore.compareTray.airConditioning'), render: (d) => (d.heat_and_air_conditioning ? t('common:state.yes') : t('common:state.no')) },
    {
      label: t('housing:explore.compareTray.walkToCathedral'),
      render: (d) => formatWalkToCathedral(walkMinutesToCathedral(d.latitude, d.longitude)),
    },
  ];

  return (
    <>
      <div className="shrink-0 border-t border-border bg-card px-4 py-2.5 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{savedDorms.length} {t('housing:explore.compareTray.saved')}</span>
          {' '}{t('housing:explore.compareTray.hallsInShortlist')}
        </p>
        <Button
          type="button"
          onClick={() => setOpen(true)}
          className="h-9 shrink-0 rounded-full bg-malachite-800 px-4 text-sm font-semibold text-white hover:bg-malachite-900"
        >
          <Scale className="h-4 w-4 shrink-0" aria-hidden />
          {t('housing:explore.compareTray.compareHalls')}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('housing:explore.compareTray.dialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('housing:explore.compareTray.dialogDescription', { n: MAX_COMPARE })}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-2">
            {savedDorms.map((dorm) => {
              const selected = selectedIds.includes(dorm.id);
              const atCap = !selected && selectedIds.length >= MAX_COMPARE;
              return (
                <button
                  key={dorm.id}
                  type="button"
                  onClick={() => toggleSelected(dorm.id)}
                  disabled={atCap}
                  aria-pressed={selected}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                    selected
                      ? 'border-malachite-600 bg-malachite-800 text-white'
                      : 'border-border bg-muted text-muted-foreground hover:bg-accent',
                    atCap && 'opacity-40',
                  )}
                >
                  {dorm.name}
                </button>
              );
            })}
          </div>

          {selectedDorms.length < 2 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('housing:explore.compareTray.selectAtLeast2')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="w-36 p-2" aria-label="Attribute" />
                    {selectedDorms.map((dorm) => (
                      <th key={dorm.id} className="p-2 text-left align-bottom">
                        <img
                          src={safeImageSrc(dorm.image) || '/placeholder.svg'}
                          alt=""
                          className="mb-2 h-20 w-full rounded-lg object-cover"
                        />
                        <span className="font-semibold text-foreground">{dorm.name}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.label} className="border-t border-border">
                      <th scope="row" className="p-2 text-left font-medium text-muted-foreground">
                        {row.label}
                      </th>
                      {selectedDorms.map((dorm) => (
                        <td key={dorm.id} className="p-2 text-foreground">
                          {row.render(dorm)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-t border-border">
                    <th scope="row" className="p-2" aria-label="Actions" />
                    {selectedDorms.map((dorm) => (
                      <td key={dorm.id} className="p-2">
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false);
                            onDormClick(dorm);
                          }}
                          className="inline-flex items-center gap-1 text-sm font-semibold text-malachite-800 hover:underline"
                        >
                          {t('housing:explore.compareTray.viewHall')}
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
