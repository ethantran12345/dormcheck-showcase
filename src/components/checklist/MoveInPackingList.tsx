import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Check, ChevronDown, Moon, PackageCheck } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  computeChecklistReadiness,
  groupChecklistByReadiness,
  resolveChecklistStatus,
} from '@/components/checklist/checklistHelpers';
import { UNIVERSITY_PROVIDES } from '@/data/moveInArrival';
import { Button } from '@/components/ui/button';
import type { ChecklistItem, ChecklistItemStatus } from '@/types';
import { cn } from '@/lib/utils';

/**
 * Keywords for the things Pitt supplies in every room (derived from
 * UNIVERSITY_PROVIDES, which is universal, not per-dorm). Used to tag a packing
 * item the student doesn't need to bring.
 */
const PROVIDED_KEYWORDS = [
  'bed', 'desk', 'chair', 'dresser', 'closet', 'wardrobe',
  'cable tv', 'vacuum', 'recycl', 'landfill', 'bin',
];

function isProvided(name: string): boolean {
  const n = name.toLowerCase();
  return PROVIDED_KEYWORDS.some((kw) => n.includes(kw));
}

/** Three-state status control mirroring the canonical ChecklistReadinessView chip. */
function StatusChip({ item }: { item: ChecklistItem }) {
  const s = resolveChecklistStatus(item);
  if (s === 'packed') {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-malachite-600 bg-malachite-800 text-white shadow-raised">
        <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
      </span>
    );
  }
  if (s === 'bought') {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-malachite-600 bg-card">
        <span className="h-2.5 w-2.5 rounded-full bg-malachite-600" aria-hidden />
      </span>
    );
  }
  return <span className="block h-6 w-6 rounded-full border-2 border-border bg-card" aria-hidden />;
}

function PackRow({
  item,
  onAdvance,
  onToggleNightOne,
}: {
  item: ChecklistItem;
  onAdvance: (id: string) => void;
  onToggleNightOne: (id: string) => void;
}) {
  const { t } = useTranslation();
  const s = resolveChecklistStatus(item);
  const statusLabel =
    s === 'packed'
      ? t('checklist:v2.statusPacked')
      : s === 'bought'
        ? t('checklist:v2.statusHave')
        : t('checklist:v2.statusNeed');
  const provided = isProvided(item.item);
  return (
    <li className="flex items-center gap-2.5 py-1.5">
      <Button
        type="button"
        variant="ghost"
        onClick={() => onAdvance(item.id)}
        aria-label={t('checklist:v2.advanceAria', { item: item.item, status: statusLabel })}
        // [&_svg]:size-3.5 — StatusChip hides a 14px Check that Button's base
        // [&_svg]:size-4 would otherwise inflate.
        className="h-auto shrink-0 rounded-full p-0 transition-transform hover:bg-transparent active:scale-95 [&_svg]:size-3.5"
      >
        <StatusChip item={item} />
      </Button>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-sm text-foreground',
            s === 'packed' && 'text-muted-foreground line-through',
          )}
        >
          {item.item}
        </span>
        {provided && (
          <span className="text-[11px] font-medium text-muted-foreground">
            {t('checklist:moveIn.packProvidedTag')}
          </span>
        )}
      </span>
      <Button
        type="button"
        variant="ghost"
        onClick={() => onToggleNightOne(item.id)}
        aria-pressed={!!item.is_night_one}
        aria-label={
          item.is_night_one
            ? t('checklist:v2.removeNightOne')
            : t('checklist:v2.addNightOne')
        }
        // The moon's on/off tint is expressed in the [&_svg]:text-* group so it beats
        // Button's base [&_svg]:text-current deterministically.
        className={cn(
          'h-auto shrink-0 rounded-full p-1 transition-colors hover:bg-accent',
          item.is_night_one
            ? '[&_svg]:text-malachite-700'
            : '[&_svg]:text-muted-foreground/40',
        )}
      >
        <Moon className="h-4 w-4" strokeWidth={2.25} aria-hidden />
      </Button>
    </li>
  );
}

