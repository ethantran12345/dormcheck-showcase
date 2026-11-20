import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, Check, ChevronDown, Plus } from 'lucide-react';
import type { SkipAdvisory } from '@/data/skipAdvisories';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

type Props = {
  advisories: SkipAdvisory[];
  /**
   * One-tap "add the allowed alternative" handler. When provided, cards with
   * an `alternative` show a chip that adds the substitute to the checklist.
   */
  onAddAlternative?: (name: string) => void | Promise<void>;
};

/**
 * "Leave these at home" - an interactive, swipeable row of cards calling out
 * items students shouldn't bring to Pitt. Tap a card to expand its reason.
 * Replaces the old collapsed text list so the advice reads as a deliberate,
 * glanceable part of the checklist instead of a tacked-on dropdown.
 */
const COLLAPSED_STORAGE_KEY = 'dormcheck_skip_collapsed';

export function SkipSection({ advisories, onAddAlternative }: Props) {
  const { t } = useTranslation();
  const [openId, setOpenId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set());
  // Collapsed by default: the user's own list comes first; expand on demand.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSED_STORAGE_KEY) !== 'false';
    } catch {
      return true;
    }
  });

  if (advisories.length === 0) return null;

  // Pitt-prohibited items lead; soft "you won't need it" advice follows.
  const sorted = [...advisories].sort(
    (a, b) => Number(Boolean(b.banned)) - Number(Boolean(a.banned)),
  );

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <section className="min-w-0 border-t border-border pt-3" aria-label={t("checklist:skip.thingsToSkip")}>
      <Button
        type="button"
        variant="ghost"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        // Two glyphs at DIFFERENT sizes share this button, so a single [&_svg]:size-*
        // can't serve both: the button keeps 16px for the chevron and the 14px Ban
        // takes `!` to outrank the descendant rule. The chevron's muted tint goes in
        // the [&_svg]:text-* group; the Ban re-asserts its amber with `!` because that
        // group now paints every glyph in the button.
        className="mb-2 flex h-auto w-full items-center gap-1.5 rounded-none p-0 text-left font-normal hover:bg-transparent [&_svg]:text-muted-foreground"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
          <Ban className="!h-3.5 !w-3.5 !text-amber-600" strokeWidth={2.5} aria-hidden />
        </span>
        <h3 className="text-sm font-semibold text-foreground">{t("checklist:skip.leaveTheseAtHome")}</h3>
        <span className="text-xs text-muted-foreground">· {advisories.length}</span>
        <ChevronDown
          className={cn(
            'ml-auto h-4 w-4 shrink-0 transition-transform',
            collapsed && '-rotate-90',
          )}
          aria-hidden
        />
      </Button>

      {!collapsed ? (
      <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sorted.map((adv) => {
          const open = openId === adv.id;
          const banned = adv.banned;
          const showAlternative = Boolean(adv.alternative && onAddAlternative);
          const added = addedIds.has(adv.id);
          return (
            <div
              key={adv.id}
              className={cn(
                'flex shrink-0 snap-start flex-col rounded-2xl border transition-all',
                open ? 'w-[230px]' : 'w-[170px]',
                banned
                  ? open
                    ? 'border-rose-300 bg-rose-50'
                    : 'border-rose-200 bg-rose-50/70 hover:border-rose-300'
                  : open
                    ? 'border-amber-300 bg-amber-50'
                    : 'border-amber-200 bg-amber-50/70 hover:border-amber-300',
              )}
            >
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpenId(open ? null : adv.id)}
              aria-expanded={open}
              // flex-col/items-stretch/gap-0 preserve this button's BLOCK flow — Button's
              // base is inline-flex items-center justify-center gap-2, which would have
              // reflowed these stacked children into a centred row. The Ban's banned/
              // advisory tint also moves onto the button so [&_svg]:text-current can't
              // flatten it; the inner spans carry their own colours and are unaffected.
              className={cn(
                'flex h-auto flex-1 flex-col items-stretch justify-start gap-0 rounded-none p-3 text-left font-normal hover:bg-transparent',
                banned ? '[&_svg]:text-rose-500' : '[&_svg]:text-amber-500',
              )}
            >
              <div className="flex items-center gap-2">
                <Ban className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden />
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-sm font-semibold',
                    banned ? 'text-rose-900' : 'text-amber-900',
                  )}
                >
                  {adv.name}
                </span>
              </div>
              {banned ? (
                <span className="mt-1.5 inline-block rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700">
                  {t("checklist:skip.bannedAtPitt")}
                </span>
              ) : null}
              <p
                className={cn(
                  'mt-1.5 text-xs leading-relaxed',
                  banned ? 'text-rose-800/80' : 'text-amber-800/80',
                  open ? '' : 'line-clamp-2',
                )}
              >
                {adv.reason}
              </p>
              {!open ? (
                <span
                  className={cn(
                    'mt-1 inline-block text-[11px] font-semibold',
                    banned ? 'text-rose-700' : 'text-amber-700',
                  )}
                >
                  {t("checklist:skip.why")}
                </span>
              ) : null}
            </Button>
            {showAlternative ? (
              <Button
                type="button"
                variant="ghost"
                disabled={added}
                onClick={() => {
                  if (added) return;
                  setAddedIds((prev) => new Set(prev).add(adv.id));
                  void onAddAlternative?.(adv.alternative as string);
                }}
                // [&_svg]:size-3 keeps the 12px check/plus off the base [&_svg]:size-4.
                className={cn(
                  'mx-3 mb-3 inline-flex h-auto items-center gap-1 self-start rounded-full border px-2 py-1 text-[11px] font-semibold transition-colors [&_svg]:size-3',
                  added
                    ? 'border-border bg-muted text-foreground hover:bg-muted'
                    : 'border-border bg-card text-foreground hover:bg-accent',
                )}
              >
                {added ? (
                  <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden />
                ) : (
                  <Plus className="h-3 w-3" strokeWidth={2.5} aria-hidden />
                )}
                {added ? t("checklist:skip.addedToList") : t("checklist:skip.addInstead", { alternative: adv.alternative })}
              </Button>
            ) : null}
            </div>
          );
        })}
      </div>
      ) : null}
    </section>
  );
}
