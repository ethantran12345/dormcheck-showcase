import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnalytics } from '@/hooks/useAnalytics';
import { motion } from 'framer-motion';
import { Tag, MessageCircle, Pencil, CheckCircle, ChevronLeft, ChevronRight, Clock, Loader2, Heart, X, Phone, Flag, EyeOff, Share2, MoreHorizontal } from 'lucide-react';
import { useHasConversationWith } from '@/hooks/useHasConversationWith';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { InstagramLogo, SnapchatLogo } from '@/components/roommate/SocialLogos';
import { VerifiedListingBadge } from '@/components/marketplace/VerifiedListingBadge';
import { MeetupLocationMap } from '@/components/marketplace/MeetupLocationMap';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';
import { ListingShareDialog } from '@/components/marketplace/ListingShareDialog';
import { safeHref, safeSocialHandle, safeImageSrc, safeTel } from '@/lib/sanitize';
import { getMarketplaceSellerDisplayName } from '@/lib/marketplaceSellerDisplay';
import { SellerInfoCard } from '@/components/marketplace/SellerInfoCard';
import { SellerRatingsSection } from '@/components/marketplace/SellerRatingsSection';
import { PAYMENT_METHOD_LOGOS } from '@/components/marketplace/PaymentLogos';
import { SafetyTipsDialog } from '@/components/marketplace/SafetyTipsDialog';
import {
  formatPaymentMethodLabel,
  normalizePaymentMethods,
} from '@/lib/marketplacePaymentMethods';
import { ProductTagMarker } from '@/components/dorm-portal/ProductTagMarker';
import { minAvailablePrice } from '@/lib/listingItems';
import { subleaseTrustFields } from '@/lib/subleases';
import { isServiceListing, serviceStatusLabelKey } from '@/lib/servicePosts';
import { ServicePostSummary } from '@/components/marketplace/ServicePostSummary';
import { ServiceIntegrityNotice } from '@/components/marketplace/ServiceIntegrityNotice';
import { serviceCategoryNeedsIntegrityTerms, type ServiceCategory } from '@/lib/postTypes';
import { ServicePostActions } from '@/components/marketplace/ServicePostActions';
import type { MarketplaceListingItem } from '@/types';
import type { MarketplaceListing } from './MarketplaceTab';
import { ListingImage, type ListingImageKind } from '@/components/ui/listing-image';
import { LISTING_MORPH_TRANSITION } from '@/lib/motion';
import { LISTING_PHOTO_TRANSITION_NAME } from '@/lib/viewTransition';

