import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Home, Package, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { useChecklist } from '@/hooks/useChecklist';
import type { MarketplaceCategory } from '@/hooks/useMyListings';

export type StuffDecision = 'sell' | 'store' | 'home';

/** Draft passed to the marketplace post dialog via navigation state. */
export type ListingDraft = {
  title?: string;
  description?: string;
  price?: string;
  category?: MarketplaceCategory;
};

const DECISIONS: { key: StuffDecision; labelKey: string; icon: typeof Tag }[] = [
  { key: 'sell', labelKey: 'checklist:moveOut.triage.sellLabel', icon: Tag },
  { key: 'store', labelKey: 'checklist:moveOut.triage.storeLabel', icon: Package },
  { key: 'home', labelKey: 'checklist:moveOut.triage.homeLabel', icon: Home },
];

/** Nearest marketplace category for a checklist section name. */
function categoryForSection(section: string): MarketplaceCategory {
  const s = section.toLowerCase();
  if (s.includes('electronic') || s.includes('tech')) return 'Electronics';
  if (s.includes('furniture')) return 'Furniture';
  if (s.includes('kitchen')) return 'Kitchen';
  if (s.includes('decor')) return 'Decor';
  if (s.includes('cloth') || s.includes('laundry')) return 'Clothing';
  if (s.includes('appliance')) return 'Appliances';
  if (s.includes('book') || s.includes('study') || s.includes('school')) return 'Textbooks';
  if (s.includes('supplie')) return 'Supplies';
  return 'Other';
}

/** Rough resale ask: about half of what they paid, rounded to a friendly number. */
function resalePrice(estimated: number | null | undefined): string {
  if (!estimated || estimated <= 0) return '';
  return String(Math.max(1, Math.round(estimated / 2)));
}

export function draftListingNav(draft: ListingDraft) {
  return ['/marketplace?tab=buy-sell', { state: { openPostDialog: 'general', listingDraft: draft } }] as const;
}

/**
 * Per-item move-out triage over the student's own checklist inventory: mark
 * each thing Sell / Store / Home. "Sell" flows straight into a prefilled
 * Student Market listing draft - move-out is where marketplace supply comes
 * from. Decisions persist per user in localStorage.
 */
export function MoveOutStuffTriage({ onJumpToTier }: { onJumpToTier: (tierId: string) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { items, loading } = useChecklist(null);
  const storageKey = user ? `dormcheck_moveout_triage_${user.id}` : null;
  const [decisions, setDecisions] = useState<Record<string, StuffDecision>>({});

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setDecisions(JSON.parse(raw) as Record<string, StuffDecision>);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  const setDecision = (itemId: string, decision: StuffDecision) => {
    setDecisions((prev) => {
      const next = { ...prev };
      if (next[itemId] === decision) delete next[itemId];
      else next[itemId] = decision;
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  };

  const counts = useMemo(() => {
    const c = { sell: 0, store: 0, home: 0 };
    for (const item of items) {
      const d = decisions[item.id];
      if (d) c[d] += 1;
    }
    return c;
  }, [items, decisions]);

  if (loading) {
    return <p className="mt-3 text-sm text-muted-foreground">{t("checklist:moveOut.triage.loading")}</p>;
  }
  if (items.length === 0) {
    return (
      <p className="mt-3 text-sm text-muted-foreground">
        {t("checklist:moveOut.triage.empty")}
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {items.map((item) => {
          const decision = decisions[item.id];
          return (
            <li key={item.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{item.item}</span>
              <div className="flex items-center gap-1" role="group" aria-label={t("checklist:moveOut.triage.ariaLabel", { item: item.item })}>
                {DECISIONS.map(({ key, labelKey, icon: Icon }) => (
                  <Button
                    key={key}
                    type="button"
                    variant="ghost"
                    aria-pressed={decision === key}
                    onClick={() => setDecision(item.id, key)}
                    // [&_svg]:size-3 keeps the 12px glyph off the base [&_svg]:size-4.
                    className={cn(
                      'inline-flex h-auto items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors [&_svg]:size-3',
                      decision === key
                        ? 'border-malachite-800 bg-malachite-800 text-white hover:bg-malachite-800 hover:text-white'
                        : 'border-border bg-card text-muted-foreground hover:bg-accent',
                    )}
                  >
                    <Icon className="h-3 w-3" aria-hidden />
                    {t(labelKey)}
                  </Button>
                ))}
              </div>
              {decision === 'sell' && (
                <Button
                  type="button"
                  size="sm"
                  variant="link"
                  className="h-auto p-0 text-xs font-semibold text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    const [to, opts] = draftListingNav({
                      title: item.item,
                      price: resalePrice(item.estimated_price),
                      category: categoryForSection(item.category),
                      description: t("checklist:moveOut.triage.listingTemplate"),
                    });
                    navigate(to, opts);
                  }}
                >
                  {t("checklist:moveOut.triage.draftListing")}
                  <ArrowRight className="ml-0.5 h-3 w-3" aria-hidden />
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {counts.sell > 0 && (
          <Button
            type="button"
            size="sm"
            className="bg-foreground font-semibold text-background hover:opacity-90"
            onClick={() => {
              const [to, opts] = draftListingNav({
                title: t("checklist:moveOut.triage.wholeSetupTitle"),
                description: t("checklist:moveOut.triage.wholeSetupDesc"),
                category: 'Other',
              });
              navigate(to, opts);
            }}
          >
            {t("checklist:moveOut.triage.listWholeSetup")}
            <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden />
          </Button>
        )}
        {counts.store > 0 && (
          <Button
            type="button"
            variant="ghost"
            className="h-auto rounded-none p-0 font-medium text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:bg-transparent hover:text-foreground hover:decoration-foreground"
            onClick={() => onJumpToTier('they-help')}
          >
            {t("checklist:moveOut.triage.itemsToStore", { count: counts.store })}
          </Button>
        )}
        {counts.home > 0 && (
          <Button
            type="button"
            variant="ghost"
            className="h-auto rounded-none p-0 font-medium text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:bg-transparent hover:text-foreground hover:decoration-foreground"
            onClick={() => onJumpToTier('ship-or-store-yourself')}
          >
            {t("checklist:moveOut.triage.itemsGoingHome", { count: counts.home })}
          </Button>
        )}
      </div>
    </div>
  );
}
