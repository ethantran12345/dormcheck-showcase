import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { listItemVariants } from '@/lib/motion';
import { Package, Search, Upload, Lock, Trash2, SlidersHorizontal, Pencil, Heart, Plus, BellRing } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ListingImage } from '@/components/ui/listing-image';
import { MarketplaceAlertsDialog } from '@/components/marketplace/MarketplaceAlertsDialog';
// Value import goes through the lazy wrapper so the detail view is its own chunk;
// the type import is erased at compile time and pulls nothing into this one.
import { ListingDetailModal, ensureListingDetail, prefetchListingDetail } from './ListingDetailModalLazy';
import { canViewTransition, LISTING_PHOTO_TRANSITION_NAME, runViewTransition } from '@/lib/viewTransition';
import type { ListingZoomOrigin } from './ListingDetailModal';
import { usePrefetchOnIntent } from '@/hooks/usePrefetchOnIntent';
import { MarketplaceSafetyBanner } from '@/components/marketplace/MarketplaceSafetyBanner';
import { supabase } from '@/integrations/supabase/client';
import { withListingContacts, withListingContact } from '@/lib/marketplaceContact';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { MovingBoxIllustration } from '@/components/illustrations/DormIllustrations';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';




import { FROSTED_OVERLAY_CLASS } from '@/components/ui/drawer';
import { AdaptiveOverlay, AdaptiveOverlayContent } from '@/components/ui/adaptive-overlay';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Capacitor } from '@capacitor/core';
import { BookmarkToggle } from '@/components/app/BookmarkToggle';
import { useIsMobile } from '@/hooks/use-mobile';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';


import { cn } from '@/lib/utils';
import { safeImageSrc } from '@/lib/sanitize';
import { useAuth } from '@/hooks/useAuth';
import { useAdminUniversitySilo } from '@/contexts/AdminUniversityContext';
import { useUniversity } from '@/contexts/UniversityContext';
import { getUniversityById } from '@/config/universities';
import { useBlockedUserIds } from '@/hooks/useBlockedUsers';
import { useSetupMode } from '@/contexts/SetupModeContext';
import { useModalOverlay } from '@/contexts/ModalOverlayContext';
import { useHousingSaved } from '@/contexts/HousingSavedContext';
import {
  useMyListings,
  MARKETPLACE_CATEGORIES_FILTER,
  type ListingForm,
} from '@/hooks/useMyListings';
import { minAvailablePrice } from '@/lib/listingItems';
import { ListingTrustChrome } from '@/components/marketplace/ListingTrustChrome';
import { PostTypeFilterChips } from '@/components/marketplace/PostTypeFilterChips';
import { MarketplaceScopeChips } from '@/components/marketplace/MarketplaceScopeChips';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import {
  DEFAULT_POST_TYPE,
  feedStatusesFor,
  isServicePostType,
  type PostType,
  type ServiceCategory,
} from '@/lib/postTypes';
import { ServiceCategoryChips } from '@/components/marketplace/ServiceCategoryChips';
import { ServicePostSummary } from '@/components/marketplace/ServicePostSummary';
import { isServiceListing } from '@/lib/servicePosts';
import { formatSubleaseRange, subleaseTrustFields } from '@/lib/subleases';
import { ReportContentDialog } from '@/components/ReportContentDialog';
import { SignInPromptDialog } from '@/components/auth/SignInPromptDialog';
import { SneakPeekBlurWall } from '@/components/ui/sneak-peek-blur-wall';
import { StudentBusinessesSection } from '@/components/marketplace/StudentBusinessesSection';
import { SHOW_STUDENT_BUSINESSES } from '@/lib/featureFlags';
import { useMessageSeller } from '@/hooks/useMessageSeller';
import { useDeleteListing } from '@/hooks/useDeleteListing';

export type { MarketplaceListing } from '@/types/marketplace';
import type { MarketplaceListing } from '@/types/marketplace';

export const MARKETPLACE_HEADLINES: Record<string, { title: string; subtitle: string }> = {
  'buy-sell': {
    title: 'Student Market',
    subtitle: 'Buy and sell dorm essentials with verified students',
  },
  businesses: {
    title: 'Student Businesses',
    subtitle: 'Support student-run businesses on your campus',
  },
};

function formatPrice(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}


/** Heart like button - white circle, pink when saved. */
function HeartLikeButton({ isLiked, onLike }: { isLiked?: boolean; onLike: () => void }) {
  const [pulseKey, setPulseKey] = useState(0);
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPulseKey((k) => k + 1);
    onLike();
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      className="absolute top-2 right-2 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-raised transition-colors hover:bg-muted"
      aria-label={isLiked ? 'Remove from saved' : 'Save'}
    >
      <motion.span
        key={pulseKey}
        initial={false}
        animate={{ scale: [1, 1.25, 1, 1.15, 1] }}
        transition={{ duration: 0.4 }}
        className="inline-flex"
      >
        <Heart
          className={cn(
            'w-4 h-4',
            isLiked ? 'text-[#FF6B6B] fill-[#FF6B6B]' : 'text-muted-foreground fill-none stroke-muted-foreground stroke-[1.5]'
          )}
          strokeWidth={isLiked ? 0 : 1.5}
        />
      </motion.span>
    </button>
  );
}

/** Card image: first photo only; overlays for save, edit, delete */
function ListingCardImage({
  listing,
  onDelete,
  onEdit,
  onLike,
  canDelete,
  canEdit,
  canLike,
  isLiked,
  deleting,
}: {
  listing: MarketplaceListing;
  onDelete?: () => void;
  onEdit?: () => void;
  onLike?: () => void;
  canDelete?: boolean;
  canEdit?: boolean;
  canLike?: boolean;
  isLiked?: boolean;
  deleting?: boolean;
}) {
  const rawUrls = listing.image_urls?.length ? listing.image_urls.slice(0, 1) : [];
  const sanitized = rawUrls.map((u) => safeImageSrc(u)).filter((u): u is string => u != null);
  // No photo (or every source fails) renders ListingImage's designed fallback,
  // not a grey /placeholder.svg box.
  const original = sanitized[0] ?? null;
  // Grid cards render ~180px wide; ListingImage serves a 400px transform (2x retina)
  // instead of the multi-MB original, degrading thumb -> original -> placeholder, and
  // crossfades it over a ~20px blur of the same photo. The aspect-square well means
  // the grid's geometry is settled before any of those bytes arrive.
  // Warm the listing-detail chunk on intent — hovering this card on the web, or
  // the card scrolling into view on a phone. The well is the per-card anchor;
  // prefetchChunk dedupes, so a feed of 40 cards issues one request.
  const intent = usePrefetchOnIntent(prefetchListingDetail);
  return (
    <ListingImage
      src={original}
      alt={listing.title}
      kind={
        listing.is_sublease || listing.post_type === 'sublease'
          ? 'sublease'
          : listing.post_type === 'request_help' || listing.post_type === 'offer_help'
            ? 'service'
            : 'item'
      }
      thumbWidth={400}
      quality={70}
      aspectClassName="aspect-square"
      className="rounded-t-xl"
      wellRef={(node) => {
        intent.ref(node);
        // Lets openListing / closeListing find THIS card's photo for the
        // shared-element view transition into and out of the detail view.
        if (node) node.dataset.listingPhoto = listing.id;
      }}
      onPointerEnter={intent.onPointerEnter}
      onFocus={intent.onFocus}
    >
      {canLike && onLike && <HeartLikeButton isLiked={isLiked} onLike={onLike} />}
      {canDelete && onDelete && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          disabled={deleting}
          className="absolute top-2 right-2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-card/70 backdrop-blur-md shadow-raised border border-border/60 text-foreground hover:bg-red-50 hover:text-red-600 hover:border-red-100 transition-colors z-10"
          aria-label="Delete listing"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
      {canEdit && onEdit && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className={cn('absolute top-2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-card/70 backdrop-blur-md shadow-raised border border-border/60 text-foreground hover:bg-accent hover:text-foreground hover:border-border transition-colors z-10', canDelete ? 'right-12' : 'right-2')}
          aria-label="Edit listing"
        >
          <Pencil className="w-4 h-4" />
        </button>
      )}
    </ListingImage>
  );
}


/**
 * One definition of the feed's grid geometry, shared by the real grid and its
 * skeleton. Two copies of these column/gap classes is exactly how a skeleton
 * drifts out of alignment with the content it stands in for.
 */
const LISTING_GRID_CLASS =
  'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 sm:gap-4';

/**
 * Placeholder grid that occupies the EXACT box a loaded card will.
 *
 * Every dimension here is copied from the real card rather than eyeballed:
 * the `aspect-square` image well, the `p-2 space-y-0.5` body, and the two
 * reserved text slots (`min-h-[2.25rem]` two-line title, `min-h-[1rem]` location)
 * that already exist to keep loaded cards a uniform height. Because the card's
 * height is fully determined by those reservations, a skeleton that repeats them
 * is the same height as the card that replaces it — which is what makes the
 * swap score ~0 CLS instead of reflowing the whole feed.
 */
function ListingGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className={LISTING_GRID_CLASS} aria-hidden="true" data-testid="listing-grid-skeleton">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex h-full flex-col rounded-xl border border-border bg-card shadow-raised overflow-hidden"
        >
          <Skeleton className="aspect-square w-full rounded-none" />
          <div className="flex flex-1 flex-col p-2 space-y-0.5">
            {/* Price row: text-sm/leading-5 → exactly h-5. */}
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-5 w-14" />
            </div>
            <div className="min-h-[2.25rem]">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="mt-1 h-3.5 w-2/3" />
            </div>
            <div className="min-h-[1rem]">
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const CATEGORY_ALL = 'All' as const;
type CategoryFilter = typeof CATEGORY_ALL | (typeof MARKETPLACE_CATEGORIES_FILTER)[number];

