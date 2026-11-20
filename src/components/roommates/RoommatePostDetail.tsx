import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bed,
  Sofa,
  Calendar,
  Car,
  PawPrint,
  Cigarette,
  WashingMachine,
  Bath,
  Users,
  X,
  Flag,
  MessageCircle,
  Pencil,
  Ban,
  Heart,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  AdaptiveOverlay,
  AdaptiveOverlayContent,
  AdaptiveOverlayTitle,
} from '@/components/ui/adaptive-overlay';
import { Button } from '@/components/ui/button';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { useModalOverlay } from '@/contexts/ModalOverlayContext';
import { ImageGalleryCarousel } from '@/components/ImageGalleryCarousel';
import { InstagramLogo, SnapchatLogo } from '@/components/roommate/SocialLogos';
import { cn } from '@/lib/utils';
import { safeImageSrc } from '@/lib/sanitize';
import type { RoommateSearchPost } from './roommateSearchTypes';
import {
  AVATAR_BG,
  POST_LOOKING,
  POST_HAVE,
  HOUSING_ON,
  HOUSING_OFF,
} from './roommateSearchTypes';
import {
  normalizeProfile,
  hashName,
  getInitials,
  formatPostedAgo,
  genderPreferenceLabel,
  cleanSocialHandle,
  LocationTagChip,
  utilityIcon,
} from './roommateSearchHelpers';

