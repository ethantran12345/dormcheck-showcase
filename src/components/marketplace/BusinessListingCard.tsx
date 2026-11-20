import { Heart, Pencil, Trash2, MessageCircle, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { InstagramLogo } from '@/components/roommate/SocialLogos';
import { useUniversity } from '@/contexts/UniversityContext';
import { getUniversityById } from '@/config/universities';
import type { Tables } from '@/integrations/supabase/types';
import { ListingImage } from '@/components/ui/listing-image';

type BusinessListing = Tables<'business_listings'>;

/**
 * One neutral badge for every business category (2026-08-02 design decision).
 *
 * This replaced a 20-entry map of nine hues (blue / pink / amber / purple /
 * indigo / violet / sky / rose / orange). The hues encoded nothing: several
 * categories shared a color, two already fell back to neutral, and no surface
 * ever asked the user to tell categories apart at a glance — the category is
 * right there as text. Three of the hues were cool, against the warm-stone
 * neutral system, and none were tokens, so `lint:colors` passed them while the
 * palette drifted. A real categorical ramp gets built when a surface has a real
 * requirement for one; until then the badge is a label, not a color code.
 * See docs/DECISIONS.md 2026-08-02.
 */
export const BUSINESS_CATEGORY_BADGE = 'bg-muted text-muted-foreground';

function getInitials(name: string): string {
  return name.charAt(0).toUpperCase();
}

function formatPriceRange(value: string | null): string | null {
  if (!value?.trim()) return null;
  const v = value.trim();
  return /^\d/.test(v) && !v.startsWith('$') ? `$${v}` : v;
}

interface BusinessListingCardProps {
  listing: BusinessListing;
  isSaved: boolean;
  onToggleSave: () => void;
  currentUserId: string | null;
  onEdit?: () => void;
  onDelete?: () => void;
  onClick: () => void;
  onMessage?: () => void;
  statusBadge?: 'pending' | 'live' | null;
}

export function BusinessListingCard({
  listing,
  isSaved,
  onToggleSave,
  currentUserId,
  onEdit,
  onDelete,
  onClick,
  onMessage,
  statusBadge,
}: BusinessListingCardProps) {
  const { t } = useTranslation();
  const { university: viewerUniversity } = useUniversity();
  const isOwner = currentUserId === listing.user_id;
  const priceDisplay = formatPriceRange(listing.price_range);
  // The listing's own school, falling back to the viewer's only when the row
  // predates the university_id backfill (never when it names another tenant).
  const sellerSchool = listing.university_id
    ? getUniversityById(listing.university_id)?.shortName
    : viewerUniversity.shortName;

  return (
    /* Click-to-open stays on the container for mouse users; keyboard and AT
       activation live on the business-name button below. This container used to
       be role="button" tabIndex={0}, which nested the save, edit, delete,
       message and Instagram controls INSIDE an interactive element — invalid
       ARIA, and its keydown handler competed with theirs (Space on a focused
       inner button both activated it and re-fired the card). Same shape
       DormCard.tsx already uses; focus-within draws the ring so the card still
       reads as focused when any control inside it is. */
    <div
      onClick={onClick}
      role="presentation"
      className="rounded-card border border-border bg-card shadow-raised hover:shadow-overlay transition-all cursor-pointer overflow-hidden focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
    >
      {/* Banner */}
      <div className="relative aspect-[3/1] w-full overflow-visible">
        {listing.banner_image_url ? (
          <ListingImage
            src={listing.banner_image_url}
            alt=""
            kind="business"
            thumbWidth={900}
            aspectClassName="absolute inset-0 h-full w-full"
          />
        ) : (
          /* The fallback is the `primary` token (light: malachite-800), not a raw
             #03C03C literal — the hex both failed AA for anything white laid over
             it and, living in an inline style, was invisible to the class-string
             gates. A seller's own banner_color is data, so it stays inline; with
             no banner_color there is no color to compute and the token class wins. */
          <div
            className={cn(
              'absolute inset-0 h-full w-full',
              !listing.banner_color && 'bg-primary',
            )}
            style={listing.banner_color ? { backgroundColor: listing.banner_color } : undefined}
          />
        )}

        {/* Heart */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={(e) => { e.stopPropagation(); onToggleSave(); }}
          className={cn(
            'absolute top-2 right-2 z-10 h-8 w-8 rounded-full bg-card/80 backdrop-blur-sm hover:bg-card',
            // Tint stated as a descendant rule on the Button, never as a plain text-*
            // the glyph inherits: the primitive's own `[&_svg]:text-current` outranks a
            // utility on the icon, and an inherited value resolves to whatever the
            // button happens to be (DECISIONS 2026-07-27). Only `fill-*` stays on the glyph.
            isSaved ? '[&_svg]:text-foreground' : '[&_svg]:text-muted-foreground',
          )}
          aria-label={isSaved ? t('marketplace:business.card.unsaveAria') : t('marketplace:business.card.saveAria')}
        >
          <Heart className={cn('transition-colors', isSaved && 'fill-foreground')} />
        </Button>

        {/* Logo - overlaps bottom edge of banner */}
        <div className="absolute bottom-0 left-4 z-10 translate-y-1/2">
          {listing.logo_url ? (
            <img
              src={listing.logo_url}
              alt={listing.business_name}
              className="h-12 w-12 rounded-full object-cover bg-card ring-4 ring-card"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-foreground font-bold text-lg ring-4 ring-card">
              {getInitials(listing.business_name)}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-3 pt-10 pb-3 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {/* The card's own activation target. A real button, so Enter and
                Space work natively and AT announces one control per action
                instead of a button containing five. */}
            <h3 className="font-bold text-foreground text-sm line-clamp-1">
              <Button
                type="button"
                variant="link"
                onClick={(e) => {
                  e.stopPropagation();
                  onClick();
                }}
                /* Overrides make the primitive disappear into the h3 (inherit
                   its size, keep its weight and colour, no link underline).
                   What we gain is the focus ring: the raw button this replaced
                   set `focus-visible:outline-none` on the card's own keyboard
                   activation target. Mirrors RoommateCard. */
                className="h-auto max-w-full justify-start p-0 text-left text-[length:inherit] font-bold text-foreground no-underline hover:no-underline"
              >
                <span className="block truncate">{listing.business_name}</span>
              </Button>
            </h3>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <span className={cn('inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-medium', BUSINESS_CATEGORY_BADGE)}>
                {listing.category}
              </span>
              {statusBadge === 'pending' && (
                <span className="inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700">
                  {t('marketplace:business.card.pendingReview')}
                </span>
              )}
              {statusBadge === 'live' && (
                <span className="inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                  {t('marketplace:business.card.live')}
                </span>
              )}
            </div>
          </div>
          {isOwner && (onEdit || onDelete) && (
            <div className="flex items-center gap-1 shrink-0">
              {onEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={(e) => { e.stopPropagation(); onEdit(); }}
                  className="h-7 w-7 rounded-full hover:bg-accent [&_svg]:size-3.5 [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground"
                  aria-label={t('common:actions.edit')}
                >
                  <Pencil />
                </Button>
              )}
              {onDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="h-7 w-7 rounded-full hover:bg-destructive/10 [&_svg]:size-3.5 [&_svg]:text-muted-foreground hover:[&_svg]:text-destructive"
                  aria-label={t('common:actions.delete')}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          )}
        </div>

        {/* SELLER-derived, not viewer-derived. This key used to be a separate
            `business.card.verifiedStudent` reading "Verified Pitt Student",
            which was false on CMU and every future tenant — on the row that
            states the product's central claim. That was fixed by reading the
            VIEWER's shortName, which was correct only while RLS guaranteed
            seller and viewer shared a university. The shared Pittsburgh
            marketplace group (migration 20260911000000) removes that guarantee,
            so the school now comes off the listing itself. A listing whose
            university is not in this bundle's registry drops the school word
            rather than borrowing the viewer's.
            (Still open, and still deliberately not done in a correctness fix:
            this markup duplicates VerifiedStudentBadge at a different icon
            weight — h-3/strokeWidth 1.75 vs h-3.5 — and should just render it.) */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <ShieldCheck className="h-3 w-3 text-muted-foreground" strokeWidth={1.75} />
          {sellerSchool
            ? t('marketplace:badge.verifiedStudent', { school: sellerSchool })
            : t('marketplace:badge.verifiedStudentGeneric')}
        </div>

        {listing.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{listing.description}</p>
        )}

        {/* Price outranks the description now (design-audit A-8). These two had
            byte-identical classes — `text-xs text-muted-foreground` — so the
            single most scanned attribute on a marketplace card was tied for
            last with the blurb. Foreground + semibold + tabular-nums, matching
            how price is already set in the My Home marketplace band. */}
        {priceDisplay && (
          <p className="text-sm font-semibold tabular-nums text-foreground">{priceDisplay}</p>
        )}

        {/* Actions */}
        {!isOwner && (
          <div className="flex items-center gap-2 pt-1.5 border-t border-border mt-2" onClick={(e) => e.stopPropagation()} role="presentation">
            {onMessage && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onMessage}
                className="h-8 w-8 rounded-full hover:bg-muted [&_svg]:text-muted-foreground"
                aria-label={t('marketplace:business.card.messageAria')}
              >
                <MessageCircle />
              </Button>
            )}
            {listing.instagram_handle && (
              <a
                href={`https://instagram.com/${encodeURIComponent(listing.instagram_handle.replace(/^@/, ''))}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-8 w-8 items-center justify-center rounded-full text-pink-600 hover:bg-pink-50 transition-colors"
                /* The key is "Instagram @{{handle}}" and handles are stored WITH
                   the leading @, so this announced "Instagram @@niabraids".
                   Strip it the same way the href already does. */
                aria-label={t('marketplace:business.card.instagramAria', {
                  handle: listing.instagram_handle.replace(/^@/, ''),
                })}
              >
                <InstagramLogo className="h-4 w-4" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
