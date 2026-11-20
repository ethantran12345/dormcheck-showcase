import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, MapPin, MessageCircle, User } from 'lucide-react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { RoommateCard, type RoommateProfileRow } from '@/components/roommate/RoommateCard';
import { ServicePostSummary } from '@/components/marketplace/ServicePostSummary';
import { formatPaymentMethodLabel } from '@/lib/marketplacePaymentMethods';
import { formatSubleaseRange, subleaseTrustFields, type SubleaseTerms } from '@/lib/subleases';
import { isServicePostType, type PostType, type ServiceCategory } from '@/lib/postTypes';
import { cn } from '@/lib/utils';

/** Label row for marketplace listing live preview */
export function FormPreviewLabel() {
  const { t } = useTranslation();
  return (
    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('marketplace:preview.label')}</p>
  );
}

function formatMoney(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('$')) return trimmed;
  return `$${trimmed}`;
}

/**
 * The headline, per type. A sublease has no title INPUT — its headline is its
 * building (subleaseTitle() stores it as the row's title), so the preview reads
 * the building the student is typing rather than an empty item title.
 */
function previewTitle(
  listing: GeneralMarketplacePreviewData,
  t: (key: string) => string,
): string {
  const postType = listing.postType ?? 'item';
  if (postType === 'sublease') {
    return (
      listing.subleaseTerms?.building_name?.trim() ||
      listing.title.trim() ||
      t('marketplace:preview.subleaseTitleFallback')
    );
  }
  if (isServicePostType(postType)) {
    return listing.title.trim() || t('marketplace:preview.serviceTitleFallback');
  }
  return listing.title.trim() || t('marketplace:preview.itemTitleFallback');
}

/**
 * Price for the large detail preview: "Free" at $0, a placeholder when empty.
 * The placeholder names the field the form actually asks for — a sublease asks
 * for monthly rent, not a price.
 */
function formatPreviewPrice(value: string, t: (key: string) => string, isSublease = false) {
  const trimmed = value.trim().replace(/^\$/, '');
  if (!trimmed) {
    return t(isSublease ? 'marketplace:sublease.rent' : 'marketplace:preview.pricePlaceholder');
  }
  if (parseFloat(trimmed) === 0) return t('marketplace:preview.free');
  return formatMoney(value);
}

export interface GeneralMarketplacePreviewData {
  title: string;
  category: string;
  price: string;
  condition: string;
  meetup: string;
  coverImageUrl: string | null;
  /** Extra fields surfaced only in the large FB-style detail preview. */
  description?: string;
  negotiable?: boolean;
  paymentMethods?: string[];
  sellerName?: string;
  /**
   * Which post type is being composed. The preview is a promise about what the
   * post will look like, so it follows the SAME schema the form does: an
   * item-shaped preview on a sublease ("Condition", "Category") or on a service
   * request (the literal word "Price") promises fields the row will never carry.
   * Defaults to `item`, which is byte-for-byte the preview that shipped before.
   */
  postType?: PostType;
  /** Structured sublease terms — rendered instead of condition/category. */
  subleaseTerms?: SubleaseTerms;
  /** Structured service block — rendered instead of any price at all. */
  service?: {
    category?: ServiceCategory | string | null;
    date?: string | null;
    durationMinutes?: number | null;
    location?: string | null;
    notes?: string | null;
  };
}

export interface RoommateProfilePreviewData {
  displayName: string;
  major: string;
  gradeLevel: string;
  graduationYear: string;
  bio: string;
  dealbreakers: string[];
  photoUrls: string[];
  instagramUsername?: string;
  snapchatUsername?: string;
}

export function MarketplaceListingPreviewBlock({
  listing,
}: {
  listing: GeneralMarketplacePreviewData;
}) {
  return (
    <div className="space-y-1.5">
      <FormPreviewLabel />
      <ItemCardPreview listing={listing} />
    </div>
  );
}