function PackGroup({
  title,
  items,
  onAdvance,
  onToggleNightOne,
  tone = 'default',
}: {
  title: string;
  items: ChecklistItem[];
  onAdvance: (id: string) => void;
  onToggleNightOne: (id: string) => void;
  tone?: 'default' | 'nightOne';
}) {
  if (items.length === 0) return null;
  return (
    <div
      className={cn(
        'rounded-xl border p-3',
        tone === 'nightOne' ? 'border-border bg-muted' : 'border-border bg-card',
      )}
    >
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground">
        {tone === 'nightOne' && <Moon className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />}
        {title}
      </p>
      <ul className="divide-y divide-border/60">
        {items.map((item) => (
          <PackRow key={item.id} item={item} onAdvance={onAdvance} onToggleNightOne={onToggleNightOne} />
        ))}
      </ul>
    </div>
  );
}

/**
 * The Move-In tab's interactive packing list: one stateful view over the
 * student's real personal checklist (reusing `useChecklist` + the readiness
 * helpers), replacing the old static "What to pack" / "What Pitt provides" /
 * night-one blurbs. Night One is a filter over `is_night_one` (not a separate
 * list); check-off persists to `checklist_items` and syncs with My Checklist.
 * Heavy editing (add / retag / move / delete) stays in the full checklist tab.
 */
const PACKING_QK = (uid: string) => ['movein-packing-items', uid] as const;