function formatPrice(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/** Product tag shape for future backend support */
export interface ListingProductTag {
  name: string;
  url?: string;
}

/** Viewport rect of the tapped card, used to morph the modal open from it (FB-style). */
export interface ListingZoomOrigin {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface ListingDetailModalProps {
  listing: MarketplaceListing | null;
  open: boolean;
  onClose: () => void;
  onMessageSeller?: (listing: MarketplaceListing, itemName?: string) => void;
  /** Optional product tags; when present, Tag icon toggle is shown */
  productTags?: ListingProductTag[];
  isOwnListing?: boolean;
  /** When provided and isOwnListing, shows Edit button that triggers this (e.g. navigate to edit page) */
  onEdit?: () => void;
  /** When provided and isOwnListing and status is available, shows Mark as Sold button */
  onMarkAsSold?: (listing: MarketplaceListing) => void;
  /** True while marking as sold request is in progress */
  markingSold?: boolean;
  /** Owner-only: promised to a buyer but not handed off - keeps the listing in the feed with a Pending badge. */
  onMarkAsPending?: (listing: MarketplaceListing) => void;
  /** Owner-only: flip a pending listing back to available. */
  onMarkAsAvailable?: (listing: MarketplaceListing) => void;
  /** Owner-only: mark one item of a multi-item listing sold. */
  onMarkItemSold?: (item: MarketplaceListingItem, listing: MarketplaceListing) => void;
  /** Owner-only: relist one item of a multi-item listing. */
  onRelistItem?: (item: MarketplaceListingItem, listing: MarketplaceListing) => void;
  /** Item id whose sold/relist request is in flight. */
  togglingItemId?: string | null;
  /** When provided (and not own listing), shows save/favorite heart in the modal header. */
  isSaved?: boolean;
  /** Called when user clicks the heart. Caller should check auth and toast "Sign in to save" if needed. */
  onToggleSave?: () => void;
  /** When false and user clicks save, caller typically prompts sign-in. */
  isLoggedIn?: boolean;
  /** When provided (and not own listing), shows Report icon at top of content area. */
  onReport?: () => void;
  /** When provided (and not own listing), shows "Hide listing" in the ⋯ menu - dismisses this listing from the viewer's feed. */
  onHide?: () => void;
  /**
   * Rect of the tapped card (viewport coords). When set, the modal morphs open
   * *from* that rect up to fullscreen - the Facebook Marketplace "card grows into
   * the screen" feel. Omit it and the modal falls back to a centered zoom.
   */
  originRect?: ListingZoomOrigin | null;
  /**
   * Opened through a view transition from the card: the hero photo carries the
   * shared-element name so the browser morphs the card's photo into it, and the
   * framer zoom below stands down (the two would double-animate).
   */
  sharedPhotoTransition?: boolean;
}

export function ListingDetailModal({
  listing,
  open,
  onClose,
  onMessageSeller,
  productTags = [],
  isOwnListing = false,
  onEdit,
  onMarkAsSold,
  markingSold = false,
  onMarkAsPending,
  onMarkAsAvailable,
  onMarkItemSold,
  onRelistItem,
  togglingItemId = null,
  isSaved = false,
  onToggleSave,
  isLoggedIn = false,
  onReport,
  onHide,
  originRect = null,
  sharedPhotoTransition = false,
}: ListingDetailModalProps) {
  const { t } = useTranslation();
  const { track } = useAnalytics();
  // Off-platform contact (phone/socials) unlocks only after a first in-app
  // message - keeps the "verified students" promise at the point of exchange.
  const hasConversationWithSeller = useHasConversationWith(listing?.user_id);
  const [showTags, setShowTags] = useState(false);
  const [savePulseKey, setSavePulseKey] = useState(0);
  const [slideIndex, setSlideIndex] = useState(0);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const galleryScrollRef = useRef<HTMLDivElement>(null);
  const ratingsSectionRef = useRef<HTMLDivElement>(null);
  // Desktop mouse drag-to-swipe state (touch/trackpad already scroll natively).
  const galleryDragRef = useRef({ startX: 0, startScroll: 0, active: false, moved: false });

  useEffect(() => {
    if (!open) setDescExpanded(false);
  }, [open, listing?.id]);

  useEffect(() => {
    if (!open || !listing) return;
    track('marketplace_listing_viewed', {
      listing_id: listing.id,
      category: listing.category ?? '',
    });
  }, [open, listing, track]);

  useEffect(() => {
    if (!open) {
      setSlideIndex(0);
      if (galleryScrollRef.current) {
        galleryScrollRef.current.scrollLeft = 0;
      }
    }
  }, [open, listing?.id]);

  const handleSaveClick = useCallback(() => {
    haptic.medium();
    if (!onToggleSave) return;
    if (!isLoggedIn) {
      onToggleSave();
      return;
    }
    setSavePulseKey((k) => k + 1);
    onToggleSave();
  }, [onToggleSave, isLoggedIn]);

  const handleShare = useCallback(() => {
    haptic.light();
    setShareOpen(true);
  }, []);

  const handleClose = () => {
    setShowTags(false);
    onClose();
  };

  const galleryImages = useMemo(() => {
    // '' is the no-photo slide: ListingImage renders its designed fallback for
    // it, so the gallery keeps exactly one slide instead of a grey placeholder.
    if (!listing) return [''];
    const urls = (listing.image_urls ?? [])
      .map((u) => safeImageSrc(u))
      .filter((u): u is string => u != null);
    return urls.length > 0 ? urls : [''];
  }, [listing]);

  const hasMultipleImages = galleryImages.length > 1;
  const listingImageKind: ListingImageKind =
    listing?.is_sublease || listing?.post_type === 'sublease'
      ? 'sublease'
      : listing?.post_type === 'request_help' || listing?.post_type === 'offer_help'
        ? 'service'
        : 'item';
  const hasTags = productTags.length > 0;
  const listingItems = useMemo(() => listing?.items ?? [], [listing?.items]);
  const hasItems = listingItems.length > 0;
  // Item tags stay visible by default (dimmed dots read as sold); the eye toggle hides them.
  const [itemTagsVisible, setItemTagsVisible] = useState(true);

  const handleSlideTap = useCallback(() => {
    if (!hasTags) return;
    // A click that was really a drag-swipe shouldn't toggle the tag overlay.
    if (galleryDragRef.current.moved) return;
    setShowTags((t) => !t);
  }, [hasTags]);

  const handleGalleryScroll = useCallback(() => {
    const el = galleryScrollRef.current;
    if (!el || el.clientWidth <= 0) return;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    setSlideIndex(Math.min(Math.max(0, index), galleryImages.length - 1));
  }, [galleryImages.length]);

  const scrollToSlide = useCallback(
    (index: number) => {
      const el = galleryScrollRef.current;
      if (!el || el.clientWidth <= 0) return;
      const clamped = Math.min(Math.max(0, index), galleryImages.length - 1);
      el.scrollTo({ left: clamped * el.clientWidth, behavior: 'smooth' });
    },
    [galleryImages.length]
  );

  // Facebook-style click-drag to swipe between photos on desktop. Touch and
  // trackpad already pan the native scroll container (`[touch-action:pan-x]`),
  // so we only wire this up for a real mouse - otherwise it would fight the
  // OS momentum scroll. We suppress CSS smooth-scroll while dragging so the
  // photo tracks the cursor 1:1, then snap to the nearest slide on release.
  const handleGalleryPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType !== 'mouse' || !hasMultipleImages) return;
      const el = galleryScrollRef.current;
      if (!el) return;
      galleryDragRef.current = {
        startX: e.clientX,
        startScroll: el.scrollLeft,
        active: true,
        moved: false,
      };
      el.style.scrollBehavior = 'auto';
    },
    [hasMultipleImages]
  );

  const handleGalleryPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = galleryDragRef.current;
      if (!drag.active) return;
      const el = galleryScrollRef.current;
      if (!el) return;
      const dx = e.clientX - drag.startX;
      if (Math.abs(dx) > 4) drag.moved = true;
      el.scrollLeft = drag.startScroll - dx;
    },
    []
  );

  const endGalleryDrag = useCallback(() => {
    const drag = galleryDragRef.current;
    if (!drag.active) return;
    drag.active = false;
    const el = galleryScrollRef.current;
    if (el) {
      el.style.scrollBehavior = '';
      if (el.clientWidth > 0) {
        scrollToSlide(Math.round(el.scrollLeft / el.clientWidth));
      }
    }
    // Clear the drag flag after the click event has had its chance to fire.
    requestAnimationFrame(() => {
      galleryDragRef.current.moved = false;
    });
  }, [scrollToSlide]);

  if (!listing) return null;

  const sellerDisplayName = getMarketplaceSellerDisplayName(listing.profiles);
  const paymentMethods = normalizePaymentMethods(listing.payment_methods);
  const listingStatus = listing.status ?? 'available';
  const isActive = listingStatus === 'available';
  const isPending = listingStatus === 'pending';
  const contactUnlocked = isOwnListing || hasConversationWithSeller;
  const descriptionText = listing.description?.trim() ?? '';
  const isDescriptionLong =
    descriptionText.length > 160 || (descriptionText.match(/\n/g)?.length ?? 0) >= 4;
  // Price drop (Facebook-style): only single-price listings show it - multi-item
  // cards render "From $X" and their price shifts as items sell, which isn't a
  // seller markdown. `original_price` is the immutable first ask (migration
  // 20260719140000); a drop is original > current.
  const originalPrice = listing.original_price ?? null;
  const hasPriceDrop = !hasItems && originalPrice != null && originalPrice > listing.price;
  // Condition and Category are ITEM facts. Every row carries the columns (the
  // table is shared and `category` defaults to 'Other'), so a service post read
  // them straight out of the DB and rendered "Condition: Good / Category: Other"
  // on a request for a hand carrying boxes. The type decides, not the column.
  const showsItemFacts = !isServiceListing(listing);
  const conditionText = showsItemFacts ? (listing.condition?.trim() ?? '') : '';
  // Structured sublease terms, shared with the feed card via one helper so the
  // two surfaces cannot drift into showing different facts about one listing.
  // Plain call, not a useMemo: this sits below the component's early return, so
  // a hook here would be conditional (rules-of-hooks). It maps at most five
  // fields off one row — memoizing it would cost more than it saves.
  const subleaseDetailFields = listing.is_sublease ? subleaseTrustFields(listing, t) : [];
  const houseRulesText = listing.house_rules?.trim() ?? '';
  const additionalRulesText = listing.additional_rules?.trim() ?? '';
  const categoryText = showsItemFacts && listing.category?.trim() ? listing.category.trim() : '';
  const meetupLocation = listing.meetup_location?.trim() ?? '';
  const instagramHandle =
    listing.show_instagram && listing.instagram_handle
      ? String(listing.instagram_handle).trim()
      : '';
  const snapchatHandle =
    listing.show_snapchat && listing.snapchat_handle
      ? String(listing.snapchat_handle).trim()
      : '';
  const instagramUsername = safeSocialHandle(instagramHandle);
  const snapchatUsername = safeSocialHandle(snapchatHandle);
  const phoneRaw =
    listing.show_phone && listing.phone_number
      ? String(listing.phone_number).trim()
      : '';
  const phoneDisplay = phoneRaw ? safeTel(phoneRaw) : '';

  const pillButtonClass =
    'flex h-10 min-h-[40px] w-10 min-w-[40px] items-center justify-center rounded-full bg-black/45 text-white ring-1 ring-white/15 backdrop-blur-md transition-colors hover:bg-black/60 active:scale-95';

  // Morph open from the tapped card's rect (FB-style). The full-screen wrapper is
  // shrunk to sit over the card (uniform scale by width, top-left pinned to the
  // card) then springs up to fill - a deliberate "enlarge into fullscreen" instead
  // of an instant pop. Falls back to a centered zoom when no rect was captured
  // (e.g. deep links). `vw > 0` guards SSR / zero-size edge cases.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
  const zoomOrigin =
    originRect && vw > 0
      ? {
          scale: Math.max(0.05, originRect.width / vw),
          x: originRect.left,
          y: originRect.top,
        }
      : null;

  return (
    <>
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent
        overlayClassName="!bg-black/40"
        className={cn(
          // Mobile: force edge-to-edge (override shadcn/Radix centering, max-w-lg, border, padding).
          '!fixed !inset-0 !left-0 !top-0 !right-0 !bottom-0 !z-[10061] !m-0',
          '!flex !h-[100dvh] !min-h-[100dvh] !max-h-[100dvh] !w-screen !max-w-none',
          '!translate-x-0 !translate-y-0',
          'flex-col gap-0 overflow-hidden overflow-x-hidden',
          '!rounded-none !border-0 !bg-card !p-0 !shadow-none',
          // The positioned content can't animate `transform` (its !translate
          // override beats the CSS keyframe), so the zoom lives on the inner
          // Framer wrapper below. Here we keep only the backdrop fade.
          'ease-ios',
          // Desktop: full-screen takeover (Facebook Marketplace style) - photo pane
          // left, details column right. Same !important override stack the mobile
          // branch already relies on.
          'md:!inset-0 md:!left-0 md:!top-0 md:!h-[100dvh] md:!min-h-[100dvh] md:!max-h-[100dvh] md:!w-screen md:!max-w-none md:!translate-x-0 md:!translate-y-0',
          'md:!rounded-none md:!border-0 md:!shadow-none',
          '[&>:last-child]:hidden',
        )}
      >
        {/* The actual zoom: scale this inner wrapper (transform is free here,
            unlike the positioned DialogContent). Grows up over the faded backdrop
 - the Facebook "expand into full screen" feel. */}
        <motion.div
          className="relative flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden bg-card"
          initial={
            sharedPhotoTransition
              ? false
              : zoomOrigin
                ? { scale: zoomOrigin.scale, x: zoomOrigin.x, y: zoomOrigin.y, opacity: 0.35 }
                : { scale: 0.9, opacity: 0 }
          }
          animate={{ scale: 1, x: 0, y: 0, opacity: 1 }}
          transition={LISTING_MORPH_TRANSITION}
          style={{ transformOrigin: zoomOrigin ? 'top left' : 'center' }}
        >
        <DialogTitle className="sr-only">{listing.title}</DialogTitle>
        {/* Persistent close pill - always visible over the photo (top-left).
            The ⋯ menu moved into the right-column action row (FB-style, inline
            with Message/heart/share) so nothing floats over the details pane. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-start justify-between gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:pt-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleClose();
            }}
            className={cn(pillButtonClass, 'pointer-events-auto')}
            aria-label={t('common:actions.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mobile: single scroll surface - the photo scrolls up with the rest.
            Desktop: two-column takeover - dark photo pane left, details column
            right, each managing its own overflow (Facebook Marketplace style). */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain bg-card [touch-action:pan-y] md:grid md:min-h-0 md:grid-cols-[minmax(0,1fr)_500px] md:overflow-hidden lg:grid-cols-[minmax(0,1fr)_600px] xl:grid-cols-[minmax(0,1fr)_680px]">
        {/* Hero image gallery - edge to edge on mobile; letterboxed on black on desktop */}
        <div
          className="relative w-full aspect-[4/5] max-h-[62vh] bg-muted md:aspect-auto md:h-full md:min-h-0 md:max-h-none md:bg-black"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div
            ref={galleryScrollRef}
            onScroll={handleGalleryScroll}
            onPointerDown={handleGalleryPointerDown}
            onPointerMove={handleGalleryPointerMove}
            onPointerUp={endGalleryDrag}
            onPointerLeave={endGalleryDrag}
            onPointerCancel={endGalleryDrag}
            className={cn(
              'flex h-full w-full overflow-x-auto scrollbar-hide bg-muted [touch-action:pan-x]',
              hasMultipleImages && 'snap-x snap-mandatory scroll-smooth select-none md:cursor-grab md:active:cursor-grabbing',
            )}
          >
            {galleryImages.map((src, index) => (
              <div
                key={`${src}-${index}`}
                className={cn(
                  'relative flex h-full w-full shrink-0 items-center justify-center overflow-hidden',
                  hasMultipleImages && 'snap-center snap-always',
                )}
              >
                {/* Blurred fill (Facebook-style): a scaled, dimmed copy of the same
                    photo fills the letterbox zones the contained image leaves on
                    desktop. Desktop-only - mobile uses object-cover, which fills
                    the 4/5 frame, so the backdrop would never show. */}
                {src ? (
                  <img
                    src={src}
                    alt=""
                    aria-hidden
                    className="pointer-events-none absolute inset-0 hidden h-full w-full scale-125 object-cover blur-2xl brightness-[0.55] md:block"
                    draggable={false}
                  />
                ) : null}
                <button
                  type="button"
                  style={
                    sharedPhotoTransition && index === 0
                      ? { viewTransitionName: LISTING_PHOTO_TRANSITION_NAME }
                      : undefined
                  }
                  className={cn(
                    'relative flex h-full w-full items-center justify-center',
                    hasTags && 'cursor-pointer',
                  )}
                  onClick={hasTags ? handleSlideTap : undefined}
                  aria-label={hasTags ? 'Photo actions' : undefined}
                >
                  {/* Same primitive as the feed card: centred cover crop on the
                      phone, contained over the blurred fill on desktop, designed
                      fallback when the photo is missing or fails. */}
                  <ListingImage
                    src={src}
                    alt={listing.title}
                    kind={listingImageKind}
                    thumbWidth={1600}
                    quality={80}
                    priority={index === 0}
                    aspectClassName="h-full w-full"
                    className="md:bg-transparent"
                    imgClassName="md:object-contain"
                  />
                </button>
                {/* Item tags for this photo (multi-item listings) */}
                {itemTagsVisible &&
                  listingItems
                    .filter((item) => item.x !== null && item.y !== null && item.photo_index === index)
                    .map((item) => (
                      <ProductTagMarker
                        key={item.id}
                        xPct={(item.x ?? 0) * 100}
                        yPct={(item.y ?? 0) * 100}
                        label={
                          item.status === 'sold'
                            ? `${item.name} · Sold`
                            : `${item.name} · ${formatPrice(item.price)}`
                        }
                        className={item.status === 'sold' ? 'opacity-50' : undefined}
                      />
                    ))}
              </div>
            ))}
          </div>

          {hasMultipleImages && (
            <span className="absolute bottom-3 right-3 z-30 rounded-full bg-black/50 px-2.5 py-1 text-xs font-medium text-white">
              {t('housing:portal.marketplace.detail.imageCounter', { current: slideIndex + 1, total: galleryImages.length })}
            </span>
          )}

          {/* Bottom thumbnail strip (Facebook-style) - centered over the photo.
              Desktop-only so it doesn't crowd the swipe-driven mobile gallery,
              which keeps its counter. Tapping a thumb scrolls to that slide. */}
          {hasMultipleImages && (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 hidden justify-center px-16 md:flex">
              <div className="pointer-events-auto flex max-w-full gap-2 overflow-x-auto rounded-xl bg-black/40 p-1.5 backdrop-blur-md">
                {galleryImages.map((src, index) => (
                  <button
                    key={`thumb-${src}-${index}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      scrollToSlide(index);
                    }}
                    className={cn(
                      'h-12 w-12 shrink-0 overflow-hidden rounded-lg ring-2 transition',
                      index === slideIndex
                        ? 'ring-white'
                        : 'opacity-70 ring-transparent hover:opacity-100',
                    )}
                    aria-label={t('housing:portal.marketplace.detail.viewPhoto', { index: index + 1 })}
                    aria-current={index === slideIndex}
                  >
                    <ListingImage
                      src={src}
                      alt=""
                      kind={listingImageKind}
                      thumbWidth={96}
                      aspectClassName="h-full w-full"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Desktop-only carousel arrows (Facebook-style white circles) */}
          {hasMultipleImages && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  scrollToSlide(slideIndex - 1);
                }}
                disabled={slideIndex === 0}
                className="absolute left-4 top-1/2 z-30 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-card text-foreground shadow-raised transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40 md:flex"
                aria-label={t('housing:portal.marketplace.detail.previousPhoto')}
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  scrollToSlide(slideIndex + 1);
                }}
                disabled={slideIndex === galleryImages.length - 1}
                className="absolute right-4 top-1/2 z-30 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-card text-foreground shadow-raised transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40 md:flex"
                aria-label={t('housing:portal.marketplace.detail.nextPhoto')}
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}

          {/* Item-tag visibility toggle (multi-item listings) - bottom left */}
          {hasItems && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setItemTagsVisible((v) => !v); }}
              className={cn(
                'absolute bottom-3 left-3 z-30 h-9 w-9 rounded-full flex items-center justify-center border transition-colors',
                itemTagsVisible
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-black/50 text-white border-white/20 hover:bg-black/70',
              )}
              aria-label={itemTagsVisible ? t('housing:portal.marketplace.detail.hideItemTags') : t('housing:portal.marketplace.detail.showItemTags')}
            >
              <Tag className="w-4 h-4" />
            </button>
          )}

          {/* Tag toggle - bottom left */}
          {hasTags && !hasItems && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowTags((t) => !t); }}
              className={cn(
                'absolute bottom-3 left-3 z-30 h-9 w-9 rounded-full flex items-center justify-center border transition-colors',
                showTags
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-black/50 text-white border-white/20 hover:bg-black/70',
              )}
              aria-label={showTags ? t('housing:portal.marketplace.detail.hideTags') : t('housing:portal.marketplace.detail.showProductTags')}
            >
              <Tag className="w-4 h-4" />
            </button>
          )}

          {/* Tags overlay panel */}
          {hasTags && showTags && (
            <div
              className="absolute bottom-12 left-3 right-3 z-30 rounded-lg bg-card/95 backdrop-blur-sm border border-border shadow-overlay p-3 max-h-32 overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
              role="presentation"
            >
              <p className="text-xs font-semibold text-muted-foreground mb-2">{t('housing:portal.marketplace.detail.productTags')}</p>
              <ul className="space-y-1">
                {productTags.map((tag, i) => {
                  const safeUrl = safeHref(tag.url);
                  return (
                    <li key={i}>
                      {safeUrl ? (
                        <a
                          href={safeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-foreground hover:underline"
                        >
                          {tag.name}
                        </a>
                      ) : (
                        <span className="text-sm text-foreground">{tag.name}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* Right column on desktop: header/scroll/footer stack. Plain flow on mobile. */}
        <div className="md:flex md:h-full md:min-h-0 md:flex-col md:overflow-hidden md:border-l md:border-border md:bg-card">
        {/* Content - extra top padding so the listing sits a little lower and
            the persistent top pills read as their own zone (FB-style). */}
        <div className="flex flex-col gap-6 bg-card px-5 pb-6 pt-6 md:min-h-0 md:flex-1 md:overflow-y-auto md:px-8 md:pb-8 md:pt-8">
            {/* Title + price */}
            <div>
              <h2 className="font-display text-2xl font-semibold leading-tight text-foreground">
                {listing.title}
              </h2>
              {/* NO PAYMENTS: a service post shows its structured task details
                  where an item shows a price. There is no amount on the row (it
                  is 0 by DB CHECK) and no amount to render. */}
              {isServiceListing(listing) ? (
                <div className="mt-2 space-y-2">
                  <ServicePostSummary
                    serviceCategory={listing.service_category}
                    serviceDate={listing.service_date}
                    serviceDurationMinutes={listing.service_duration_minutes}
                    serviceLocation={listing.service_location}
                  />
                  {listing.service_notes && (
                    <p className="whitespace-pre-line text-sm text-foreground">
                      {listing.service_notes}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">{t('marketplace:service.noMoney')}</p>
                  {/* The reader sees the same academic-integrity terms the poster
                      acknowledged. Putting it only on the create form would mean
                      the person being asked to hand over an assignment never
                      reads the rule that says they should not. */}
                  {serviceCategoryNeedsIntegrityTerms(
                    listing.service_category as ServiceCategory | null,
                  ) && <ServiceIntegrityNotice />}
                  <ServicePostActions listing={listing} />
                </div>
              ) : (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="text-3xl font-bold tracking-tight text-foreground">
                  {hasItems
                    ? t('housing:portal.marketplace.detail.from', { price: formatPrice(minAvailablePrice(listingItems) ?? listing.price) })
                    : formatPrice(listing.price)}
                </span>
                {hasPriceDrop && originalPrice != null && (
                  <>
                    <span className="text-lg font-medium text-muted-foreground line-through">
                      {formatPrice(originalPrice)}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-foreground">
                      {t('housing:portal.marketplace.detail.priceDrop', { amount: formatPrice(originalPrice - listing.price) })}
                    </span>
                  </>
                )}
                {listing.price_negotiable && (
                  <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    {t('housing:portal.marketplace.detail.negotiable')}
                  </span>
                )}
                {listing.verified_at && <VerifiedListingBadge />}
              </div>
              )}
              {listing.created_at && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {t('housing:portal.marketplace.detail.listedTime', { time: formatDistanceToNow(new Date(listing.created_at), { addSuffix: true }) })}
                </p>
              )}
            </div>

            {/* Action row - Message primary + heart + share, high up the page
                (Facebook Marketplace style). The like is a bare heart (no "Save"
                label); share hands off a real deep link back to this listing. */}
            <div className="flex items-center gap-2 border-b border-border pb-6">
              {!isOwnListing && (
                <>
                {onMessageSeller && (
                  <Button
                    // KEEP: primary CTA of the listing modal (message seller), desktop action row
                    className="hidden h-12 flex-1 gap-2 bg-malachite-800 text-base font-semibold text-white hover:bg-malachite-900 md:inline-flex"
                    onClick={() => onMessageSeller(listing)}
                  >
                    <MessageCircle className="h-4 w-4" />
                    {t(
                      // Nobody is selling on a service post; the same button,
                      // named for what it does.
                      showsItemFacts
                        ? 'housing:portal.marketplace.detail.messageSeller'
                        : 'marketplace:service.messagePoster',
                    )}
                  </Button>
                )}
                {onToggleSave && (
                  <button
                    type="button"
                    onClick={handleSaveClick}
                    className={cn(
                      'flex h-12 w-12 shrink-0 items-center justify-center rounded-full border transition-colors',
                      isSaved
                        ? 'border-[#FF6B6B]/30 bg-[#FF6B6B]/10 text-[#FF6B6B]'
                        : 'border-border bg-card text-foreground hover:bg-muted',
                    )}
                    aria-label={isSaved ? t('common:actions.removeFromSaved') : t('common:actions.save')}
                  >
                    <motion.span
                      key={savePulseKey}
                      initial={false}
                      animate={{ scale: [1, 1.25, 1, 1.15, 1] }}
                      transition={{ duration: 0.4 }}
                      className="inline-flex"
                    >
                      <Heart
                        className={cn('h-5 w-5', isSaved && 'fill-[#FF6B6B]')}
                        strokeWidth={isSaved ? 0 : 2}
                      />
                    </motion.span>
                  </button>
                )}
                </>
              )}
                <button
                  type="button"
                  onClick={handleShare}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-muted"
                  aria-label={t('common:actions.share')}
                >
                  <Share2 className="h-5 w-5" />
                </button>
                {!isOwnListing && (onReport || onHide) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-muted"
                        aria-label={t('common:menu.moreOptions')}
                      >
                        <MoreHorizontal className="h-5 w-5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="z-[10070] w-72">
                      {onHide && (
                        <DropdownMenuItem
                          onSelect={() => onHide()}
                          className="items-start gap-3 py-2.5"
                        >
                          <EyeOff className="mt-0.5 h-5 w-5 shrink-0 text-foreground" />
                          <span className="flex flex-col">
                            <span className="text-sm font-semibold text-foreground">
                              {t('housing:portal.marketplace.detail.hideListing')}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {t('housing:portal.marketplace.detail.hideListingHint')}
                            </span>
                          </span>
                        </DropdownMenuItem>
                      )}
                      {onReport && (
                        <DropdownMenuItem
                          onSelect={() => onReport()}
                          className="items-start gap-3 py-2.5"
                        >
                          <Flag className="mt-0.5 h-5 w-5 shrink-0 text-foreground" />
                          <span className="flex flex-col">
                            <span className="text-sm font-semibold text-foreground">
                              {t('housing:portal.marketplace.detail.reportListing')}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {t('housing:portal.marketplace.detail.reportListingHint')}
                            </span>
                          </span>
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

            {/* Seller card - avatar, name, verified badge, rating summary
                (Report/Block live in the top ⋯ menu) */}
            <SellerInfoCard
              sellerId={listing.user_id}
              displayName={sellerDisplayName}
              // The LISTING's school, not the viewer's — with the shared
              // Pittsburgh feed these differ, and the badge under the seller's
              // name is exactly where that must not be guessed.
              sellerUniversityId={listing.university_id}
              onShowRatings={() =>
                ratingsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
              }
            />

            {/* Items in this listing (multi-item listings) - each with its own
                price and sold state; owner gets per-item sold/relist toggles. */}
            {hasItems && (
              <div>
                <h3 className="mb-3 font-display text-lg font-semibold text-foreground">
                  {t('housing:portal.marketplace.detail.itemsInListing')}
                </h3>
                <ul className="space-y-1.5">
                  {listingItems.map((item) => {
                    const sold = item.status === 'sold';
                    const tagged = item.x !== null;
                    return (
                      <li
                        key={item.id}
                        className={cn(
                          'flex min-h-12 items-center gap-3 border-b border-border px-1 py-3 last:border-b-0',
                          sold && 'bg-muted/50',
                        )}
                      >
                        {tagged ? (
                          <button
                            type="button"
                            onClick={() => {
                              setItemTagsVisible(true);
                              scrollToSlide(item.photo_index);
                            }}
                            className="shrink-0 p-0.5 text-muted-foreground hover:text-foreground"
                            aria-label={t('housing:portal.marketplace.detail.showItemOnPhoto', { itemName: item.name })}
                          >
                            <Tag className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        )}
                        <span
                          className={cn(
                            'min-w-0 flex-1 truncate text-sm text-foreground',
                            sold && 'text-muted-foreground line-through',
                          )}
                        >
                          {item.name}
                        </span>
                        {sold && (
                          <span className="shrink-0 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-400">
                            {t('housing:portal.marketplace.status.sold')}
                          </span>
                        )}
                        <span
                          className={cn(
                            'shrink-0 text-sm font-semibold',
                            sold ? 'text-muted-foreground' : 'text-foreground',
                          )}
                        >
                          {formatPrice(item.price)}
                        </span>
                        {!isOwnListing && onMessageSeller && !sold && (
                          <button
                            type="button"
                            onClick={() => onMessageSeller(listing, item.name)}
                            className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            aria-label={t('housing:portal.marketplace.detail.messageAboutItem', { itemName: item.name })}
                          >
                            <MessageCircle className="h-4 w-4" />
                          </button>
                        )}
                        {isOwnListing && (onMarkItemSold || onRelistItem) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 shrink-0 rounded-full px-2.5 text-xs"
                            disabled={togglingItemId === item.id}
                            onClick={() =>
                              sold ? onRelistItem?.(item, listing) : onMarkItemSold?.(item, listing)
                            }
                          >
                            {togglingItemId === item.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : sold ? (
                              t('housing:portal.marketplace.detail.relist')
                            ) : (
                              t('housing:portal.marketplace.detail.markSold')
                            )}
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Details + description unified into one block (Facebook-style):
                condition / category / status as inline label→value rows, with the
                description flowing right underneath instead of in its own bubble. */}
            {(conditionText || categoryText || descriptionText || listingStatus) && (
              <div className="rounded-card bg-muted/40 p-5">
                <h3 className="mb-3 font-display text-lg font-semibold text-foreground">
                  {descriptionText
                    ? t('housing:portal.marketplace.detail.description')
                    : t('housing:portal.marketplace.detail.details')}
                </h3>
                {/* Facebook-style: plain label→value lines (no box), then the
                    description flows right underneath, tight to the details. */}
                <dl className="space-y-2 text-[15px] leading-relaxed">
                  {/* Sublease terms lead the details block: dates, utilities,
                      furnished, parking, preference — every one a typed column.
                      house_rules / additional_rules are deliberately absent here
                      and render below the description, last on the page. */}
                  {subleaseDetailFields.map((field) => (
                    <div key={field.label} className="grid grid-cols-[minmax(7rem,0.8fr)_1.2fr] gap-3">
                      <dt className="text-muted-foreground">{field.label}</dt>
                      <dd className="text-foreground/80">{field.value}</dd>
                    </div>
                  ))}
                  {conditionText && (
                    <div className="grid grid-cols-[minmax(7rem,0.8fr)_1.2fr] gap-3">
                      <dt className="text-muted-foreground">{t('housing:portal.marketplace.detail.condition')}</dt>
                      <dd className="capitalize text-foreground/80">{conditionText}</dd>
                    </div>
                  )}
                  {categoryText && (
                    <div className="grid grid-cols-[minmax(7rem,0.8fr)_1.2fr] gap-3">
                      <dt className="text-muted-foreground">{t('housing:portal.marketplace.detail.category')}</dt>
                      <dd className="capitalize text-foreground/80">{categoryText}</dd>
                    </div>
                  )}
                  {/* Two lifecycles, and this row used to know only one. The
                      three-way available|pending|else fell THROUGH to red
                      "Sold" for every service post, because a service status is
                      open|claimed|completed — so an open tutoring request read
                      "Status: Sold" in red, which is both wrong and the exact
                      word a priceless post must never show. Found in a browser
                      at 390x844, 2026-08-16. The service branch reuses
                      serviceStatusLabelKey() (Open / Taken / Done) rather than
                      inventing a second label set. */}
                  <div className="grid grid-cols-[minmax(7rem,0.8fr)_1.2fr] gap-3">
                    <dt className="text-muted-foreground">{t('housing:portal.marketplace.detail.status')}</dt>
                    {isServiceListing(listing) ? (
                      <dd
                        className={cn(
                          'font-medium',
                          listingStatus === 'open'
                            ? 'text-foreground'
                            : listingStatus === 'claimed'
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-foreground/70',
                        )}
                      >
                        {t(serviceStatusLabelKey(listingStatus))}
                      </dd>
                    ) : (
                      <dd
                        className={cn(
                          'font-medium',
                          isActive ? 'text-foreground' : isPending ? 'text-amber-700 dark:text-amber-400' : 'text-red-600 dark:text-red-400',
                        )}
                      >
                        {isActive ? t('housing:portal.marketplace.status.active') : isPending ? t('housing:portal.marketplace.status.pending') : t('housing:portal.marketplace.status.sold')}
                      </dd>
                    )}
                  </div>
                </dl>
                {descriptionText && (
                  <div className="mt-2">
                    <p
                      className={cn(
                        'whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground/90',
                        !descExpanded && 'line-clamp-4',
                      )}
                    >
                      {descriptionText}
                    </p>
                    {isDescriptionLong && (
                      <button
                        type="button"
                        onClick={() => setDescExpanded((v) => !v)}
                        className="mt-1 text-sm font-semibold text-foreground hover:underline"
                      >
                        {descExpanded ? t('common:actions.seeLess') : t('common:actions.seeMore')}
                      </button>
                    )}
                  </div>
                )}
                {/* The only free text a sublease carries. Last on the page, under
                    every structured fact, and never a headline anywhere — the
                    rule that keeps a sublease card from becoming a billboard. */}
                {listing.is_sublease && (houseRulesText || additionalRulesText) && (
                  <div className="mt-3 space-y-2">
                    {houseRulesText && (
                      <div>
                        <h4 className="text-sm font-semibold text-foreground">
                          {t('marketplace:sublease.houseRules')}
                        </h4>
                        <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground/90">
                          {houseRulesText}
                        </p>
                      </div>
                    )}
                    {additionalRulesText && (
                      <div>
                        <h4 className="text-sm font-semibold text-foreground">
                          {t('marketplace:sublease.additionalRules')}
                        </h4>
                        <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground/90">
                          {additionalRulesText}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Accepted payments */}
            {paymentMethods.length > 0 && (
              <div>
                <h3 className="mb-3 font-display text-lg font-semibold text-foreground">
                  {t('housing:portal.marketplace.detail.acceptedPayments')}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {paymentMethods.map((method) => {
                    const Logo = PAYMENT_METHOD_LOGOS[method];
                    return (
                      <span
                        key={method}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-1.5 pr-3 text-xs font-medium text-foreground"
                      >
                        <Logo className="h-4 w-4" />
                        {formatPaymentMethodLabel(method)}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Location */}
            {meetupLocation && (
              <MeetupLocationMap
                location={meetupLocation}
                listingUniversityId={listing.university_id}
              />
            )}

            {/* Other contact options - demoted behind the first in-app message so the
                trade starts on the verified surface. Owners always see their own. */}
            {(phoneDisplay || instagramUsername || snapchatUsername) && !contactUnlocked && (
              <div className="rounded-lg border border-dashed border-border bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
                {t('housing:portal.marketplace.detail.contactUnlockHint')}
              </div>
            )}
            {(phoneDisplay || instagramUsername || snapchatUsername) && contactUnlocked && (
              <div>
                {!isOwnListing && (
                  <h3 className="mb-2 text-base font-semibold text-foreground">{t('housing:portal.marketplace.detail.otherContactOptions')}</h3>
                )}
                <div className="flex flex-wrap gap-2">
                {phoneDisplay && (
                  <a
                    href={`tel:${phoneDisplay.replace(/\s/g, '')}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <Phone className="w-4 h-4 text-muted-foreground" strokeWidth={1.75} />
                    {phoneDisplay}
                  </a>
                )}
                {instagramUsername && (
                  <a
                    href={`https://instagram.com/${encodeURIComponent(instagramUsername)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <InstagramLogo className="w-4 h-4 shrink-0" />
                    @{instagramUsername}
                  </a>
                )}
                {snapchatUsername && (
                  <a
                    href={`https://snapchat.com/add/${encodeURIComponent(snapchatUsername)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <SnapchatLogo className="w-4 h-4 shrink-0" />
                    @{snapchatUsername}
                  </a>
                )}
                </div>
              </div>
            )}

            {/* Seller ratings - summary, rate/edit form for eligible viewers, reviews list */}
            <SellerRatingsSection
              ref={ratingsSectionRef}
              sellerId={listing.user_id}
              sellerName={sellerDisplayName}
              listingId={listing.id}
              className="border-t border-border pt-4"
            />

            {isOwnListing && onEdit && (
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  className="flex-1 gap-2 rounded-full border-border px-3 py-2 text-sm font-medium hover:border-border"
                  onClick={() => {
                    handleClose();
                    onEdit();
                  }}
                >
                  <Pencil className="w-4 h-4" />
                  {t('common:actions.edit')}
                </Button>
                {isActive && onMarkAsPending && (
                  <Button
                    variant="outline"
                    className="flex-1 gap-2 rounded-full border-amber-400 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50 hover:text-amber-800"
                    onClick={() => onMarkAsPending(listing)}
                  >
                    <Clock className="w-4 h-4" />
                    {t('housing:portal.marketplace.detail.markPending')}
                  </Button>
                )}
                {isPending && onMarkAsAvailable && (
                  <Button
                    variant="outline"
                    className="flex-1 gap-2 rounded-full border-border px-3 py-2 text-sm font-medium"
                    onClick={() => onMarkAsAvailable(listing)}
                  >
                    {t('housing:portal.marketplace.detail.backToAvailable')}
                  </Button>
                )}
                {(isActive || isPending) && onMarkAsSold && (
                  <Button
                    variant="outline"
                    className="flex-1 gap-2 rounded-full border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent hover:text-foreground"
                    onClick={() => onMarkAsSold(listing)}
                    disabled={markingSold}
                  >
                    {markingSold ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle className="w-4 h-4" />
                    )}
                    {t('housing:portal.marketplace.detail.markAsSold')}
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Desktop footer - Message now lives in the top action row (FB-style),
              so the footer is just the safety-tips link. */}
          <div className="hidden shrink-0 border-t border-border bg-card px-6 py-4 md:block">
            <div className="text-center">
              <button
                type="button"
                onClick={() => setSafetyOpen(true)}
                className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
              >
                {t('housing:portal.marketplace.detail.safetyTips')}
              </button>
            </div>
          </div>
        </div>
        </div>

        {/* Mobile sticky footer - below the single scroll surface */}
        <div className="shrink-0 border-t border-border bg-card px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
          <div className={cn('text-center', !isOwnListing && onMessageSeller && 'mb-3')}>
            <button
              type="button"
              onClick={() => setSafetyOpen(true)}
              className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
            >
              {t('housing:portal.marketplace.detail.safetyTips')}
            </button>
          </div>
          {!isOwnListing && onMessageSeller && (
            <Button
              // KEEP: same primary CTA, mobile sticky-footer variant (never both at once)
              className="h-11 w-full gap-2 bg-malachite-800 text-base font-semibold text-white hover:bg-malachite-900"
              onClick={() => onMessageSeller(listing)}
            >
              <MessageCircle className="w-4 h-4" />
              {t(
                showsItemFacts
                  ? 'housing:portal.marketplace.detail.messageSeller'
                  : 'marketplace:service.messagePoster',
              )}
            </Button>
          )}
        </div>
        </motion.div>
      </DialogContent>
    </Dialog>
    <ListingShareDialog
      open={shareOpen}
      onOpenChange={setShareOpen}
      listing={{
        title: listing.title,
        price: hasItems
          ? t('housing:portal.marketplace.detail.from', {
              price: formatPrice(minAvailablePrice(listingItems) ?? listing.price),
            })
          : formatPrice(listing.price),
        condition: conditionText || undefined,
        location: meetupLocation || undefined,
        imageUrl: galleryImages[0],
        url: `https://dormcheck.com/marketplace?listing=${listing.id}`,
      }}
    />
    <SafetyTipsDialog open={safetyOpen} onOpenChange={setSafetyOpen} />
    </>
  );
}