type MarketplaceSection = 'general' | 'businesses';

const SORT_NEWEST = 'newest' as const;
const SORT_PRICE_LOW = 'price-low' as const;
const SORT_PRICE_HIGH = 'price-high' as const;
type SortOption = typeof SORT_NEWEST | typeof SORT_PRICE_LOW | typeof SORT_PRICE_HIGH;

const MARKETPLACE_LISTINGS_QUERY_KEY = ['marketplace_listings'] as const;

/** Dual-handle price range bounds. Max sits at "$500+" (unbounded above). */
const PRICE_MIN = 0;
const PRICE_MAX = 500;
const PRICE_STEP = 5;

/** Quick price-band chips (mobile); each sets the range [0, max]. */
const PRICE_BANDS: { label: string; max: number }[] = [
  { label: 'Any price', max: PRICE_MAX },
  { label: 'Under $25', max: 25 },
  { label: 'Under $100', max: 100 },
  { label: 'Under $300', max: 300 },
];
const MAX_ACTIVE_LISTINGS = 15;

/** Feed reach: your own school, or every school sharing your marketplace group. */
export type MarketplaceScope = 'school' | 'group';

export interface MarketplaceFilters {
  categoryFilter: string;
  minPrice: number;
  maxPrice: number;
  /** When set, restrict results to a single owner's listings (shared context). */
  ownerUserId: string | null;
  /** When set, restrict to listings the user saved (IDs from saved_items). */
  showSavedOnlyListingIds: string[] | null;
  /** Tenant scope: only listings from this university (defense in depth with RLS). */
  universityId: string;
  /**
   * How wide the feed reaches.
   *
   * `'school'` (the default, and what every caller got before the shared
   * Pittsburgh marketplace) keeps the explicit `university_id` filter — defense
   * in depth with RLS. `'group'` drops the client filter and lets RLS decide,
   * which returns the caller's own school plus any school sharing its
   * `universities.marketplace_group` (migration 20260911000000).
   *
   * Widening is deliberately opt-in and defaults to the narrow value: a caller
   * that forgets this field gets the old, isolated behaviour, never a silent
   * cross-tenant widening.
   */
  scope?: MarketplaceScope;
  /** Which post type the feed's chip row is showing (PRD §5 Phase 2). */
  postType: PostType;
  /**
   * Narrow a service feed to one task category. `null` (the default) is every
   * category, which is what a caller that never sets it gets. Ignored for
   * non-service post types, which carry no `service_category` at all.
   */
  serviceCategory?: ServiceCategory | null;
}

// verified_at (migration 20260712140000) and original_price (20260719140000)
// are newer columns that may not yet be granted/present on prod. Bundle them
// behind one flag and retry without them on a column/permission error (42703/
// 42501) so dev-against-prod keeps rendering the market before the migration lands.
const LISTING_COLUMNS = (withExtended: boolean) =>
  `id, user_id, university_id, title, description, price, category, image_urls, created_at, status, ${withExtended ? 'verified_at, original_price, ' : ''}condition, meetup_location, price_negotiable, payment_methods, show_instagram, show_snapchat, show_phone, post_type, service_category, service_date, service_duration_minutes, service_location, service_notes, claimed_by, is_sublease, sublease_start, sublease_end, building_name, included_utilities, is_furnished, has_parking, gender_preference, house_rules, additional_rules, profiles:public_profiles(full_name), items:marketplace_listing_items(id, listing_id, name, price, status, x, y, photo_index)`;

const MARKETPLACE_PAGE_SIZE = 50;
type MarketplaceCursor = { createdAt: string; id: string };
type MarketplacePage = { listings: MarketplaceListing[]; nextCursor: MarketplaceCursor | null };