export function MoveInPackingList({
  userId,
  dormName,
  hideHeader = false,
}: {
  userId: string;
  dormName: string | null;
  /** Skip the internal title row when a parent entry card already names it. */
  hideHeader?: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Self-contained read of the PERSONAL checklist. We deliberately do NOT reuse
  // useChecklist here: ChecklistPage already mounts one instance, and a second
  // would collide on the shared realtime channel topic. This is a plain read +
  // optimistic write over the same checklist_items rows (reusing the canonical
  // readiness helpers), which is all the packing view needs.
  const { data: items = [], isLoading: loading } = useQuery({
    queryKey: PACKING_QK(userId),
    queryFn: async (): Promise<ChecklistItem[]> => {
      const { data, error } = await supabase
        .from('checklist_items')
        .select(
          'id, item, category, status, is_checked, is_night_one, assigned_to, estimated_price, group_id, user_id, order_index',
        )
        .eq('user_id', userId)
        .is('group_id', null)
        .order('order_index', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ChecklistItem[];
    },
  });

  const readiness = useMemo(() => computeChecklistReadiness(items, userId), [items, userId]);
  const groups = useMemo(() => groupChecklistByReadiness(items, userId), [items, userId]);
  const [nightOneOnly, setNightOneOnly] = useState(false);
  const [showPacked, setShowPacked] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: PACKING_QK(userId) });
  const patch = (id: string, next: Partial<ChecklistItem>) =>
    queryClient.setQueryData<ChecklistItem[]>(PACKING_QK(userId), (prev) =>
      (prev ?? []).map((it) => (it.id === id ? { ...it, ...next } : it)),
    );

  // Tap the status chip: need -> bought -> packed -> need (mirrors the canonical
  // cycleStatus, incl. keeping is_checked in sync). Optimistic; rolls back on error.
  const advance = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const cur = resolveChecklistStatus(item);
    const nextStatus: ChecklistItemStatus = cur === 'need' ? 'bought' : cur === 'bought' ? 'packed' : 'need';
    patch(id, { status: nextStatus, is_checked: nextStatus === 'packed' });
    void supabase
      .from('checklist_items')
      .update({ status: nextStatus, is_checked: nextStatus === 'packed' })
      .eq('id', id)
      .then(({ error }) => {
        if (error) invalidate();
      });
  };

  const toggleNight = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const next = !item.is_night_one;
    patch(id, { is_night_one: next });
    void supabase
      .from('checklist_items')
      .update({ is_night_one: next })
      .eq('id', id)
      .then(({ error }) => {
        if (error) invalidate();
      });
  };

  if (loading && items.length === 0) {
    return (
      <div className="space-y-2 rounded-2xl border border-border bg-card p-4 shadow-raised" aria-hidden>
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        <div className="h-11 w-full animate-pulse rounded-xl bg-muted" />
        <div className="h-11 w-full animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  const hasItems = items.length > 0;

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-raised">
      {!hideHeader && (
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <PackageCheck className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{t('checklist:moveIn.packListTitle')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('checklist:moveIn.packListSubtitle')}</p>
          </div>
        </div>
      )}

      {hasItems ? (
        <>
          {/* Readiness meter (reuses the canonical weighted score). */}
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {t('checklist:v2.readinessLabel')}
              </span>
              <span className="text-sm font-bold text-foreground">{readiness.readiness}%</span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={readiness.readiness}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t('checklist:v2.readinessLabel')}
            >
              <div
                className="h-full rounded-full bg-malachite-600 transition-[width] duration-300"
                style={{ width: `${readiness.readiness}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {readiness.packedCount} {t('checklist:v2.packedLabel')} · {readiness.got}{' '}
              {t('checklist:v2.gotLabel')} · {readiness.total} {t('checklist:moveIn.packTotalLabel')}
              {readiness.nightOneTotal > 0 && (
                <>
                  {' · '}
                  {t('checklist:v2.readyCount', {
                    ready: readiness.nightOneReady,
                    total: readiness.nightOneTotal,
                  })}{' '}
                  {t('checklist:moveIn.packNightOneLabel')}
                </>
              )}
            </p>
          </div>

          {/* Night One filter. */}
          {readiness.nightOneTotal > 0 && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setNightOneOnly((v) => !v)}
              aria-pressed={nightOneOnly}
              // [&_svg]:size-3.5 keeps the 14px moon off Button's base [&_svg]:size-4.
              className={cn(
                'inline-flex h-auto items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors [&_svg]:size-3.5',
                nightOneOnly
                  ? 'border-malachite-600 bg-malachite-600/10 text-malachite-800 hover:bg-malachite-600/10 hover:text-malachite-800 dark:text-malachite-300 dark:hover:text-malachite-300'
                  : 'border-border text-muted-foreground hover:bg-accent',
              )}
            >
              <Moon className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
              {t('checklist:moveIn.packNightOneOnly')}
            </Button>
          )}

          <div className="space-y-2">
            <PackGroup
              title={t('checklist:v2.nightOneTitle')}
              items={groups.nightOne}
              onAdvance={advance}
              onToggleNightOne={toggleNight}
              tone="nightOne"
            />
            {!nightOneOnly && (
              <>
                <PackGroup
                  title={t('checklist:v2.stillNeed')}
                  items={groups.stillNeed}
                  onAdvance={advance}
                  onToggleNightOne={toggleNight}
                />
                <PackGroup
                  title={t('checklist:v2.have')}
                  items={groups.have}
                  onAdvance={advance}
                  onToggleNightOne={toggleNight}
                />
                {groups.packed.length > 0 && (
                  <div className="rounded-xl border border-border bg-card">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setShowPacked((v) => !v)}
                      aria-expanded={showPacked}
                      // Tint via [&_svg]:text-*, matching Button's own [&_svg]:text-current
                      // group — inheriting from a plain text-* on the button does not hold.
                      className="flex h-auto w-full items-center justify-between rounded-none p-3 text-left font-normal hover:bg-transparent [&_svg]:text-muted-foreground"
                    >
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {showPacked
                          ? t('checklist:moveIn.packHidePacked')
                          : t('checklist:moveIn.packShowPacked', { n: groups.packed.length })}
                      </span>
                      <ChevronDown
                        className={cn('h-4 w-4 transition-transform', showPacked && 'rotate-180')}
                        aria-hidden
                      />
                    </Button>
                    {showPacked && (
                      <ul className="divide-y divide-border/60 px-3 pb-2">
                        {groups.packed.map((item) => (
                          <PackRow key={item.id} item={item} onAdvance={advance} onToggleNightOne={toggleNight} />
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-background p-4 text-center">
          <p className="text-sm font-medium text-foreground">{t('checklist:v2.emptyTitle')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('checklist:v2.emptyBody')}</p>
        </div>
      )}

      {/* What Pitt provides - universal, dorm-labeled when known. */}
      <div className="rounded-xl border border-border bg-background p-3">
        <p className="text-xs font-semibold text-foreground">
          {dormName
            ? t('checklist:moveIn.packProvidesInDorm', { dorm: dormName })
            : t('checklist:moveIn.packProvidesTitle')}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('checklist:moveIn.packProvidesHint')}</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs leading-relaxed text-foreground">
          {UNIVERSITY_PROVIDES.map((provide) => (
            <li key={provide}>{provide}</li>
          ))}
        </ul>
      </div>

      <Link
        to="/checklist?tab=checklist"
        className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:underline"
      >
        {t('checklist:moveIn.packOpenFull')}
      </Link>
    </div>
  );
}
