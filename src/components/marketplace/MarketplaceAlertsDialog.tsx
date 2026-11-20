import { useEffect, useMemo, useState } from 'react';
import { BellRing, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from '@/components/ui/responsive-modal';
import { MARKETPLACE_CATEGORIES } from '@/hooks/useMyListings';
import {
  MAX_MARKETPLACE_ALERTS,
  useMarketplaceAlerts,
  type MarketplaceAlert,
} from '@/hooks/useMarketplaceAlerts';
import { cn } from '@/lib/utils';

/** Prefill handed over from the marketplace filter panel. */
export interface AlertPrefill {
  category: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  keywords: string;
}

function summarize(alert: MarketplaceAlert): string {
  const parts: string[] = [];
  parts.push(alert.categories.length > 0 ? alert.categories.join(', ') : 'Any category');
  if (alert.min_price != null || alert.max_price != null) {
    if (alert.min_price != null && alert.max_price != null)
      parts.push(`$${alert.min_price}–$${alert.max_price}`);
    else if (alert.max_price != null) parts.push(`Under $${alert.max_price}`);
    else parts.push(`Over $${alert.min_price}`);
  } else {
    parts.push('Any price');
  }
  if (alert.keywords?.trim()) parts.push(`"${alert.keywords.trim()}"`);
  return parts.join(' · ');
}

/**
 * LinkedIn-style "Manage alerts" for the student market: save the current
 * filters as a named alert, toggle alerts on/off, delete them. Matching new
 * listings land in the notifications bell (trigger in migration
 * 20260810000000_marketplace_alerts.sql).
 */
export function MarketplaceAlertsDialog({
  open,
  onOpenChange,
  userId,
  prefill,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | undefined;
  prefill: AlertPrefill;
}) {
  const { alerts, isLoading, createAlert, updateAlert, deleteAlert } = useMarketplaceAlerts(userId);

  const [name, setName] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [keywords, setKeywords] = useState('');

  // Re-seed the create form from the live filter panel each time it opens.
  useEffect(() => {
    if (!open) return;
    const cats = prefill.category ? [prefill.category] : [];
    setCategories(cats);
    setMinPrice(prefill.minPrice != null ? String(prefill.minPrice) : '');
    setMaxPrice(prefill.maxPrice != null ? String(prefill.maxPrice) : '');
    setKeywords(prefill.keywords);
    const kw = prefill.keywords.trim();
    setName(kw || prefill.category || 'Any new listing');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const atLimit = alerts.length >= MAX_MARKETPLACE_ALERTS;
  const canSave = useMemo(() => name.trim().length > 0 && !atLimit, [name, atLimit]);

  const toggleCategory = (cat: string) =>
    setCategories((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));

  const parsePrice = (v: string): number | null => {
    const n = Number(v);
    return v.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
  };

  const handleCreate = async () => {
    const min = parsePrice(minPrice);
    const max = parsePrice(maxPrice);
    if (min != null && max != null && min > max) {
      toast.error('Min price must be at or below max price.');
      return;
    }
    try {
      await createAlert.mutateAsync({
        name: name.trim().slice(0, 60),
        categories,
        min_price: min,
        max_price: max,
        keywords: keywords.trim() ? keywords.trim().slice(0, 120) : null,
      });
      toast.success("Alert created - we'll notify you when a matching item is posted.");
    } catch {
      toast.error('Could not create the alert. Please try again.');
    }
  };

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent dialogClassName="sm:max-w-lg">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle className="flex items-center gap-2">
            <BellRing className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} aria-hidden />
            Marketplace alerts
          </ResponsiveModalTitle>
          <ResponsiveModalDescription>
            Get notified when a new listing matches what you're looking for. Turn any alert off
            whenever you want.
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        {/* Create from current filters */}
        <div className="space-y-3 rounded-xl border border-border bg-muted p-3">
          <div className="space-y-1.5">
            <Label htmlFor="alert-name">Alert name</Label>
            <Input
              id="alert-name"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Mini fridge under $50"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alert-keywords">Keywords (optional)</Label>
            <Input
              id="alert-keywords"
              value={keywords}
              maxLength={120}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="e.g. desk lamp"
            />
          </div>
          <div className="space-y-1.5">
            <span className="text-sm font-medium leading-none">Categories</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Alert categories">
              {MARKETPLACE_CATEGORIES.map((cat) => {
                const active = categories.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleCategory(cat)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-bold transition-colors',
                      active
                        ? 'border-border bg-foreground text-background'
                        : 'border-border bg-card text-muted-foreground hover:bg-accent',
                    )}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
            <p className="text-xs font-medium text-muted-foreground">
              Leave all unselected to match every category.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="alert-min-price">Min $</Label>
              <Input
                id="alert-min-price"
                type="number"
                inputMode="numeric"
                min={0}
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="alert-max-price">Max $</Label>
              <Input
                id="alert-max-price"
                type="number"
                inputMode="numeric"
                min={0}
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                placeholder="Any"
              />
            </div>
          </div>
          <Button
            // KEEP: primary CTA of the alerts dialog (create alert)
            className="w-full bg-malachite-800 hover:bg-malachite-900"
            disabled={!canSave || createAlert.isPending}
            onClick={handleCreate}
          >
            {createAlert.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            {atLimit ? `Alert limit reached (${MAX_MARKETPLACE_ALERTS})` : 'Create alert'}
          </Button>
        </div>

        {/* Existing alerts */}
        <div className="space-y-2">
          <span className="text-sm font-extrabold text-foreground">
            Your alerts {alerts.length > 0 && `(${alerts.length}/${MAX_MARKETPLACE_ALERTS})`}
          </span>
          {isLoading ? (
            <div className="py-4 text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading alerts" />
            </div>
          ) : alerts.length === 0 ? (
            <p className="py-2 text-sm font-semibold text-muted-foreground">
              No alerts yet. Save the filters above to start getting matches.
            </p>
          ) : (
            <ul className="space-y-2">
              {alerts.map((alert) => (
                <li
                  key={alert.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-foreground">{alert.name}</p>
                    <p className="truncate text-xs font-semibold text-muted-foreground">
                      {summarize(alert)}
                    </p>
                  </div>
                  <Switch
                    checked={alert.enabled}
                    aria-label={`${alert.enabled ? 'Disable' : 'Enable'} alert ${alert.name}`}
                    onCheckedChange={(enabled) =>
                      updateAlert.mutate(
                        { id: alert.id, enabled },
                        { onError: () => toast.error('Could not update the alert.') },
                      )
                    }
                  />
                  <button
                    type="button"
                    aria-label={`Delete alert ${alert.name}`}
                    className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600"
                    onClick={() =>
                      deleteAlert.mutate(alert.id, {
                        onSuccess: () => toast.success('Alert deleted.'),
                        onError: () => toast.error('Could not delete the alert.'),
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
