import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Heart, MessageCircle, ShieldCheck, ExternalLink, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { InstagramLogo } from '@/components/roommate/SocialLogos';
import { useUniversity } from '@/contexts/UniversityContext';
import { BUSINESS_CATEGORY_BADGE } from './BusinessListingCard';
import type { Tables } from '@/integrations/supabase/types';
import type { Json } from '@/integrations/supabase/types';

type BusinessListing = Tables<'business_listings'>;

interface PackageItem {
  name: string;
  description?: string;
  price?: string;
}

function parsePackages(raw: Json | null): PackageItem[] {
  if (!raw || !Array.isArray(raw)) return [];
  // PackageItem isn't a subtype of Json, so a `p is PackageItem` predicate is
  // invalid; keep the runtime shape check and assert the filtered result.
  return raw.filter(
    (p) =>
      typeof p === 'object' && p !== null && 'name' in p && typeof (p as Record<string, unknown>).name === 'string',
  ) as unknown as PackageItem[];
}

function getInitials(name: string): string {
  return name.charAt(0).toUpperCase();
}

function formatPriceRange(value: string | null): string | null {
  if (!value?.trim()) return null;
  const v = value.trim();
  return /^\d/.test(v) && !v.startsWith('$') ? `$${v}` : v;
}

function ensureUrl(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

interface BusinessDetailModalProps {
  listing: BusinessListing | null;
  open: boolean;
  onClose: () => void;
  isSaved: boolean;
  onToggleSave: () => void;
  isOwner: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onMessage?: () => void;
}

export function BusinessDetailModal({
  listing,
  open,
  onClose,
  isSaved,
  onToggleSave,
  isOwner,
  onEdit,
  onDelete,
  onMessage,
}: BusinessDetailModalProps) {
  const { t } = useTranslation();
  const { university } = useUniversity();
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Escape-to-close, focus-trap/restore, scroll-lock and the backdrop now come
  // from the Dialog primitive below (was a hand-rolled role="dialog" shell).
  if (!open || !listing) return null;

  const priceDisplay = formatPriceRange(listing.price_range);
  const packages = parsePackages(listing.packages);

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        {/* Full-bleed modal: banner runs edge-to-edge with a custom close button,
            so p-0 + the built-in DialogContent close is suppressed ([&>button]:hidden).
            sr-only DialogTitle satisfies Radix's labelling requirement. */}
        <DialogContent
          className="w-full h-full max-h-full max-w-2xl overflow-y-auto rounded-none border-0 bg-card p-0 gap-0 md:h-auto md:max-h-[90vh] md:rounded-xl [&>button]:hidden"
        >
          <DialogTitle className="sr-only">{listing.business_name}</DialogTitle>
          {/* Banner */}
          <div className="relative h-40 w-full overflow-hidden md:rounded-t-xl">
            {listing.banner_image_url ? (
              <img
                src={listing.banner_image_url}
                alt={t('marketplace:business.detail.bannerAlt', { name: listing.business_name })}
                className="h-full w-full object-cover"
              />
            ) : (
              /* Same fix as BusinessListingCard's banner: the `primary` token
                 (light: malachite-800) instead of a raw #03C03C literal, which
                 failed AA and hid from the class-string gates inside an inline
                 style. The seller's own banner_color is data and stays inline. */
              <div
                className={cn('h-full w-full', !listing.banner_color && 'bg-primary')}
                style={listing.banner_color ? { backgroundColor: listing.banner_color } : undefined}
              />
            )}

            {/* Heart */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleSave(); }}
              className="absolute right-[max(0.75rem,env(safe-area-inset-right,0px))] top-[max(0.75rem,env(safe-area-inset-top))] flex h-9 w-9 items-center justify-center rounded-full bg-card/80 backdrop-blur-sm transition-colors hover:bg-card md:right-3 md:top-3"
              aria-label={isSaved ? t('marketplace:business.card.unsaveAria') : t('marketplace:business.card.saveAria')}
            >
              <Heart
                className={cn(
                  'h-5 w-5 transition-colors',
                  isSaved ? 'fill-foreground text-foreground' : 'text-muted-foreground',
                )}
              />
            </button>

            {/* Close */}
            <button
              type="button"
              onClick={onClose}
              className="absolute left-[max(0.75rem,env(safe-area-inset-left,0px))] top-[max(0.75rem,env(safe-area-inset-top))] flex h-9 w-9 items-center justify-center rounded-full bg-card/80 backdrop-blur-sm text-muted-foreground hover:bg-card transition-colors md:left-3 md:top-3"
              aria-label={t('common:actions.close')}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Logo */}
          <div className="relative px-4">
            <div className="absolute -top-8 left-4">
              {listing.logo_url ? (
                <img
                  src={listing.logo_url}
                  alt={listing.business_name}
                  className="h-16 w-16 rounded-full border-4 border-card object-cover bg-card"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-card bg-muted text-foreground font-bold text-xl">
                  {getInitials(listing.business_name)}
                </div>
              )}
            </div>
          </div>

          {/* Body */}
          <div className="px-4 pt-10 pb-[max(1.5rem,env(safe-area-inset-bottom))] space-y-4">
            <div>
              <h2 className="text-xl font-bold text-foreground">{listing.business_name}</h2>
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', BUSINESS_CATEGORY_BADGE)}>
                  {listing.category}
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
                  {/* Tenant-derived — see the note in BusinessListingCard. */}
                  {t('marketplace:badge.verifiedStudent', { school: university.shortName })}
                </span>
              </div>
            </div>

            {/* Owner controls */}
            {isOwner && (onEdit || onDelete) && (
              <div className="flex items-center gap-2">
                {onEdit && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={onEdit}>
                    <Pencil className="h-3.5 w-3.5" />
                    {t('common:actions.edit')}
                  </Button>
                )}
                {onDelete && (
                  <Button variant="outline" size="sm" className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('common:actions.delete')}
                  </Button>
                )}
              </div>
            )}

            <hr className="border-border" />

            {/* Description */}
            {listing.description && (
              <p className="text-sm text-foreground whitespace-pre-wrap">{listing.description}</p>
            )}

            {/* Price */}
            {priceDisplay && (
              <p className="text-sm text-muted-foreground">{priceDisplay}</p>
            )}

            {/* Website */}
            {listing.website_url?.trim() && (
              <a
                href={ensureUrl(listing.website_url)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-foreground hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {listing.website_url.trim()}
              </a>
            )}

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-2">
              {!isOwner && onMessage && (
                <Button
                  // KEEP: primary CTA of this modal (message the business)
                  className="gap-2 bg-malachite-800 hover:bg-malachite-900 text-white w-full sm:w-auto"
                  onClick={onMessage}
                >
                  <MessageCircle className="h-4 w-4" />
                  {t('marketplace:business.detail.messageButton')}
                </Button>
              )}
              {listing.instagram_handle && (
                <Button variant="outline" className="gap-2 w-full sm:w-auto" asChild>
                  <a
                    href={`https://instagram.com/${encodeURIComponent(listing.instagram_handle.replace(/^@/, ''))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <InstagramLogo className="h-4 w-4 text-pink-600" />
                    Instagram
                  </a>
                </Button>
              )}
            </div>

            {/* Packages */}
            {packages.length > 0 && (
              <div className="space-y-3 pt-2">
                <h3 className="text-base font-semibold text-foreground">{t('marketplace:business.detail.packagesTitle')}</h3>
                <div className="grid gap-2">
                  {packages.map((pkg, i) => (
                    <div key={i} className="rounded-lg border border-border bg-muted p-3">
                      <p className="font-medium text-sm text-foreground">{pkg.name}</p>
                      {pkg.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{pkg.description}</p>
                      )}
                      {pkg.price && (
                        <p className="text-sm font-medium text-foreground mt-1">{pkg.price}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('marketplace:business.detail.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('marketplace:business.detail.deleteDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirmDelete(false);
                onDelete?.();
              }}
            >
              {t('common:actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