function applyMarketplaceCursor<T extends { or: (filter: string) => T }>(
  query: T,
  cursor: MarketplaceCursor | null,
): T {
  if (!cursor) return query;
  return query.or(
    `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
  );
}

/**
 * Exported for src/test/marketplaceFeedQuery.test.ts. The chip row is only as
 * good as this predicate: a test that asserts the chips RENDER is what let a
 * feed that ignored them ship, so the test drives this function against a mixed
 * dataset and asserts each type comes back alone.
 */
export async function fetchMarketplaceListings(
  filters: MarketplaceFilters,
  withExtended = true,
  cursor: MarketplaceCursor | null = null,
): Promise<MarketplaceListing[]> {
  let query = supabase
    .from('marketplace_listings')
    .select(LISTING_COLUMNS(withExtended))
    // Which statuses count as live depends on the lifecycle: an item is
    // available|pending (pending = promised to a buyer, shown with a badge), a
    // service post is open|claimed. sold/completed/expired/under_review are
    // archived out of the feed either way.
    .in('status', feedStatusesFor(filters.postType))
    // One feed, filtered by post type rather than split into tabs — on the real
    // `post_type` discriminator since migration 20260910000000.
    .eq('post_type', filters.postType)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    // Guardrail so the Buy & Sell tab never downloads the entire table at once.
    .limit(MARKETPLACE_PAGE_SIZE);

  query = applyMarketplaceCursor(query, cursor);

  // Narrow by default. At 'group' scope the filter comes off and RLS is the only
  // boundary — which is the correct one: it returns the caller's own school plus
  // any school sharing its marketplace_group, and no client bug can widen it
  // further than the policy allows.
  if ((filters.scope ?? 'school') === 'school') {
    query = query.eq('university_id', filters.universityId);
  }

  if (filters.ownerUserId) {
    query = query.eq('user_id', filters.ownerUserId);
  }

  // Task category, for a service feed only. Guarded on the post type rather
  // than applied blind: `service_category` is NULL on every item and sublease
  // by CHECK, so an unguarded filter would silently empty a non-service feed.
  if (filters.serviceCategory && isServicePostType(filters.postType)) {
    query = query.eq('service_category', filters.serviceCategory);
  }

  if (filters.showSavedOnlyListingIds && filters.showSavedOnlyListingIds.length > 0) {
    query = query.in('id', filters.showSavedOnlyListingIds);
  }

  if (filters.categoryFilter !== CATEGORY_ALL) {
    query = query.eq('category', filters.categoryFilter);
  }
  if (filters.minPrice > PRICE_MIN) {
    query = query.gte('price', filters.minPrice);
  }
  // Max at the ceiling means "$500 and up" - leave the top unbounded so pricier
  // items still show; only clamp when the user pulled the max handle down.
  if (filters.maxPrice < PRICE_MAX) {
    query = query.lte('price', filters.maxPrice);
  }

  const { data, error } = await query;

  if (error) {
    if (withExtended && /verified_at|original_price/.test(error.message ?? '')) {
      return fetchMarketplaceListings(filters, false, cursor);
    }
    console.error('[Marketplace] Supabase fetch error:', error);
    console.error('[Marketplace] Supabase error details:', { message: error.message, details: error.details, hint: error.hint });
    if (typeof error.message === 'string' && /column\s+["']?image_urls["']?\s+does not exist/i.test(error.message)) {
      console.error('[Marketplace] The image_urls column is missing. Re-run the migration: supabase/migrations/20260216000001_marketplace_listings_image_urls.sql');
    }
    throw error;
  }
  // Seller contact comes from the opt-out-masked view (SEC-6), merged by id.
  // The select conditionally includes extended columns (verified_at/original_price)
  // with a runtime fallback above, so TS widens `data` to GenericStringError[]; we
  // only reach here on success (errors throw), so bridge the conversion via unknown.
  return withListingContacts((data as unknown as MarketplaceListing[]) ?? []);
}

async function fetchMarketplacePage(
  filters: MarketplaceFilters,
  cursor: MarketplaceCursor | null,
): Promise<MarketplacePage> {
  const listings = await fetchMarketplaceListings(filters, true, cursor);
  return {
    listings,
    nextCursor:
      listings.length === MARKETPLACE_PAGE_SIZE
        ? {
            createdAt: listings[listings.length - 1]!.created_at,
            id: listings[listings.length - 1]!.id,
          }
        : null,
  };
}

/**
 * Signed-out browse (App Store 5.1.1(v)).
 *
 * `marketplace_listings` is REVOKEd for anon to keep seller PII off the public
 * surface, so a guest reads the `marketplace_public` view instead: approved-only,
 * no contact columns, seller name denormalised and items pre-aggregated (the view
 * cannot serve PostgREST embeds — see the migration header). Filters mirror
 * `fetchMarketplaceListings` so the guest and member feeds sort and page alike.
 *
 * This replaced `fetchMarketplacePreviewListings`, the blurred "sneak peek" RPC:
 * that returned title/price/one image and no description, location, or detail —
 * a teaser, not the browsing Apple requires.
 */
export async function fetchGuestMarketplaceListings(
  filters: MarketplaceFilters,
  cursor: MarketplaceCursor | null = null,
): Promise<MarketplaceListing[]> {
  // SUBLEASES are excluded at the source — `marketplace_public` carries the
  // post_type equivalent of the old `is_sublease = false` predicate, so whether
  // subleases ever reach signed-out visitors stays deferred (PRD §5 Phase 4/§7).
  //
  // SERVICE POSTS ARE NOT: 20260910000000 §7 widened the view's approved-status
  // set to include 'open'/'claimed' so a guest browsing the market sees the real
  // one (App Store 5.1.1(v)). Which makes the service columns below LOAD-BEARING
  // rather than nice-to-have: without `post_type` on the row, `isServiceListing()`
  // returns false for every guest row and the card falls through to the price
  // branch, printing "$0" on a post that is priceless by construction. Found in
  // the browser at 390x844, 2026-08-16; the signed-in path never had it because
  // it selects post_type.
  let query = supabase
    // Not in generated types yet (types.ts lags prod migrations), same cast the
    // contact view uses in src/lib/marketplaceContact.ts.
    .from('marketplace_public' as never)
    .select(
      'id, title, description, price, original_price, category, condition, image_urls, meetup_location, price_negotiable, payment_methods, status, verified_at, created_at, post_type, service_category, service_date, service_duration_minutes, service_location, service_notes, show_instagram, show_snapchat, show_phone, seller_name, items',
    )
    .eq('university_id', filters.universityId)
    // The post-type chip has to narrow the ROWS, not just the query key. Both
    // predicates mirror `fetchMarketplaceListings` exactly, and their absence
    // here was the whole bug: `postType` was in the queryKey, so every chip tap
    // refetched, and every refetch returned the same unfiltered mixed list.
    // With `placeholderData: (prev) => prev` holding the old rows on screen
    // across that refetch, the grid never visibly changed — which reads as
    // "the previous chip's rows are still there", and reads worst on the
    // Subleases chip, which the view excludes at source and so can only ever
    // be an honest empty state for a guest.
    .in('status', feedStatusesFor(filters.postType))
    .eq('post_type', filters.postType)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(MARKETPLACE_PAGE_SIZE);

  query = applyMarketplaceCursor(query, cursor);

  if (filters.categoryFilter !== CATEGORY_ALL) {
    query = query.eq('category', filters.categoryFilter);
  }
  if (filters.minPrice > PRICE_MIN) {
    query = query.gte('price', filters.minPrice);
  }
  if (filters.maxPrice < PRICE_MAX) {
    query = query.lte('price', filters.maxPrice);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[Marketplace] guest fetch error:', error);
    throw error;
  }

  return mapGuestRows(data);
}

async function fetchGuestMarketplacePage(
  filters: MarketplaceFilters,
  cursor: MarketplaceCursor | null,
): Promise<MarketplacePage> {
  const listings = await fetchGuestMarketplaceListings(filters, cursor);
  return {
    listings,
    nextCursor:
      listings.length === MARKETPLACE_PAGE_SIZE
        ? {
            createdAt: listings[listings.length - 1]!.created_at,
            id: listings[listings.length - 1]!.id,
          }
        : null,
  };
}

type GuestListingRow = Omit<MarketplaceListing, 'profiles' | 'items' | 'user_id'> & {
  /**
   * FIRST NAME ONLY — not the seller's full name (#144/#155, migration
   * 20260911000000). The view derives it as the first whitespace-delimited token
   * of `profiles_public.full_name`, because a surname next to a building name and
   * an item, on a page that needs no account, is a doxxing dataset for one named
   * undergrad. It keeps the `seller_name` key (and lands in `profiles.full_name`
   * below) so guest and member rows stay one shape; do not "restore" the surname
   * on this path.
   */
  seller_name: string | null;
  items: MarketplaceListing['items'];
};

/**
 * Shape a `marketplace_public` row like the authenticated one so every consumer
 * below (cards, detail modal, filters) stays auth-agnostic. Contact fields are
 * pinned null — the view never carries them, and nothing should read a stale
 * value off a guest row.
 */
function mapGuestRows(data: unknown): MarketplaceListing[] {
  return ((data as GuestListingRow[] | null) ?? []).map((row) => {
    const { seller_name, ...rest } = row;
    return {
      ...rest,
      // The guest view carries no seller join key (P3-A, 20260830050000);
      // every user_id consumer is auth-gated, so an empty id is never compared.
      user_id: '',
      items: row.items ?? [],
      // `full_name` here holds a FIRST NAME on the guest path (#144/#155) — the
      // field name is the shared MarketplaceListing shape, not a claim about
      // what the guest projection carries.
      profiles: seller_name ? { full_name: seller_name, email: null } : null,
      phone_number: null,
      instagram_handle: null,
      snapchat_handle: null,
    } satisfies MarketplaceListing;
  });
}

/** Single listing for the `?listing=<id>` deep link on the signed-out feed. */
async function fetchGuestListingById(id: string): Promise<MarketplaceListing | null> {
  const { data, error } = await supabase
    .from('marketplace_public' as never)
    .select(
      'id, title, description, price, original_price, category, condition, image_urls, meetup_location, price_negotiable, payment_methods, status, verified_at, created_at, post_type, service_category, service_date, service_duration_minutes, service_location, service_notes, show_instagram, show_snapchat, show_phone, seller_name, items',
    )
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return mapGuestRows([data])[0] ?? null;
}

export function MarketplaceTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // View-as: hide admin affordances while a superadmin previews as a student.
  const { effectiveIsAdmin: isAdmin } = useAdminUniversitySilo();
  const { university } = useUniversity();
  const { blockedUserIds } = useBlockedUserIds();
  const { setupModeEnabled } = useSetupMode();
  const modalOverlay = useModalOverlay();
  const setHideBottomNav = modalOverlay?.setHideBottomNav;
  const { markItemSold, relistItem, markAsSold, markAsPending, relistListing } = useMyListings(user?.id);
  const { handleMessageSeller } = useMessageSeller();
  const { deletingListingId, handleDeleteListing } = useDeleteListing();
  const isMobile = useIsMobile();

  const [section, setSection] = useState<MarketplaceSection>('general');
  // Narrow by default, always. Your own school is the feed you opted into; the
  // wider city is one deliberate tap away and never the state you land in.
  const [scope, setScope] = useState<MarketplaceScope>('school');

  // Does this school share a marketplace with anyone? Read from the DB rather
  // than static config, so a school joins or leaves the group with one UPDATE
  // and no deploy — the same reasoning as universities.feature_flags.
  //
  // `marketplace_group` is new (migration 20260911000000). On a database that
  // has not run it yet the select fails with 42703, which resolves to null and
  // simply hides the toggle: the feed keeps working, narrow. That is why this
  // query does not retry and never throws.
  const { data: marketplaceGroup = null } = useQuery({
    queryKey: ['university-marketplace-group', university.id],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from('universities')
        .select('marketplace_group')
        .eq('id', university.id)
        .maybeSingle();
      if (error) return null;
      return (
        (data as unknown as { marketplace_group?: string | null } | null)?.marketplace_group ?? null
      );
    },
    enabled: Boolean(user?.id),
    staleTime: 5 * 60_000,
    retry: false,
  });
  /** A school with no group has nothing to widen to, so it gets no toggle. */
  const canBrowseGroup = Boolean(user) && Boolean(marketplaceGroup);

  /**
   * Short name of the listing's school when it is NOT the viewer's, else null.
   * Null for your own school is the whole design of the card chip: it marks the
   * exception, so an unmarked card reliably means "here".
   */
  const otherSchoolLabel = useCallback(
    (listing: MarketplaceListing): string | null => {
      const listingUniversityId = listing.university_id;
      if (!listingUniversityId || listingUniversityId === university.id) return null;
      return getUniversityById(listingUniversityId)?.shortName ?? null;
    },
    [university.id],
  );
  // One feed, filter chips — never a new tab (PRD §5 Phase 2, §6). The chip row
  // hides itself until the school has two or more queryable types enabled.
  const flags = useFeatureFlags();
  const [postTypeFilter, setPostTypeFilter] = useState<PostType>(DEFAULT_POST_TYPE);
  // Task category within a service feed. Cleared whenever the post type moves:
  // a 'rides' filter left standing while the student switches to Items would
  // read as an empty marketplace, and the chip explaining why is gone by then.
  const [serviceCategoryFilter, setServiceCategoryFilter] = useState<ServiceCategory | null>(
    null,
  );
  const selectPostType = (next: PostType) => {
    setPostTypeFilter(next);
    setServiceCategoryFilter(null);
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(CATEGORY_ALL);
  // [min, max] price range; max at PRICE_MAX means "$500+" (no upper bound).
  const [priceRange, setPriceRange] = useState<[number, number]>([PRICE_MIN, PRICE_MAX]);
  const minPrice = priceRange[0];
  const maxPrice = priceRange[1];
  const [showSavedOnly, setShowSavedOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>(SORT_NEWEST);
  const [filtersPopoverOpen, setFiltersPopoverOpen] = useState(false);
  const [alertsDialogOpen, setAlertsDialogOpen] = useState(false);
  const didOpenPostDialogRef = useRef(false);
  const didOpenListingDetailRef = useRef(false);
  const [markingSoldId, setMarkingSoldId] = useState<string | null>(null);
  const [selectedListing, setSelectedListing] = useState<MarketplaceListing | null>(null);
  // App Store 5.1.1(v): browsing is open, the account-based actions prompt.
  // Holds the phrase for "You need an account to <…>", null when closed.
  const [signInPromptAction, setSignInPromptAction] = useState<string | null>(null);
  // Rect of the card that opened the detail modal, so it can morph open from there.
  const [zoomOrigin, setZoomOrigin] = useState<ListingZoomOrigin | null>(null);
  // True while the open detail view came from a card through a view transition,
  // so it can morph back into that card on close.
  const [sharedPhoto, setSharedPhoto] = useState(false);
  // Any other close (mark sold, delete) or a deep-link open must not inherit it.
  useEffect(() => {
    if (!selectedListing) setSharedPhoto(false);
  }, [selectedListing]);
  const openListing = useCallback((listing: MarketplaceListing, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const show = (shared: boolean) => {
      setZoomOrigin({ top: r.top, left: r.left, width: r.width, height: r.height });
      setSharedPhoto(shared);
      setSelectedListing(listing);
    };
    // By id, not inside `el`: the card's title button opens it too (keyboard path).
    const photo = document.querySelector<HTMLElement>(`[data-listing-photo="${CSS.escape(listing.id)}"]`);
    if (!photo || !canViewTransition()) {
      show(false);
      return;
    }
    // The detail chunk must render synchronously inside the transition, or the
    // "after" frame is empty. It is normally prefetched on hover / in-view, so
    // this resolves on the next microtask.
    void ensureListingDetail().then(
      () => {
        if (!canViewTransition()) return show(false);
        photo.style.viewTransitionName = LISTING_PHOTO_TRANSITION_NAME;
        runViewTransition('listing-open', () => {
          photo.style.viewTransitionName = '';
          show(true);
        });
      },
      () => show(false),
    );
  }, []);
  const closeListing = useCallback(() => {
    const id = selectedListing?.id;
    // The detail view unmounts outright (no exit phase), so Radix cannot restore
    // focus; hand it back to this card's own open control (WCAG 2.4.3). A pointer
    // close shows no ring: :focus-visible follows the last input modality.
    const refocus = () => {
      if (!id) return;
      document
        .querySelector<HTMLElement>(`[data-listing-open="${CSS.escape(id)}"]`)
        ?.focus({ preventScroll: true });
    };
    const close = () => {
      setSelectedListing(null);
      setZoomOrigin(null);
      setSharedPhoto(false);
      // Pop the history entry the open pushed (see the listing-overlay effects
      // below), so Close leaves no stale `?listing=` step behind for Back.
      if (listingOverlayRef.current) {
        listingOverlayRef.current = false;
        navigate(-1);
      }
    };
    const photo =
      sharedPhoto && selectedListing
        ? document.querySelector<HTMLElement>(`[data-listing-photo="${CSS.escape(selectedListing.id)}"]`)
        : null;
    const r = photo?.getBoundingClientRect();
    // Only morph back to a card that is actually on screen; otherwise the photo
    // would fly off to wherever the feed has scrolled it.
    if (!photo || !r || r.bottom <= 0 || r.top >= window.innerHeight) {
      close();
      requestAnimationFrame(refocus);
      return;
    }
    runViewTransition(
      'listing-close',
      () => {
        close();
        photo.style.viewTransitionName = LISTING_PHOTO_TRANSITION_NAME;
      },
      () => {
        photo.style.viewTransitionName = '';
        refocus();
      },
    );
  }, [sharedPhoto, selectedListing, navigate]);

  // ── Listing detail ⇄ browser history ─────────────────────────────────────
  // The detail is in-page state (no /marketplace/:id route), so Back used to
  // leave the feed entirely. Opening now pushes `?listing=<id>` with
  // `state.listingOverlay`; Back pops it and the param-watcher closes the
  // detail; Close pops it itself. Deep links (?listing= without the flag) keep
  // their own handler below, which skips overlay entries.
  const listingOverlayRef = useRef(false);
  const listingParam = searchParams.get('listing');
  const isOverlayEntry = (location.state as { listingOverlay?: boolean } | null)?.listingOverlay === true;
  useEffect(() => {
    if (!selectedListing) return;
    if (isOverlayEntry && listingParam === selectedListing.id) {
      listingOverlayRef.current = true;
      return;
    }
    const next = new URLSearchParams(window.location.search);
    next.set('listing', selectedListing.id);
    listingOverlayRef.current = true;
    navigate({ pathname: location.pathname, search: `?${next.toString()}` }, { state: { listingOverlay: true } });
    // Only a newly opened listing pushes; the URL/state deps are read, not watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedListing?.id]);
  const closeListingRef = useRef(closeListing);
  closeListingRef.current = closeListing;
  // Close only on LEAVING one of our overlay entries (Back/forward away from it),
  // not on any loss of ?listing=: the deep-link handler's own URL rewrite drops
  // the param too, and must not close the detail it just opened.
  const onOverlayEntry = isOverlayEntry && !!listingParam;
  const wasOnOverlayEntryRef = useRef(onOverlayEntry);
  useEffect(() => {
    const was = wasOnOverlayEntryRef.current;
    wasOnOverlayEntryRef.current = onOverlayEntry;
    if (was && !onOverlayEntry && listingOverlayRef.current) {
      listingOverlayRef.current = false;
      closeListingRef.current();
    }
  }, [onOverlayEntry]);

  const [reportTarget, setReportTarget] = useState<{ contentId: string; contentLabel: string } | null>(null);
  // "Hide listing" (⋯ menu) - a soft, session-local dismissal that drops the
  // card from this viewer's feed. Not persisted; mirrors Facebook's local hide.
  const [hiddenListingIds, setHiddenListingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!setHideBottomNav) return;
    const shouldHideBottomNav = Boolean(isMobile && (selectedListing || filtersPopoverOpen));
    setHideBottomNav(shouldHideBottomNav);
    return () => setHideBottomNav(false);
  }, [filtersPopoverOpen, isMobile, selectedListing, setHideBottomNav]);

  // Deep-link support: ?tab= in URL and location.state.marketplaceSection.
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'businesses') {
      if (SHOW_STUDENT_BUSINESSES) {
        setSection('businesses');
      } else {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.set('tab', 'buy-sell');
        setSearchParams(nextParams, { replace: true });
        setSection('general');
      }
    } else if (tab === 'items' || tab === 'general' || tab === 'buy' || tab === 'buy-sell') {
      setSection('general');
    } else {
      const next = (location.state as { marketplaceSection?: string } | undefined)?.marketplaceSection;
      if (next === 'general') {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.set('tab', 'buy-sell');
        setSearchParams(nextParams, { replace: true });
        setSection('general');
      }
    }

    const navState = location.state as
      | { openPostDialog?: string; listingDraft?: Partial<ListingForm> }
      | undefined;
    if (navState?.openPostDialog === 'general' && user && !didOpenPostDialogRef.current) {
      didOpenPostDialogRef.current = true;
      // Prefill from a draft handed over in navigation state (e.g. move-out
      // "sell it" triage); the create page merges it into the form.
      openPostDialog('general', navState.listingDraft);
    }
  }, [searchParams, location.state, user, setSearchParams]);

  // Bottom-nav "Post an Item" deep-link: `?compose=1` opens the post dialog, then
  // clears the param so tapping Post from the nav re-triggers it every time.
  useEffect(() => {
    if (searchParams.get('compose') !== '1') return;
    openPostDialog('general');
    const next = new URLSearchParams(searchParams);
    next.delete('compose');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams]);

  // After edit save (location.state) or a ?listing= deep-link (e.g. a
  // marketplace-alert notification): open listing detail on the marketplace
  // list (no /marketplace/:id route).
  useEffect(() => {
    // Our own history entries carry ?listing= too; they are not deep links.
    if ((location.state as { listingOverlay?: boolean } | null)?.listingOverlay) return;
    const listingId =
      (location.state as { openListingId?: string } | undefined)?.openListingId ??
      searchParams.get('listing');
    if (!listingId || didOpenListingDetailRef.current) return;
    didOpenListingDetailRef.current = true;

    void (async () => {
      if (!user) {
        // Guests resolve detail off marketplace_public — the base table is
        // anon-REVOKEd, so the authenticated select below would 42501 and the
        // shared-listing link would silently open nothing.
        const guestListing = await fetchGuestListingById(listingId);
        if (guestListing) setSelectedListing(guestListing);
        navigate('/marketplace?tab=buy-sell', { replace: true });
        return;
      }
      const { data, error } = await supabase
        .from('marketplace_listings')
        .select(
          // The sublease block is NOT optional here, and its absence was a real
          // (pre-existing) hole: ListingDetailModal renders every structured
          // sublease fact behind `listing.is_sublease`, so a `?listing=<id>` deep
          // link to a sublease — from a share link, a marketplace notification, or
          // the /subleases map — opened a detail view with the dates, building,
          // utilities and terms all silently missing. The feed path
          // (LISTING_COLUMNS) always selected them; only this single-row read did
          // not. Same columns, same names, so the two paths now agree.
          'id, user_id, title, description, price, category, image_urls, created_at, status, condition, meetup_location, price_negotiable, payment_methods, show_instagram, show_snapchat, show_phone, post_type, service_category, service_date, service_duration_minutes, service_location, service_notes, claimed_by, is_sublease, sublease_start, sublease_end, building_name, included_utilities, is_furnished, has_parking, gender_preference, house_rules, additional_rules, profiles:public_profiles(full_name)',
        )
        .eq('id', listingId)
        // Any live status, not just 'available': a service post's live states
        // are open|claimed, so an eq('available') here opened a shared service
        // link onto nothing.
        .in('status', ['available', 'pending', 'open', 'claimed'])
        .maybeSingle();
      if (!error && data) {
        // Seller contact comes from the opt-out-masked view (SEC-6).
        setSelectedListing(await withListingContact(data as MarketplaceListing));
      }
      navigate('/marketplace?tab=buy-sell', { replace: true });
    })();
  }, [location.state, searchParams, navigate, user]);

  // Count user's active listings (for the 15-item limit).
  const { data: myGeneralListingCount = 0 } = useQuery({
    queryKey: ['marketplace_listings', 'my_general_count', user?.id],
    queryFn: async () => {
      if (!user?.id) return 0;
      const { count, error } = await supabase
        .from('marketplace_listings')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'available')
        .eq('is_sublease', false);
      if (error) return 0;
      return count ?? 0;
    },
    // Only changes when the user posts/removes a listing (invalidated there).
    staleTime: 2 * 60_000,
    enabled: Boolean(user?.id),
  });

  // Saved Buy & Sell items (heart on Buy & Sell tab writes here)
  const { data: savedItemIds = [] } = useQuery({
    queryKey: ['saved_items', user?.id],
    queryFn: async (): Promise<string[]> => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('saved_items')
        .select('item_id')
        .eq('user_id', user.id);
      if (error) return [];
      return (data ?? []).map((r: { item_id: string }) => r.item_id);
    },
    // Hearts write through invalidateQueries, so a longer staleTime is safe and
    // keeps this from gating the listings query on every remount.
    staleTime: 60_000,
    enabled: Boolean(user?.id),
  });
  const savedItemIdSet = useMemo(() => new Set(savedItemIds), [savedItemIds]);

  const savedOnlyIds = useMemo(
    () => (showSavedOnly ? savedItemIds : null),
    [showSavedOnly, savedItemIds]
  );

  const {
    data: listingPages,
    isLoading,
    error: fetchError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: [
      ...MARKETPLACE_LISTINGS_QUERY_KEY,
      'general',
      user?.id ?? 'anon',
      categoryFilter,
      minPrice,
      maxPrice,
      showSavedOnly,
      savedOnlyIds,
      university.id,
      postTypeFilter,
      serviceCategoryFilter,
      // Part of the key: flipping the toggle must refetch, not re-filter a
      // narrower cached page.
      scope,
    ],
    queryFn: ({ pageParam }) => {
      const filters: MarketplaceFilters = {
        ownerUserId: null,
        categoryFilter,
        minPrice,
        maxPrice,
        showSavedOnlyListingIds: savedOnlyIds,
        universityId: university.id,
        // Guests stay pinned to the school they picked: the cross-school feed is
        // a signed-in student's view of their own city, not an open catalogue.
        scope: user ? scope : 'school',
        postType: postTypeFilter,
        serviceCategory: serviceCategoryFilter,
      };
      // Guests get the real feed off marketplace_public, not the old blurred
      // preview RPC (App Store 5.1.1(v)).
      return user
        ? fetchMarketplacePage(filters, pageParam)
        : fetchGuestMarketplacePage(filters, pageParam);
    },
    initialPageParam: null as MarketplaceCursor | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: (prev) => prev,
    enabled: section === 'general',
    // Replaces the former Realtime subscription (table dropped from the
    // publication): returning to the tab pulls other sellers' new listings.
    refetchOnWindowFocus: true,
  });
  const listings = useMemo(
    () => listingPages?.pages.flatMap((page) => page.listings) ?? [],
    [listingPages],
  );

  useEffect(() => {
    if (fetchError) toast.error('Failed to load listings');
  }, [fetchError]);

  // NOTE: no Realtime subscription here by design. marketplace_listings was
  // dropped from the supabase_realtime publication (migration
  // 20260812000000) because a browse feed does not need cross-user live push
  // and the WAL poll was ~95% of DB query time. The seller's own
  // post/edit/delete still invalidates ['marketplace_listings'] explicitly
  // (instant for them); other sellers' listings refresh via
  // refetchOnWindowFocus on the listings query below.


  // Posting is now its own full-page route (/marketplace/create) rather than a
  // dialog overlay - a Facebook-Marketplace-style takeover. `draft` prefills the
  // form (e.g. move-out "sell it" triage) via navigation state.
  const openPostDialog = (fromSection?: MarketplaceSection, draft?: Partial<ListingForm>) => {
    if (!user) {
      setSignInPromptAction('post a listing');
      return;
    }
    // Apply the 15-item active listing limit (the create page re-checks too).
    if (fromSection === 'general' && myGeneralListingCount >= MAX_ACTIVE_LISTINGS) {
      toast.error(t('housing:portal.marketplace.posting.limitReached'));
      return;
    }
    navigate('/marketplace/create', draft ? { state: { draft } } : undefined);
  };

  const filteredListings = useMemo(() => {
    let result = listings.filter(
      (l) => (!l.user_id || !blockedUserIds.has(l.user_id)) && !hiddenListingIds.has(l.id),
    );
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (l) =>
          (l.title ?? '').toLowerCase().includes(q) ||
          (l.description ?? '').toLowerCase().includes(q)
      );
    }
    result = [...result].sort((a, b) => {
      if (sortBy === SORT_PRICE_LOW) return a.price - b.price;
      if (sortBy === SORT_PRICE_HIGH) return b.price - a.price;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return result;
  }, [listings, searchQuery, sortBy, blockedUserIds, hiddenListingIds]);

  useEffect(() => {
    if (savedItemIds.length === 0) setShowSavedOnly(false);
  }, [savedItemIds.length]);

  const registerHeartClickOverride = useHousingSaved()?.registerHeartClickOverride;
  const setHeartOverrideActive = useHousingSaved()?.setHeartOverrideActive;
  const setSavedCount = useHousingSaved()?.setSavedCount;

  useEffect(() => {
    if (section !== 'general') return;
    registerHeartClickOverride?.(() => setShowSavedOnly((v) => !v));
    return () => {
      registerHeartClickOverride?.(null);
      setHeartOverrideActive?.(false);
      setSavedCount?.(null);
    };
  }, [section, registerHeartClickOverride, setHeartOverrideActive, setSavedCount]);

  useEffect(() => {
    if (section !== 'general') return;
    setHeartOverrideActive?.(showSavedOnly);
  }, [section, showSavedOnly, setHeartOverrideActive]);

  useEffect(() => {
    if (section !== 'general') return;
    setSavedCount?.(savedItemIds.length);
  }, [section, savedItemIds.length, setSavedCount]);

  const toggleSavedItem = useCallback(
    async (itemId: string) => {
      if (!user?.id) return;
      const isSaved = savedItemIdSet.has(itemId);
      try {
        if (isSaved) {
          await supabase
            .from('saved_items')
            .delete()
            .eq('user_id', user.id)
            .eq('item_id', itemId);
        } else {
          await supabase
            .from('saved_items')
            .insert({ user_id: user.id, item_id: itemId });
        }
        await queryClient.invalidateQueries({ queryKey: ['saved_items', user.id] });
      } catch (err) {
        console.error('Toggle saved item error:', err);
        toast.error('Could not update saved items');
      }
    },
    [user?.id, savedItemIdSet, queryClient]
  );

  const categories: { value: CategoryFilter; label: string }[] = [
    { value: CATEGORY_ALL, label: 'All' },
    ...MARKETPLACE_CATEGORIES_FILTER.map((c) => ({ value: c as CategoryFilter, label: c })),
  ];
  const isPriceFiltered = minPrice > PRICE_MIN || maxPrice < PRICE_MAX;
  const hasFeedShapeFilter =
    postTypeFilter !== DEFAULT_POST_TYPE || scope !== 'school' || serviceCategoryFilter !== null;
  const hasGeneralFilter =
    categoryFilter !== CATEGORY_ALL || isPriceFiltered || hasFeedShapeFilter;
  const hasSearchOrFilter = searchQuery.trim() !== '' || hasGeneralFilter || showSavedOnly;

  const marketplaceFilterCount = useMemo(() => {
    let count = 0;
    if (postTypeFilter !== DEFAULT_POST_TYPE) count += 1;
    if (scope !== 'school') count += 1;
    if (serviceCategoryFilter) count += 1;
    if (showSavedOnly) count += 1;
    if (sortBy !== SORT_NEWEST) count += 1;
    if (categoryFilter !== CATEGORY_ALL) count += 1;
    if (minPrice > PRICE_MIN || maxPrice < PRICE_MAX) count += 1;
    return count;
  }, [categoryFilter, maxPrice, minPrice, postTypeFilter, scope, serviceCategoryFilter, showSavedOnly, sortBy]);

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setCategoryFilter(CATEGORY_ALL);
    setPriceRange([PRICE_MIN, PRICE_MAX]);
    setShowSavedOnly(false);
    setSortBy(SORT_NEWEST);
    selectPostType(DEFAULT_POST_TYPE);
    setScope('school');
  }, []);
  const showGrid = filteredListings.length > 0;

  const handleMarkAsSold = async (listing: MarketplaceListing) => {
    if (!user || listing.user_id !== user.id) return;
    setMarkingSoldId(listing.id);
    try {
      // Single instrumented path: the hook marks the listing + child items sold,
      // toasts, invalidates the feed, and fires handoff_completed analytics.
      await markAsSold(listing.id, () => closeListingRef.current());
    } finally {
      setMarkingSoldId(null);
    }
  };

  const [togglingItemId, setTogglingItemId] = useState<string | null>(null);
  const handleToggleItemStatus = async (
    item: NonNullable<MarketplaceListing['items']>[number],
    listing: MarketplaceListing,
    nextStatus: 'available' | 'sold',
  ) => {
    if (!user || listing.user_id !== user.id) return;
    setTogglingItemId(item.id);
    try {
      const ok =
        nextStatus === 'sold'
          ? await markItemSold(item.id, listing.id)
          : await relistItem(item.id, listing.id);
      if (ok) {
        // Keep the open modal's snapshot in sync (the feed refetch won't reach it).
        setSelectedListing((prev) => {
          if (!prev || prev.id !== listing.id) return prev;
          const items = (prev.items ?? []).map((i) =>
            i.id === item.id ? { ...i, status: nextStatus } : i,
          );
          const price = minAvailablePrice(items) ?? prev.price;
          const status = items.length > 0 && items.every((i) => i.status === 'sold') ? 'sold' as const : 'available' as const;
          return { ...prev, items, price, status };
        });
      }
    } finally {
      setTogglingItemId(null);
    }
  };


  const rawTab = searchParams.get('tab') || 'buy-sell';
  const tabForHeadline =
    !SHOW_STUDENT_BUSINESSES && rawTab === 'businesses' ? 'buy-sell' : rawTab;
  const headline = MARKETPLACE_HEADLINES[tabForHeadline] ?? MARKETPLACE_HEADLINES['buy-sell'];

  // Category + price-band chip buttons, shared by the mobile open rows and the
  // desktop Filters popover so both stay in sync.
  const categoryChipButtons = categories.map(({ value, label }) => (
    <button
      key={value}
      type="button"
      onClick={() => setCategoryFilter(value)}
      aria-pressed={categoryFilter === value}
      className={cn(
        'shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        categoryFilter === value
          ? 'border-foreground bg-muted text-foreground'
          : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {label}
    </button>
  ));
  const priceBandChipButtons = PRICE_BANDS.map(({ label, max }) => {
    const active = minPrice === PRICE_MIN && maxPrice === max;
    return (
      <button
        key={label}
        type="button"
        onClick={() => setPriceRange([PRICE_MIN, max])}
        aria-pressed={active}
        className={cn(
          'shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
          active
            ? 'border-foreground bg-muted text-foreground'
            : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        {label}
      </button>
    );
  });

  const clampPrice = (raw: string, fallback: number) => {
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.max(PRICE_MIN, Math.min(PRICE_MAX, n));
  };
  const priceLabel =
    minPrice === PRICE_MIN && maxPrice >= PRICE_MAX
      ? t('housing:portal.marketplace.filters.anyPrice')
      : maxPrice >= PRICE_MAX
        ? `$${minPrice}+`
        : `$${minPrice} – $${maxPrice}`;

  const marketplaceFiltersFields = (
    <div className="space-y-4">
      {section === 'general' && (
        <>
          <div className="space-y-2">
            <Label className="block text-sm font-semibold text-foreground">
              {t('marketplace:postType.filterLabel')}
            </Label>
            <PostTypeFilterChips
              value={postTypeFilter}
              onChange={selectPostType}
              flags={flags}
            />
          </div>
          {canBrowseGroup && (
            <div className="space-y-2">
              <Label className="block text-sm font-semibold text-foreground">
                {t('marketplace:scope.filterLabel')}
              </Label>
              <MarketplaceScopeChips
                value={scope}
                onChange={setScope}
                schoolShortName={university.shortName}
              />
            </div>
          )}
          {user && isServicePostType(postTypeFilter) && (
            <ServiceCategoryChips
              value={serviceCategoryFilter}
              onChange={setServiceCategoryFilter}
              remoteOpen={flags.showRemoteServices}
            />
          )}
        </>
      )}
      <div className="space-y-2">
        <Label className="text-sm font-semibold text-foreground mb-2 block">{t('housing:portal.marketplace.filters.sortBy')}</Label>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { value: SORT_NEWEST, label: t('housing:portal.marketplace.filters.newest') },
              { value: SORT_PRICE_LOW, label: t('housing:portal.marketplace.filters.lowestPrice') },
              { value: SORT_PRICE_HIGH, label: t('housing:portal.marketplace.filters.highestPrice') },
            ] as const
          ).map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setSortBy(value)}
              className={cn(
                'inline-flex items-center px-3 py-2 rounded-full text-sm font-medium border transition-all',
                sortBy === value
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-card text-foreground border-border hover:border-border',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {section === 'general' && (
        <>
          <div className="flex items-center justify-between">
            <Label htmlFor="mp-filter-saved" className="text-sm font-semibold text-foreground">
              {t('housing:portal.marketplace.filters.showLikedOnly')}
            </Label>
            <Switch
              id="mp-filter-saved"
              checked={showSavedOnly}
              onCheckedChange={setShowSavedOnly}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-foreground mb-2 block">
              {t('housing:portal.marketplace.filters.category')}
            </Label>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('housing:portal.marketplace.filters.filterByCategory')}>
              {categoryChipButtons}
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-foreground">{t('housing:portal.marketplace.filters.price')}</Label>
              <span className="text-sm font-medium text-foreground">{priceLabel}</span>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('housing:portal.marketplace.filters.filterByPrice')}>
              {priceBandChipButtons}
            </div>
            <Slider
              value={priceRange}
              min={PRICE_MIN}
              max={PRICE_MAX}
              step={PRICE_STEP}
              minStepsBetweenThumbs={1}
              onValueChange={(v) => setPriceRange([v[0] ?? PRICE_MIN, v[1] ?? PRICE_MAX])}
              aria-label={t('housing:portal.marketplace.filters.priceRange')}
              className="py-1 [&_.bg-primary]:!bg-foreground [&_button]:!border-border [&_button]:focus-visible:!ring-malachite-600" // KEEP: interaction-only focus ring
            />
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={PRICE_MIN}
                  max={PRICE_MAX}
                  value={minPrice}
                  onChange={(e) => {
                    const n = clampPrice(e.target.value, PRICE_MIN);
                    setPriceRange([Math.min(n, maxPrice), maxPrice]);
                  }}
                  aria-label={t('housing:portal.marketplace.filters.minPrice')}
                  className="h-9 pl-6 text-sm focus-visible:ring-malachite-600 focus-visible:ring-offset-2"
                />
              </div>
              <span className="text-muted-foreground" aria-hidden>–</span>
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={PRICE_MIN}
                  max={PRICE_MAX}
                  value={maxPrice}
                  onChange={(e) => {
                    const n = clampPrice(e.target.value, PRICE_MAX);
                    setPriceRange([minPrice, Math.max(n, minPrice)]);
                  }}
                  aria-label={t('housing:portal.marketplace.filters.maxPrice')}
                  className="h-9 pl-6 text-sm focus-visible:ring-malachite-600 focus-visible:ring-offset-2"
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );

  const marketplaceFiltersPanel = isMobile ? (
    <AdaptiveOverlay open={filtersPopoverOpen} onOpenChange={setFiltersPopoverOpen} shouldScaleBackground={false} mobileVariant="drawer">
      <AdaptiveOverlayContent
        priority
        hideDefaultHandle
        overlayClassName={FROSTED_OVERLAY_CLASS}
        className="flex h-auto max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-card pb-0"
      >
        <div className="mx-auto mt-4 h-2 w-[100px] shrink-0 rounded-full bg-muted" />
        <div className="shrink-0 p-4 pb-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-lg font-semibold">{t('housing:portal.marketplace.filters.filters')}</span>
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            >
              {t('common:actions.clearAll')}
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pt-3">
          {marketplaceFiltersFields}
        </div>
        <div className="shrink-0 space-y-2 border-t border-border bg-card px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {/* Saved-search alerts moved off the browse header into the filters
              drawer on mobile - seeded from whatever filters are applied. */}
          {user && (
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2 rounded-full border-border text-foreground hover:bg-accent hover:text-foreground"
              onClick={() => {
                setFiltersPopoverOpen(false);
                setAlertsDialogOpen(true);
              }}
            >
              <BellRing className="h-4 w-4 shrink-0" aria-hidden />
              Manage alerts
            </Button>
          )}
          <Button
            type="button"
            // KEEP: primary CTA of the filters overlay (show results)
            className="w-full bg-malachite-800 hover:bg-malachite-900 text-white"
            onClick={() => setFiltersPopoverOpen(false)}
          >
            {t('housing:portal.marketplace.filters.showResults')}
          </Button>
        </div>
      </AdaptiveOverlayContent>
    </AdaptiveOverlay>
  ) : null;

  // The loading state used to be an early return: a bare heading over a centred
  // spinner, with no filter bar and no grid. Every one of those pieces then
  // appeared at once when the query resolved, which is a page-sized layout shift
  // by construction — no amount of skeleton tuning fixes a state that renders a
  // different tree. It now falls through to the real tree below and only the grid
  // region swaps to <ListingGridSkeleton />, so the header, safety banner, search
  // and filter row are the same DOM before and after the data lands.

  return (
    <div className="space-y-3 py-2 animate-fade-in">
      {section === 'general' && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 shrink-0">
            <div className="min-w-0">
              {/* Native: title scrolls away with content (sits by the pill) instead of a fixed top-bar title. */}
              <div className="flex items-center gap-2">
                <h1 className={cn("truncate text-2xl font-bold leading-tight text-foreground", Capacitor.isNativePlatform() && "pr-28 text-3xl")}>{headline.title}</h1>
                <BookmarkToggle />
              </div>
              <p className="hidden text-sm text-muted-foreground mt-1 md:block">{headline.subtitle}</p>
            </div>
            {/* Desktop posting entry moved into the search/filters row (sits
                between search and Filters as a compact "+ Post"). */}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:flex-wrap gap-3 sm:gap-2 shrink-0">
            <div className="flex items-center gap-2 flex-1 min-w-0 w-full sm:w-auto">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  type="text"
                  placeholder={t('housing:portal.marketplace.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={cn(
                    'h-11 pl-9 rounded-full bg-card border border-border shadow-raised focus-visible:ring-2 focus-visible:ring-malachite-600/30 focus-visible:border-malachite-600/40',
                    isMobile && 'pr-12',
                  )}
                />
                {/* Mobile: filters live inside the search bar (one control surface,
                    less header chrome); desktop keeps the labeled popover button. */}
                {isMobile && (
                  <button
                    type="button"
                    aria-label={
                      marketplaceFilterCount > 0
                        ? t('housing:portal.marketplace.filters.filtersWithCount', { n: marketplaceFilterCount })
                        : t('housing:portal.marketplace.filters.filters')
                    }
                    onClick={() => setFiltersPopoverOpen((prev) => !prev)}
                    className={cn(
                      'absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full transition-colors',
                      marketplaceFilterCount > 0
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden />
                    {marketplaceFilterCount > 0 && <span className="sr-only">{marketplaceFilterCount}</span>}
                  </button>
                )}
              </div>
              {/* Mobile-only ⊕ post CTA — a compact icon on the right of the
                  search bar (desktop uses the labeled "+ Post" button below). */}
              {user && (
                <button
                  type="button"
                  onClick={() => openPostDialog('general')}
                  aria-label={t('housing:portal.marketplace.posting.postAnItem')}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border/70 bg-card text-muted-foreground shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-colors hover:bg-muted/60 hover:text-foreground md:hidden"
                >
                  <Plus className="h-5 w-5 shrink-0" aria-hidden />
                </button>
              )}
              {/* Desktop "+ Post" — sits between search and Filters on the same row. */}
              {user && (
                <Button
                  type="button"
                  onClick={() => openPostDialog('general')}
                  // KEEP: primary CTA of the marketplace tab (post an item)
                  className="hidden shrink-0 h-11 gap-1.5 rounded-full bg-malachite-800 px-4 text-sm font-semibold text-white hover:bg-malachite-900 md:inline-flex"
                >
                  <Plus className="h-4 w-4 shrink-0" aria-hidden />
                  {t('housing:portal.marketplace.posting.post')}
                </Button>
              )}
              <div className="relative shrink-0">
                {isMobile ? (
                  marketplaceFiltersPanel
                ) : (
                  <Popover open={filtersPopoverOpen} onOpenChange={setFiltersPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(
                          'shrink-0 h-11 gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground shadow-none hover:bg-accent hover:text-foreground [&_svg]:text-muted-foreground',
                          marketplaceFilterCount > 0 && 'border-foreground',
                        )}
                      >
                        <SlidersHorizontal className="w-4 h-4 shrink-0" />
                        {marketplaceFilterCount > 0
                          ? t('housing:portal.marketplace.filters.filtersWithCount', { n: marketplaceFilterCount })
                          : t('housing:portal.marketplace.filters.filters')}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      sideOffset={8}
                      className="z-[10060] w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl p-0 shadow-overlay"
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                        <span className="text-sm font-semibold">{t('housing:portal.marketplace.filters.filters')}</span>
                        <button
                          type="button"
                          onClick={clearFilters}
                          className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                        >
                          {t('common:actions.clearAll')}
                        </button>
                      </div>
                      <div className="max-h-[70vh] overflow-y-auto p-4">
                        {marketplaceFiltersFields}
                      </div>
                      {/* Saved-search alerts live inside Filters (mirrors the
                          mobile drawer) - keeps the browse header to one search +
                          one Filters control, no stray bell. */}
                      {user && (
                        <div className="border-t border-border px-4 py-3">
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full gap-2 rounded-full border-border text-foreground hover:bg-accent hover:text-foreground"
                            onClick={() => {
                              setFiltersPopoverOpen(false);
                              setAlertsDialogOpen(true);
                            }}
                          >
                            <BellRing className="h-4 w-4 shrink-0" aria-hidden />
                            Manage alerts
                          </Button>
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </div>
          </div>

          {/* Post type, school reach, service category, category, and price now
              live together in Filters. The browse header stays search + filter +
              post, while every feed-shaping choice remains one tap away. */}

          {/* "Post an Item" lives in the bottom-nav ⊞ menu - no duplicate CTA up here. */}

          {!user && (
            // Guest banner. Doubles as the ONLY route back to sign-in on the
            // native shell: BottomNav and NativeTopBar both require a user, so
            // without this a guest reaching /marketplace on iOS has no chrome
            // and no way out. Do not remove without giving guests other nav.
            <div className="w-full shrink-0 rounded-card border border-stone-200 bg-white p-3 shadow-flat sm:flex sm:items-center sm:justify-between sm:gap-4">
              <p className="mb-2 text-sm text-muted-foreground sm:mb-0">
                {t(
                  'housing:portal.marketplace.guest.banner',
                  "You're browsing as a guest. Sign in with your university email to message sellers, save items, or post your own.",
                )}
              </p>
              <Button
                size="sm"
                className="h-10 w-full shrink-0 justify-center rounded-full bg-malachite-800 text-white hover:bg-malachite-900 sm:w-auto"
                onClick={() => navigate('/auth?redirect=%2Fmarketplace')}
              >
                <Lock className="w-4 h-4 mr-2 shrink-0" aria-hidden="true" />
                {t('housing:portal.marketplace.listing.signInToStart')}
              </Button>
            </div>
          )}
        </>
      )}

      {section === 'general' && user && (
        <MarketplaceAlertsDialog
          open={alertsDialogOpen}
          onOpenChange={setAlertsDialogOpen}
          userId={user.id}
          prefill={{
            category: categoryFilter !== CATEGORY_ALL ? categoryFilter : null,
            minPrice: minPrice > PRICE_MIN ? minPrice : null,
            maxPrice: maxPrice < PRICE_MAX ? maxPrice : null,
            keywords: searchQuery,
          }}
        />
      )}

      {user && section !== 'businesses' && <MarketplaceSafetyBanner />}

      {SHOW_STUDENT_BUSINESSES && section === 'businesses' ? (
        <StudentBusinessesSection />
      ) : section === 'general' && isLoading && listings.length === 0 ? (
        <ListingGridSkeleton />
      ) : section === 'general' && fetchError && listings.length === 0 ? (
        <div role="alert" className="rounded-card border border-border bg-card p-6 text-center space-y-3">
          <p>{t('common:toast.genericError')}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            {t('common:actions.retry')}
          </Button>
        </div>
      ) : !showGrid ? (
        <EmptyState
          icon={Package}
          // First-run gets the drawing; filtered-to-empty and zero-result keep the
          // plain glyph, so the three states read as three states (Primer).
          illustration={hasSearchOrFilter ? undefined : <MovingBoxIllustration />}
          // Three states, three titles (Primer): first-run names the school
          // (tenant data, never hard-coded), a search names its own query, and a
          // filtered-empty says the filters did it, with Clear all filters below.
          title={
            hasSearchOrFilter
              ? showSavedOnly && !hasGeneralFilter && searchQuery.trim() === ''
                ? t('housing:portal.marketplace.empty.noSavedItems')
                : searchQuery.trim() !== ''
                  ? t('housing:portal.marketplace.empty.noMatchSearch', { query: searchQuery.trim() })
                  : t('housing:portal.marketplace.empty.noItemsFound')
              : t('housing:portal.marketplace.empty.firstRunTitle', { school: university.shortName })
          }
          description={
            hasSearchOrFilter
              ? showSavedOnly && !hasGeneralFilter && searchQuery.trim() === ''
                ? t('housing:portal.marketplace.empty.saveHint')
                : t('housing:portal.marketplace.empty.tryDifferent', { school: university.shortName })
              : t('housing:portal.marketplace.empty.firstRunBody')
          }
          action={
            hasSearchOrFilter ? (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                {t('common:actions.clearAllFilters')}
              </Button>
            ) : (
              /* Zero inventory is the FIRST-RUN case, not a dead end: supply is
                 seasonal, so the useful move is to be told when it arrives.
                 "Alert me" is the one primary action (Three Greens Rule) and
                 "Sell something" is the secondary outline. `variant="default"`
                 rather than a literal bg-malachite-800 so dark mode gets the
                 lighter --primary instead of a fill that vanishes into the
                 canvas. No sample listings and no blur wall here: there is
                 genuinely nothing to show, and PRODUCT.md forbids inventing
                 listings or social proof to fill the gap. */
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button size="sm" onClick={() => setAlertsDialogOpen(true)}>
                  <BellRing className="mr-2 h-4 w-4" aria-hidden />
                  {t('housing:portal.marketplace.empty.alertMe')}
                </Button>
                <Button variant="outline" size="sm" onClick={() => openPostDialog('general')}>
                  <Upload className="mr-2 h-4 w-4" aria-hidden />
                  {t('housing:portal.marketplace.empty.sellSomething')}
                </Button>
              </div>
            )
          }
        />
      ) : (
        <SneakPeekBlurWall isAuthenticated={!!user} className="w-full">
          <div className={LISTING_GRID_CLASS}>
          <AnimatePresence mode="popLayout">
          {filteredListings.map((listing, listingIndex) => (
              <motion.div
                key={listing.id}
                layout
                className="h-full"
                variants={listItemVariants}
                initial="hidden"
                animate="visible"
                exit={{ opacity: 0, scale: 0.96 }}
                custom={listingIndex}
              >
              <Card
                className={cn(
                  'flex h-full flex-col rounded-xl border border-border bg-card shadow-raised overflow-hidden transition-all hover:shadow-overlay hover:border-border cursor-pointer md:hover:-translate-y-0.5 md:hover:shadow-overlay',
                )}
                onClick={(e) => openListing(listing, e.currentTarget)}
              >
                <ListingCardImage
                  listing={listing}
                  onDelete={() => void handleDeleteListing(listing)}
                  onEdit={() => navigate(`/marketplace/edit/${listing.id}`)}
                  onLike={() => {
                    if (!user) {
                      setSignInPromptAction('save a listing');
                      return;
                    }
                    void toggleSavedItem(listing.id);
                  }}
                  canDelete={Boolean((user && listing.user_id === user.id) || (setupModeEnabled && isAdmin))}
                  canEdit={Boolean((user && listing.user_id === user.id) || (setupModeEnabled && isAdmin))}
                  canLike={Boolean(user && listing.user_id !== user.id)}
                  isLiked={savedItemIdSet.has(listing.id)}
                  deleting={deletingListingId === listing.id}
                />
                {/* Facebook-style card body: price first (bold), then title,
                    then where it is. No per-card message button - the whole card
                    opens the listing; messaging lives in the detail view. */}
                <CardContent className="flex flex-1 flex-col p-2 space-y-0.5">
                  {/* NO PAYMENTS: a service post has no price line at all. The
                      structured task summary takes the slot the price would
                      have occupied, so the card still leads with the thing you
                      decide on. */}
                  {isServiceListing(listing) ? (
                    <ServicePostSummary
                      compact
                      serviceCategory={listing.service_category}
                      serviceDate={listing.service_date}
                      serviceDurationMinutes={listing.service_duration_minutes}
                      serviceLocation={listing.service_location}
                      className="min-h-[1.25rem]"
                    />
                  ) : (listing.items?.length ?? 0) > 0 ? (
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-bold text-foreground">
                        {t('housing:portal.marketplace.listing.from')} {formatPrice(minAvailablePrice(listing.items!) ?? listing.price)}
                      </p>
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                        {t('housing:portal.marketplace.listing.itemsCount', { count: listing.items!.length })}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-bold text-foreground">{formatPrice(listing.price)}</p>
                      {/* Price drop (FB-style): struck-through original ask when the seller lowered it. */}
                      {listing.original_price != null && listing.original_price > listing.price && (
                        <p className="text-xs font-medium text-muted-foreground line-through">
                          {formatPrice(listing.original_price)}
                        </p>
                      )}
                    </div>
                  )}
                  {/* Reserve a fixed 2-line title + 1-line location slot so every
                      card computes to the same height - a uniform grid regardless
                      of how long the copy runs (falls back to a non-breaking space
                      when there's no meetup location). */}
                  {/* A sublease's headline is its BUILDING (stored as the title
                      by subleaseTitle(), so this is structured data, not prose)
                      and its date range. house_rules/additional_rules are the
                      only free text a sublease carries and they are not read
                      here at all \u2014 see subleaseTrustFields(). */}
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto min-h-11 justify-start whitespace-normal p-0 text-left text-sm font-normal text-foreground line-clamp-2 leading-tight hover:bg-transparent"
                    data-listing-open={listing.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      openListing(listing, event.currentTarget);
                    }}
                  >
                    {listing.title}
                  </Button>
                  <div className="flex min-h-[1rem] items-center gap-1.5">
                    <p className="min-w-0 flex-1 text-xs text-muted-foreground line-clamp-1">
                      {(listing.is_sublease
                        ? formatSubleaseRange(listing.sublease_start, listing.sublease_end)
                        : listing.meetup_location?.trim()) || '\u00A0'}
                    </p>
                    {/* School chip, shown ONLY on another school's listing. On
                        your own school's rows it would be noise on every card;
                        on a neighbour's it is the single fact that changes
                        whether you can walk to the meetup. Its absence therefore
                        means "your school" \u2014 which is why it must never render
                        for your own. */}
                    {otherSchoolLabel(listing) && (
                      <span
                        className="shrink-0 rounded-pill border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                        title={t('marketplace:scope.cardChipAria', {
                          school: otherSchoolLabel(listing),
                        })}
                      >
                        {t('marketplace:scope.cardChip', { school: otherSchoolLabel(listing) })}
                      </span>
                    )}
                  </div>
                  {/* Shared trust layer — identical chrome on every card type.
                      An item card carries no structured-field block and reports
                      from the detail view, so this renders exactly the status +
                      verified badges it always did. */}
                  <ListingTrustChrome
                    status={listing.status}
                    verified={Boolean(listing.verified_at)}
                    fields={
                      listing.is_sublease ? subleaseTrustFields(listing, t) : undefined
                    }
                  />
                </CardContent>
              </Card>
              </motion.div>
          ))}
          </AnimatePresence>
          </div>
        </SneakPeekBlurWall>
      )}

      {section === 'general' && showGrid && hasNextPage && (
        <div className="flex justify-center py-4">
          <Button
            type="button"
            variant="outline"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {isFetchingNextPage ? 'Loading more…' : 'Load more listings'}
          </Button>
        </div>
      )}

      {/* Empty-supply strategy: a SPARSE feed reads as dead, so name the season
          and route sellers into the multi-item "whole setup" flow. Deliberately
          `> 0`: at zero listings the EmptyState above is already the empty
          state, and rendering both stacked two empty states on one screen, each
          with its own competing call to action. This band is for a feed that
          has something in it and still looks thin. */}
      {user &&
        section === 'general' &&
        !showSavedOnly &&
        filteredListings.length > 0 &&
        filteredListings.length < 6 && (
        <div className="mt-2 rounded-xl border border-border bg-muted p-5 text-center">
          <p className="text-sm font-semibold text-foreground">
            {t('housing:portal.marketplace.empty.fillMessage')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('housing:portal.marketplace.empty.setupTip')}
          </p>
          {/* Outline, not a filled inverse: the screen's one primary action is
              elsewhere and this is a secondary nudge. Three Greens Rule. */}
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => openPostDialog('general')}
          >
            <Upload className="mr-2 h-4 w-4" />
            {t('housing:portal.marketplace.empty.listSetup')}
          </Button>
        </div>
      )}

      <SignInPromptDialog
        open={!!signInPromptAction}
        onOpenChange={(open) => !open && setSignInPromptAction(null)}
        action={signInPromptAction}
        redirectTo={
          selectedListing
            ? `/marketplace?tab=buy-sell&listing=${selectedListing.id}`
            : '/marketplace'
        }
      />

      <ReportContentDialog
        open={!!reportTarget}
        onOpenChange={(open) => !open && setReportTarget(null)}
        contentType="marketplace_listing"
        contentId={reportTarget?.contentId ?? null}
        contentLabel={reportTarget?.contentLabel ?? 'this content'}
      />

      <ListingDetailModal
        listing={selectedListing}
        open={!!selectedListing}
        originRect={zoomOrigin}
        sharedPhotoTransition={sharedPhoto}
        onClose={closeListing}
        onMessageSeller={
          user
            ? handleMessageSeller
            : () => setSignInPromptAction('message a seller')
        }
        isOwnListing={Boolean(user && selectedListing?.user_id === user.id)}
        onEdit={
          selectedListing
            ? () => navigate(`/marketplace/edit/${selectedListing.id}`)
            : undefined
        }
        onMarkAsSold={handleMarkAsSold}
        markingSold={markingSoldId === selectedListing?.id}
        onMarkAsPending={(l) => {
          void markAsPending(l.id).then((ok) => {
            if (ok) setSelectedListing((cur) => (cur && cur.id === l.id ? { ...cur, status: 'pending' } : cur));
          });
        }}
        onMarkAsAvailable={(l) => {
          void relistListing(l.id).then((ok) => {
            if (ok) setSelectedListing((cur) => (cur && cur.id === l.id ? { ...cur, status: 'available' } : cur));
          });
        }}
        onMarkItemSold={(item, listing) => void handleToggleItemStatus(item, listing, 'sold')}
        onRelistItem={(item, listing) => void handleToggleItemStatus(item, listing, 'available')}
        togglingItemId={togglingItemId}
        isSaved={selectedListing ? savedItemIdSet.has(selectedListing.id) : false}
        onToggleSave={
          selectedListing
            ? () => {
                if (!user) {
                  setSignInPromptAction('save a listing');
                  return;
                }
                void toggleSavedItem(selectedListing.id);
              }
            : undefined
        }
        isLoggedIn={!!user}
        // Reporting stays visible to guests (1.2 wants the flag affordance
        // discoverable) but filing a report needs an account, so a guest tap
        // opens the sign-in prompt instead of the report form.
        onReport={
          !user
            ? () => setSignInPromptAction('report a listing')
            : selectedListing && selectedListing.user_id !== user.id
              ? () =>
                  setReportTarget({
                    contentId: selectedListing.id,
                    contentLabel: selectedListing.title ? `"${selectedListing.title}"` : 'this listing',
                  })
              : undefined
        }
        onHide={
          selectedListing && selectedListing.user_id !== user?.id
            ? () => {
                const id = selectedListing.id;
                setHiddenListingIds((prev) => new Set(prev).add(id));
                setSelectedListing(null);
                setZoomOrigin(null);
                toast(t('housing:portal.marketplace.detail.listingHidden'));
              }
            : undefined
        }
      />
    </div>
  );
}