function RoommatePostDetailBody({
  post,
  onClose,
  isMine,
  onMessage,
  onEdit,
  onDeactivate,
  onOpenInterests,
  interestCount,
  onReport,
  hasMyInterest = false,
  onToggleInterest,
}: {
  post: RoommateSearchPost;
  onClose: () => void;
  isMine: boolean;
  onMessage?: () => void;
  onEdit: () => void;
  onDeactivate: () => void;
  onOpenInterests: () => void;
  interestCount: number;
  onReport?: () => void;
  hasMyInterest?: boolean;
  onToggleInterest?: (e: import('react').MouseEvent<HTMLButtonElement>) => void;
}) {
  const { t } = useTranslation();
  const prof = normalizeProfile(post.profiles);
  const name = prof?.full_name ?? 'Anonymous';
  const major = prof?.major?.trim() || 'Undeclared';
  const grade = prof?.grade_level?.trim() || ' - ';
  const bg = AVATAR_BG[hashName(name) % AVATAR_BG.length];
  const initials = getInitials(prof?.full_name);
  const img = prof?.avatar_url ? safeImageSrc(prof.avatar_url) : null;
  const isLooking = post.post_type === POST_LOOKING;
  const isHavePlace = post.post_type === POST_HAVE;
  const openSpots = Math.max(0, post.spots_total - post.spots_filled);
  const utilitiesList = (post.utilities_included ?? []).filter(Boolean);
  const genderLabel = genderPreferenceLabel(post.gender_preference ?? undefined, t);
  const additional = post.additional_details?.trim() ?? '';

  const placeFacts: { icon: LucideIcon; label: string; muted?: boolean }[] = [];
  if (post.room_type === 'private') placeFacts.push({ icon: Bed, label: t('roommates:posts.privateRoom') });
  if (post.room_type === 'shared') placeFacts.push({ icon: Bed, label: t('roommates:posts.sharedRoom') });
  if (post.is_furnished === true) placeFacts.push({ icon: Sofa, label: t('roommates:posts.furnished') });
  if (post.is_furnished === false) placeFacts.push({ icon: Sofa, label: t('roommates:posts.unfurnished'), muted: true });
  if (post.lease_length)
    placeFacts.push({
      icon: Calendar,
      label:
        post.lease_length === 'month-to-month'
          ? t('roommates:posts.monthToMonth')
          : post.lease_length === '6-months'
            ? t('roommates:posts.sixMonthLease')
            : t('roommates:posts.twelveMonthLease'),
    });
  if (post.parking_available === true) placeFacts.push({ icon: Car, label: t('roommates:posts.parking') });
  if (post.parking_available === false) placeFacts.push({ icon: Car, label: t('roommates:posts.noParking'), muted: true });
  if (post.pets_allowed === true) placeFacts.push({ icon: PawPrint, label: t('roommates:posts.petsAllowed') });
  if (post.pets_allowed === false) placeFacts.push({ icon: PawPrint, label: t('roommates:posts.noPets'), muted: true });
  if (post.smoking_allowed === true) placeFacts.push({ icon: Cigarette, label: t('roommates:posts.smokingAllowed') });
  if (post.smoking_allowed === false) placeFacts.push({ icon: Cigarette, label: t('roommates:posts.noSmoking'), muted: true });
  if (post.laundry === 'in-unit') placeFacts.push({ icon: WashingMachine, label: t('roommates:posts.inUnitLaundry') });
  if (post.laundry === 'in-building') placeFacts.push({ icon: WashingMachine, label: t('roommates:posts.inBuildingLaundry') });
  if (post.laundry === 'none') placeFacts.push({ icon: WashingMachine, label: t('roommates:posts.noLaundry'), muted: true });
  if (post.bathroom === 'private') placeFacts.push({ icon: Bath, label: t('roommates:posts.privateBathroom') });
  if (post.bathroom === 'shared') placeFacts.push({ icon: Bath, label: t('roommates:posts.sharedBathroom') });
  if (genderLabel) placeFacts.push({ icon: Users, label: genderLabel });

  const images = useMemo(
    () =>
      (Array.isArray(post.photos) ? post.photos : [])
        .map((u) => safeImageSrc(u))
        .filter((u): u is string => u != null && u !== ''),
    [post.photos]
  );
  const instagramHandle = post.show_instagram ? cleanSocialHandle(prof?.instagram_username) : '';
  const snapchatHandle = post.show_snapchat ? cleanSocialHandle(prof?.snapchat_username) : '';

  return (
    <div className="relative flex flex-col flex-1 min-h-0 bg-background text-foreground">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className={cn(
          'absolute left-[max(0.75rem,env(safe-area-inset-left,0px))] top-[max(0.75rem,env(safe-area-inset-top))] z-20 flex h-11 min-h-[44px] w-11 min-w-[44px] items-center justify-center rounded-full transition-colors md:left-4 md:top-4',
          images.length > 0
            ? 'bg-black/50 text-white hover:bg-black/70 md:bg-black/20 md:backdrop-blur-md md:hover:bg-black/30'
            : 'border border-border bg-muted text-foreground hover:bg-muted/80 md:h-9 md:min-h-0 md:w-9 md:min-w-0',
        )}
        aria-label={t('common:actions.close')}
      >
        <X className="w-4 h-4 md:w-5 md:h-5" />
      </button>
      {!isMine && onToggleInterest && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleInterest(e);
          }}
          className="absolute right-[max(0.75rem,env(safe-area-inset-right,0px))] top-[max(0.75rem,env(safe-area-inset-top))] z-20 flex h-11 min-h-[44px] w-11 min-w-[44px] items-center justify-center rounded-full bg-card shadow-raised transition-colors hover:bg-accent md:right-4 md:top-4"
          aria-label={hasMyInterest ? t('roommates:finding.withdrawInterest') : t('roommates:finding.expressInterest')}
        >
          <Heart
            className={cn(
              'w-5 h-5',
              hasMyInterest
                ? 'text-[#FF6B6B] fill-[#FF6B6B]'
                : 'text-muted-foreground fill-none stroke-muted-foreground stroke-[1.5]',
            )}
            strokeWidth={hasMyInterest ? 0 : 1.5}
          />
        </button>
      )}
      {images.length > 0 && (
        <div className="relative w-full h-72 sm:h-80 flex-shrink-0 bg-black">
          <ImageGalleryCarousel
            key={post.id}
            images={images}
            alt="Post photo"
            objectFit="contain"
            showArrows="desktop-only"
            className="h-full w-full"
            dotsClassName="bottom-3"
            slideInnerClassName="h-full w-full"
          />
        </div>
      )}

      <div
        className={cn(
          'relative flex-1 overflow-y-auto bg-card p-6 pb-[max(5rem,env(safe-area-inset-bottom))] space-y-4 md:pb-6',
          images.length === 0 && 'pt-4 sm:pt-2'
        )}
      >
        {!isMine && onReport && (
          <button
            type="button"
            onClick={onReport}
            className="absolute top-4 right-4 z-10 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t('roommates:finding.reportPost')}
          >
            <Flag className="h-4 w-4" />
          </button>
        )}
        <div className={cn('flex gap-3 min-w-0', (!isMine && onToggleInterest) || (!isMine && onReport) ? 'pr-10' : undefined)}>
          {img ? (
            <img src={img} alt="" className="w-14 h-14 rounded-full object-cover shrink-0" />
          ) : (
            <div
              className={cn(
                'w-14 h-14 rounded-full flex items-center justify-center text-white text-base font-bold shrink-0',
                bg
              )}
            >
              {initials}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground">
              {name} · <span className="font-normal text-muted-foreground">{grade}</span>
            </p>
            <p className="text-sm text-muted-foreground">{major}</p>
            <p className="text-xs text-muted-foreground mt-1">{formatPostedAgo(post.created_at, t)}</p>
            <span
              className={cn(
                'inline-flex mt-2 text-xs font-medium px-2.5 py-1 rounded-full border',
                isLooking
                  ? 'border-border text-foreground bg-muted'
                  : 'border-amber-500/50 text-amber-800 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
              )}
            >
              {isLooking ? t('roommates:posts.lookingForRoommates') : t('roommates:posts.havePlace')}
            </span>
          </div>
        </div>

        <p className="text-sm text-foreground whitespace-pre-wrap break-words">{post.content}</p>

        <div className="flex flex-wrap gap-1.5 min-w-0">
          {post.housing_type === HOUSING_ON && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border">
              On-campus
            </span>
          )}
          {post.housing_type === HOUSING_OFF && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-800 border border-blue-100">
              Off-campus
            </span>
          )}
          {post.address?.trim() ? <LocationTagChip post={post} /> : null}
          {post.budget_max != null && post.budget_max > 0 && (
            <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border">
              {isHavePlace ? 'Rent' : 'Max'} ${post.budget_max}/mo
            </span>
          )}
          {post.move_in_semester?.trim() && (
            <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-violet-50 text-violet-800 border border-violet-100">
              Move-in: {post.move_in_semester}
            </span>
          )}
          {isLooking && post.spots_total > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border">
              Looking for {post.spots_total} roommate{post.spots_total !== 1 ? 's' : ''}
            </span>
          )}
          {isHavePlace && (
            <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
              {post.spots_filled} of {post.spots_total} spots filled · {openSpots} open
            </span>
          )}
        </div>

        {isHavePlace && (
          <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Place details</p>
            {placeFacts.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {placeFacts.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-2.5 py-2"
                  >
                    <f.icon
                      className={cn(
                        'w-4 h-4 shrink-0',
                        f.muted ? 'text-muted-foreground' : 'text-foreground'
                      )}
                    />
                    <span
                      className={cn(
                        'text-sm',
                        f.muted ? 'text-muted-foreground' : 'text-foreground'
                      )}
                    >
                      {f.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {utilitiesList.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Utilities included</p>
                <div className="flex flex-wrap gap-1.5">
                  {utilitiesList.map((u) => {
                    const UIcon = utilityIcon(u);
                    return (
                      <span
                        key={u}
                        className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground border border-border px-2 py-0.5 text-xs font-medium"
                      >
                        {UIcon ? <UIcon className="w-3 h-3" /> : null}
                        {u}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
            {additional ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Additional details</p>
                <p className="text-sm text-foreground whitespace-pre-wrap break-words">{additional}</p>
              </div>
            ) : null}
          </div>
        )}

        {(instagramHandle || snapchatHandle) && (
          <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-border/60">
            {instagramHandle && (
              <a
                href={`https://instagram.com/${encodeURIComponent(instagramHandle)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-pink-50 text-pink-700 border border-pink-100 hover:bg-pink-100"
              >
                <InstagramLogo className="w-3.5 h-3.5" />@{instagramHandle}
              </a>
            )}
            {snapchatHandle && (
              <a
                href={`https://snapchat.com/add/${encodeURIComponent(snapchatHandle)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-yellow-50 text-yellow-800 border border-yellow-100 hover:bg-yellow-100"
              >
                <SnapchatLogo className="w-3.5 h-3.5" />
                {snapchatHandle}
              </a>
            )}
          </div>
        )}
      <div className="flex flex-col gap-2 pt-2 border-t border-border md:flex-row md:justify-end md:items-center">
        {isMine ? (
          <>
            {interestCount > 0 && (
              <Button
                variant="outline"
                className="w-full sm:w-auto border-border text-foreground"
                onClick={() => {
                  onOpenInterests();
                  onClose();
                }}
              >
                {interestCount} interested
              </Button>
            )}
            <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
              <Button
                variant="outline"
                className="flex-1 sm:flex-initial border-border text-foreground"
                onClick={() => {
                  onEdit();
                  onClose();
                }}
              >
                <Pencil className="w-3.5 h-3.5 mr-1" />
                Edit
              </Button>
              <Button
                variant="outline"
                className="flex-1 sm:flex-initial"
                onClick={() => {
                  onDeactivate();
                  onClose();
                }}
              >
                <Ban className="w-3.5 h-3.5 mr-1" />
                Deactivate
              </Button>
            </div>
          </>
        ) : onMessage ? (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:ml-auto">
            <Button
              // KEEP: primary CTA of the post detail (message poster)
              className="w-full sm:w-auto bg-malachite-800 hover:bg-malachite-900 text-white"
              onClick={onMessage}
            >
              <MessageCircle className="w-4 h-4 mr-2" />
              Message
            </Button>
          </div>
        ) : null}
      </div>
      </div>
    </div>
  );
}

export function RoommatePostDetail({
  post,
  open,
  onClose,
  isMine,
  hasMyInterest,
  onMessage,
  onEdit,
  onDeactivate,
  onOpenInterests,
  interestCount,
  onReport,
  onToggleInterest,
}: {
  post: RoommateSearchPost | null;
  open: boolean;
  onClose: () => void;
  /** @deprecated No longer used — AdaptiveOverlay handles the mobile/desktop switch internally. Still accepted so existing call sites keep type-checking. */
  isMobile?: boolean;
  isMine: boolean;
  hasMyInterest: boolean;
  onMessage?: () => void;
  onEdit: () => void;
  onDeactivate: () => void;
  onOpenInterests: () => void;
  interestCount: number;
  onReport?: () => void;
  onToggleInterest?: (e: import('react').MouseEvent<HTMLButtonElement>) => void;
}) {
  const modalOverlay = useModalOverlay();
  useEffect(() => {
    modalOverlay?.setHideTopNav(open);
    return () => { modalOverlay?.setHideTopNav(false); };
  }, [open, modalOverlay]);

  if (!post) return null;

  const body = (
    <RoommatePostDetailBody
      post={post}
      onClose={onClose}
      isMine={isMine}
      onMessage={onMessage}
      onEdit={onEdit}
      onDeactivate={onDeactivate}
      onOpenInterests={onOpenInterests}
      interestCount={interestCount}
      onReport={onReport}
      hasMyInterest={hasMyInterest}
      onToggleInterest={onToggleInterest}
    />
  );

  // One overlay: mobile keeps the full-screen bottom Sheet byte-identical; desktop
  // is the centered Dialog (md:max-w-2xl). overlayClassName applies to the desktop
  // Dialog only (the Sheet branch keeps its default scrim).
  return (
    <AdaptiveOverlay open={open} onOpenChange={(o) => !o && onClose()}>
      <AdaptiveOverlayContent
        side="bottom"
        aria-describedby={undefined}
        overlayClassName="!bg-black/20"
        mobileClassName="flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden rounded-none border-0 bg-background p-0 [&>button]:hidden"
        desktopClassName={cn(
          'fixed inset-0 bottom-0 left-0 right-0 top-0 m-0 flex h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-y-auto overflow-x-hidden rounded-none border border-border bg-background p-0',
          'md:inset-auto md:left-1/2 md:top-1/2 md:h-auto md:max-h-[90vh] md:w-[95%] md:max-w-2xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl',
          '[&>:last-child]:hidden',
        )}
      >
        <VisuallyHidden.Root asChild>
          <AdaptiveOverlayTitle>Post details</AdaptiveOverlayTitle>
        </VisuallyHidden.Root>
        {body}
      </AdaptiveOverlayContent>
    </AdaptiveOverlay>
  );
}