/** Empty state shown in the desktop preview canvas before the form has content. */
export function MarketplaceListingPreviewEmpty() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2 px-8 text-center">
      <p className="text-base font-semibold text-foreground">{t('marketplace:preview.emptyTitle')}</p>
      <p className="max-w-xs text-sm text-muted-foreground">{t('marketplace:preview.emptyBody')}</p>
    </div>
  );
}

/**
 * Large, Facebook-Marketplace-style preview: a two-pane card that fills the
 * composer's right-hand canvas - big photo pane on the left, a details/seller
 * panel on the right (Title / Price / Listed / Details / Description / Seller /
 * Message). Renders placeholders (not an empty screen) before the form has
 * content, exactly like Facebook.
 */
export function MarketplaceListingDetailPreview({
  listing,
}: {
  listing: GeneralMarketplacePreviewData;
}) {
  const { t, i18n } = useTranslation();
  const postType = listing.postType ?? 'item';
  const isService = isServicePostType(postType);
  const isSublease = postType === 'sublease';
  const title = previewTitle(listing, t);
  const priceEntered = listing.price.trim() !== '';
  const priceLabel = formatPreviewPrice(listing.price, t, isSublease);
  const payments = (listing.paymentMethods ?? [])
    .map((m) => formatPaymentMethodLabel(m))
    .filter(Boolean)
    .join(', ');
  // A sublease's structured terms, rendered exactly as the card renders them
  // (same helper) so the preview is not a second, drifting description of the row.
  const subleaseFields = isSublease
    ? subleaseTrustFields(listing.subleaseTerms ?? {}, t, i18n.language)
    : [];
  const subleaseRange = isSublease
    ? formatSubleaseRange(
        listing.subleaseTerms?.sublease_start,
        listing.subleaseTerms?.sublease_end,
        i18n.language,
      )
    : '';
  const hasDetails =
    (!isService && !isSublease) ||
    subleaseFields.length > 0 ||
    Boolean(payments) ||
    (isService && Boolean(listing.service?.notes?.trim())) ||
    (!isService && Boolean(listing.meetup.trim()));

  return (
    <div className="flex h-full min-h-[420px] w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-raised md:flex-row">
      {/* Photo pane. Absent entirely for a service post: the schema asks for no
          photo, so an empty photo canvas would promise one. */}
      {!isService && (
      <div className="relative min-h-[240px] flex-1 bg-muted">
        {listing.coverImageUrl ? (
          <>
            <img
              src={listing.coverImageUrl}
              alt={t(isSublease ? 'marketplace:preview.subleaseAlt' : 'marketplace:preview.itemAlt')}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-card/85 p-2 shadow-raised">
              <ChevronLeft className="h-4 w-4 text-foreground" />
            </div>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-card/85 p-2 shadow-raised">
              <ChevronRight className="h-4 w-4 text-foreground" />
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
            <p className="text-base font-semibold text-foreground">{t('marketplace:preview.emptyTitle')}</p>
            <p className="max-w-xs text-sm text-muted-foreground">{t('marketplace:preview.emptyBody')}</p>
          </div>
        )}
      </div>
      )}

      {/* Details pane */}
      <div
        className={cn(
          'flex w-full flex-col border-t border-border md:border-l md:border-t-0',
          isService ? 'md:flex-1 md:border-l-0' : 'shrink-0 md:w-[320px]',
        )}
      >
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="space-y-1">
            <p
              className={cn(
                'line-clamp-2 text-lg font-semibold',
                listing.title.trim() || (isSublease && listing.subleaseTerms?.building_name?.trim())
                  ? 'text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              {title}
            </p>
            {/* NO PAYMENTS: a service post has no price line at all — not "Price",
                not "Free", not a placeholder. The structured task summary takes
                the slot, exactly as the real card does. */}
            {isService ? (
              <ServicePostSummary
                serviceCategory={listing.service?.category ?? null}
                serviceDate={listing.service?.date ?? null}
                serviceDurationMinutes={listing.service?.durationMinutes ?? null}
                serviceLocation={listing.service?.location ?? null}
                className="pt-0.5"
              />
            ) : (
              <p
                className={cn(
                  'text-2xl font-bold',
                  priceEntered ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {priceLabel}
              </p>
            )}
            {isSublease && subleaseRange ? (
              <p className="text-sm text-muted-foreground">{subleaseRange}</p>
            ) : null}
            <p className="text-xs text-muted-foreground">{t('marketplace:preview.listedJustNow')}</p>
          </div>

          {/* Details is a heading over rows; with no rows it is a promise of
              structure the type does not have. An item always has condition +
              category, so this is unchanged for the item flow. */}
          {hasDetails && (
          <div className="space-y-1.5 border-t border-border pt-4">
            <p className="text-sm font-semibold text-foreground">{t('marketplace:preview.detailsLabel')}</p>
            {/* Condition and Category are ITEM facts. A room has neither, and a
                request for a hand with a task has neither. */}
            {!isService && !isSublease ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {t('marketplace:preview.conditionLabel', {
                    value: listing.condition.trim() || 'Good',
                  })}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t('marketplace:preview.categoryLabel', {
                    value: listing.category.trim() || 'Other',
                  })}
                </p>
              </>
            ) : null}
            {subleaseFields.map((field) => (
              <p key={field.label} className="text-sm text-muted-foreground">
                {field.label}: {field.value}
              </p>
            ))}
            {listing.negotiable && !isService ? (
              <p className="text-sm text-muted-foreground">{t('marketplace:preview.negotiableLabel')}</p>
            ) : null}
            {payments ? (
              <p className="text-sm text-muted-foreground">
                {t('marketplace:preview.paymentLabel', { value: payments })}
              </p>
            ) : null}
            {/* The description promise belongs to the only type with a
                description box. A sublease's prose lives in house rules and is
                never a headline; a service post's lives in its note. */}
            {isService ? (
              listing.service?.notes?.trim() ? (
                <p className="whitespace-pre-line pt-1 text-sm text-foreground/90">
                  {listing.service.notes.trim()}
                </p>
              ) : null
            ) : isSublease ? null : (
              <p className="whitespace-pre-line pt-1 text-sm text-foreground/90">
                {listing.description?.trim() || t('marketplace:preview.descriptionFallback')}
              </p>
            )}
            {!isService && listing.meetup.trim() ? (
              <p className="flex items-center gap-1 pt-1 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                {listing.meetup.trim()}
              </p>
            ) : null}
          </div>
          )}

          <div className="space-y-2 border-t border-border pt-4">
            {/* Nobody is selling anything on a service post, so it does not say
                "Seller information" — same block, honest label. */}
            <p className="text-sm font-semibold text-foreground">
              {t(isService ? 'marketplace:preview.posterInfo' : 'marketplace:preview.sellerInfo')}
            </p>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <User className="h-4 w-4" />
              </div>
              <p className="text-sm font-medium text-foreground">
                {listing.sellerName?.trim() || t('marketplace:preview.sellerFallback')}
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-border p-3">
          <div className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-muted py-2 text-sm font-medium text-muted-foreground">
            <MessageCircle className="h-4 w-4" />
            {t('marketplace:preview.messageButton')}
          </div>
        </div>
      </div>
    </div>
  );
}

export function RoommateProfilePreviewBlock({
  listing
}: {
  listing: RoommateProfilePreviewData;
}) {
  return (
    <div className="space-y-1.5">
      <FormPreviewLabel />
      <RoommateCardPreview listing={listing} />
    </div>
  );
}

function PreviewPhoto({
  src,
  alt,
  showArrows = false,
}: {
  src: string | null;
  alt: string;
  showArrows?: boolean;
}) {
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-t-xl bg-muted">
      {src ? (
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      ) : null}
      {showArrows && (
        <>
          <div className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-card/85 p-2 shadow-raised">
            <ChevronLeft className="h-4 w-4 text-foreground" />
          </div>
          <div className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-card/85 p-2 shadow-raised">
            <ChevronRight className="h-4 w-4 text-foreground" />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The compact (mobile) preview card. Mirrors the real feed card in
 * MarketplaceTab: price-or-service-summary first, then the headline, then the
 * one line underneath (meetup for an item, the date range for a sublease).
 */
function ItemCardPreview({ listing }: { listing: GeneralMarketplacePreviewData }) {
  const { t, i18n } = useTranslation();
  const postType = listing.postType ?? 'item';
  const isService = isServicePostType(postType);
  const isSublease = postType === 'sublease';
  const subline = isSublease
    ? formatSubleaseRange(
        listing.subleaseTerms?.sublease_start,
        listing.subleaseTerms?.sublease_end,
        i18n.language,
      )
    : listing.meetup.trim()
      ? t('marketplace:preview.meetupLabel', { value: listing.meetup.trim() })
      : '';
  return (
    <Card className="overflow-hidden border border-border bg-card shadow-raised">
      {!isService && (
        <PreviewPhoto
          src={listing.coverImageUrl}
          alt={t(isSublease ? 'marketplace:preview.subleaseAlt' : 'marketplace:preview.itemAlt')}
        />
      )}
      <CardContent className="space-y-2 p-3">
        {/* NO PAYMENTS: no price line on a service post, in the card preview
            either — the structured task summary takes the slot. */}
        {isService ? (
          <ServicePostSummary
            compact
            serviceCategory={listing.service?.category ?? null}
            serviceDate={listing.service?.date ?? null}
            serviceDurationMinutes={listing.service?.durationMinutes ?? null}
            serviceLocation={listing.service?.location ?? null}
          />
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-foreground">{formatMoney(listing.price) || '$0'}</span>
            {!isSublease && (
              <span className="capitalize text-xs text-muted-foreground">
                {listing.category.trim() || 'Other'}
              </span>
            )}
          </div>
        )}
        <p className="line-clamp-2 text-sm font-medium text-foreground">
          {previewTitle(listing, t)}
        </p>
        {!isService && !isSublease ? (
          <p className="text-xs text-muted-foreground">
            {t('marketplace:preview.conditionLabel', { value: listing.condition.trim() || 'Good' })}
          </p>
        ) : null}
        {subline ? (
          <p className="line-clamp-1 text-xs text-muted-foreground">{subline}</p>
        ) : null}
      </CardContent>
      <CardFooter className="p-3 pt-0">
        <div className="flex w-full items-center justify-around border-t border-border pt-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground">
            <MessageCircle className="h-5 w-5" />
          </div>
        </div>
      </CardFooter>
    </Card>
  );
}

function RoommateCardPreview({ listing }: { listing: RoommateProfilePreviewData }) {
  const { t } = useTranslation();
  const graduationYearNum = listing.graduationYear.trim()
    ? parseInt(listing.graduationYear.trim(), 10)
    : null;
  const previewProfile: RoommateProfileRow = {
    id: 'preview-roommate-card',
    full_name: listing.displayName.trim() || t('marketplace:preview.roommateNameFallback'),
    major: listing.major.trim() || null,
    grade_level: listing.gradeLevel.trim() || null,
    graduation_year: graduationYearNum && !Number.isNaN(graduationYearNum) ? graduationYearNum : null,
    bio: listing.bio.trim(),
    dealbreakers: listing.dealbreakers,
    instagram_username: listing.instagramUsername?.trim() || null,
    snapchat_username: listing.snapchatUsername?.trim() || null,
    profile_photos: listing.photoUrls.length > 0 ? listing.photoUrls : null,
  };
  return (
    <RoommateCard
      profile={previewProfile}
      isOwnProfile={false}
    />
  );
}
