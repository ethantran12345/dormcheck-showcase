import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Loader2, Search, Tag } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
} from '@/components/ui/responsive-modal';

export interface ShareableListing {
  id: string;
  title: string;
  price: number | null;
  category: string | null;
  image_urls: string[] | null;
  status: string | null;
}

interface ShareListingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the chosen listing; composing and sending is the caller's job. */
  onPick: (listing: ShareableListing) => void;
}

/**
 * Lets someone drop one of their OWN marketplace listings into a DM ("here's
 * the fridge I'm selling"). The mirror of `ShareChecklistItemDialog`, but it
 * hands back the listing itself rather than an attachment payload, because DMs
 * carry a shared listing as a `[Dormcheck:listing:<id>]` context marker inside
 * the message text — `messages` has no metadata column of its own.
 *
 * Own listings only: sharing someone else's listing from a picker would be a
 * different feature (and a different privacy question) than forwarding the one
 * you are already looking at, which the "Message seller" flow already covers.
 */
export function ShareListingDialog({ open, onOpenChange, onPick }: ShareListingDialogProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [listings, setListings] = useState<ShareableListing[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open || !user?.id) return;
    let cancelled = false;
    setIsLoading(true);
    setError(false);
    void (async () => {
      const { data, error: qErr } = await supabase
        .from('marketplace_listings')
        .select('id, title, price, category, image_urls, status')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(60);
      if (cancelled) return;
      if (qErr) {
        setError(true);
      } else {
        setListings((data ?? []) as ShareableListing[]);
      }
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, user?.id]);

  // Reset the search each time it reopens.
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return listings;
    return listings.filter(
      (l) =>
        (l.title ?? '').toLowerCase().includes(q) || (l.category ?? '').toLowerCase().includes(q),
    );
  }, [listings, query]);

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent dialogClassName="sm:max-w-md">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{t('messaging:share.listingTitle')}</ResponsiveModalTitle>
          <ResponsiveModalDescription>
            {t('messaging:share.listingSubtitle')}
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        {!isLoading && !error && listings.length > 0 && (
          <div className="relative mb-2">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('messaging:share.searchPlaceholder')}
              className="pl-9"
              aria-label={t('messaging:share.searchPlaceholder')}
            />
          </div>
        )}

        <div className="max-h-[50vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              {t('messaging:share.loading')}
            </div>
          ) : error ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t('messaging:share.error')}
            </p>
          ) : listings.length === 0 ? (
            <div className="py-8 text-center">
              <Tag className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" strokeWidth={1.5} aria-hidden />
              <p className="text-sm font-medium text-foreground">{t('messaging:share.emptyTitle')}</p>
              <Link
                to="/marketplace"
                onClick={() => onOpenChange(false)}
                className="mt-1 inline-block text-sm font-semibold text-foreground underline"
              >
                {t('messaging:share.emptyCta')}
              </Link>
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t('messaging:share.noMatches')}
            </p>
          ) : (
            <ul className="space-y-1">
              {filtered.map((l) => (
                <li key={l.id}>
                  {/* `h-auto` clears Button's default h-10 — this row is sized by
                      its 40px thumbnail plus padding, and a fixed height clips the
                      two-line title. */}
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      onPick(l);
                      onOpenChange(false);
                    }}
                    className="flex h-auto w-full items-center gap-3 rounded-control px-2 py-2 text-left transition-colors hover:bg-accent [&_svg]:text-muted-foreground"
                  >
                    {l.image_urls?.[0] ? (
                      <img
                        src={l.image_urls[0]}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-control object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-muted">
                        <Tag className="h-4 w-4" aria-hidden />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {l.title?.trim() || t('messaging:share.untitled')}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[
                          l.price != null ? `$${l.price}` : null,
                          l.category?.trim() || null,
                          l.status === 'sold' ? t('messaging:share.sold') : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
