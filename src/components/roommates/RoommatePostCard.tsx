import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, UserPlus, ChevronRight, Pencil, Ban, MessageCircle, Loader2, Heart } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { usePrefetchOnIntent } from '@/hooks/usePrefetchOnIntent';
import { prefetchRoommateProfile } from './RoommatePostDetailLazy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
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
import { cn } from '@/lib/utils';
import { safeImageSrc } from '@/lib/sanitize';
import type { RoommateSearchPost } from './roommateSearchTypes';
import { POST_LOOKING, POST_HAVE, HOUSING_ON, HOUSING_OFF, AVATAR_BG } from './roommateSearchTypes';
import {
  normalizeProfile,
  hashName,
  getInitials,
  formatPostedAgo,
  genderPreferenceLabel,
  LocationTagChip,
} from './roommateSearchHelpers';

export function PostCard({
  post,
  isMine,
  onEdit,
  onDeactivate,
  onOpenInterests,
  onViewDetails,
  interestCount,
  hasMyInterest = false,
  onToggleInterest,
  onMessage,
  onRefreshPosts,
}: {
  post: RoommateSearchPost;
  isMine?: boolean;
  onEdit?: () => void;
  onDeactivate?: () => void;
  onOpenInterests: () => void;
  onViewDetails?: () => void;
  interestCount: number;
  /** Filled heart when user has a roommate_search_interests row for this post. */
  hasMyInterest?: boolean;
  /** Top-right heart toggles interest (not shown on own posts). */
  onToggleInterest?: (e: import('react').MouseEvent<HTMLButtonElement>) => void;
  /** When set (e.g. Finding Roommates feed), shows Message in the action row. */
  onMessage?: () => void;
  onRefreshPosts?: () => void;
}) {
  const { t } = useTranslation();
  const [spotsEditorOpen, setSpotsEditorOpen] = useState(false);
  const [spotsFilledInput, setSpotsFilledInput] = useState('0');
  const [spotsTotalInput, setSpotsTotalInput] = useState('1');
  const [savingSpots, setSavingSpots] = useState(false);
  const [deactivatePromptOpen, setDeactivatePromptOpen] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  const prof = normalizeProfile(post.profiles);
  const name = prof?.full_name ?? 'Anonymous';
  const major = prof?.major?.trim() || 'Undeclared';
  const grade = prof?.grade_level?.trim() || ' - ';
  const bg = AVATAR_BG[hashName(name) % AVATAR_BG.length];
  const initials = getInitials(prof?.full_name);
  const img = prof?.avatar_url ? safeImageSrc(prof.avatar_url) : null;

  const isLooking = post.post_type === POST_LOOKING;
  const openSpots = Math.max(0, post.spots_total - post.spots_filled);
  const authorPreferredAreas = (prof?.preferred_areas ?? []).filter(Boolean);
  const isHavePlace = post.post_type === POST_HAVE;
  const fullyFilled =
    isHavePlace && post.spots_total > 0 && post.spots_filled >= post.spots_total;

  const coverPhotoSrc =
    isHavePlace && Array.isArray(post.photos) && post.photos.length > 0
      ? safeImageSrc(post.photos[0])
      : null;
  const utilitiesList = (post.utilities_included ?? []).filter(Boolean);
  const genderLabel = genderPreferenceLabel(post.gender_preference ?? undefined, t);
  const additional = post.additional_details?.trim() ?? '';
  const additionalClamped = additional.length > 100;

  const openSpotsEditor = () => {
    setSpotsFilledInput(String(post.spots_filled));
    setSpotsTotalInput(String(post.spots_total));
    setSpotsEditorOpen(true);
  };

  const saveSpots = async () => {
    const filled = Math.max(0, Math.floor(Number(spotsFilledInput) || 0));
    const totalRaw = Math.floor(Number(spotsTotalInput) || 0);
    if (!Number.isFinite(filled) || !Number.isFinite(totalRaw) || filled < 0 || totalRaw < 0) {
      toast.error(t('roommates:posts.spotsMustBeZeroOrGreater'));
      return;
    }
    if (totalRaw < 1) {
      toast.error(t('roommates:posts.totalSpotsAtLeastOne'));
      return;
    }
    const total = totalRaw;
    if (filled > total) {
      toast.error(t('roommates:posts.spotsFilledExceeds'));
      return;
    }
    setSavingSpots(true);
    try {
      const { error } = await supabase
        .from('roommate_search_posts')
        .update({ spots_filled: filled, spots_total: total })
        .eq('id', post.id);
      if (error) throw error;
      toast.success(t('roommates:posts.spotsUpdated'));
      setSpotsEditorOpen(false);
      onRefreshPosts?.();
      if (filled === total) {
        setDeactivatePromptOpen(true);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t('common:toast.couldNotSave');
      toast.error(t('roommates:posts.couldNotUpdateSpots'), { description: msg });
    } finally {
      setSavingSpots(false);
    }
  };

  const openDetails = () => {
    onViewDetails?.();
  };

  // Warm the roommate-profile chunk before the tap: hover/focus on the web, the
  // card entering the viewport on a phone. Only meaningful when the card can
  // actually open the overlay.
  const intent = usePrefetchOnIntent(prefetchRoommateProfile);

  return (
    <>
    <article
      ref={onViewDetails ? intent.ref : undefined}
      onPointerEnter={onViewDetails ? intent.onPointerEnter : undefined}
      onFocus={onViewDetails ? intent.onFocus : undefined}
      role={onViewDetails ? 'button' : undefined}
      tabIndex={onViewDetails ? 0 : undefined}
      onClick={openDetails}
      onKeyDown={(e) => {
        if (!onViewDetails) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDetails();
        }
      }}
      className={cn(
        'relative rounded-xl border border-border bg-card shadow-raised overflow-hidden transition-all',
        onViewDetails && 'cursor-pointer hover:shadow-overlay hover:border-border'
      )}
    >
      {!isMine && onToggleInterest && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleInterest(e);
          }}
          className="absolute top-3 right-3 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-card shadow-raised border border-border/60 transition-colors hover:bg-accent pointer-events-auto"
          aria-label={hasMyInterest ? t('roommates:finding.withdrawInterest') : t('roommates:finding.expressInterest')}
        >
          <Heart
            className={cn(
              'w-4 h-4',
              hasMyInterest
                ? 'text-[#FF6B6B] fill-[#FF6B6B]'
                : 'text-muted-foreground fill-none stroke-muted-foreground stroke-[1.5]',
            )}
            strokeWidth={hasMyInterest ? 0 : 1.5}
          />
        </button>
      )}
      <div className="flex flex-col sm:flex-row sm:items-stretch">
        {coverPhotoSrc && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onViewDetails?.();
            }}
            className="w-full h-28 max-h-40 shrink-0 overflow-hidden border-b sm:h-40 sm:max-h-none sm:w-40 sm:min-w-40 sm:border-b-0 sm:border-r border-border/60 bg-muted/40 p-2 cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-inset"
            aria-label={t('roommates:finding.viewPostDetails')}
          >
            <img
              src={coverPhotoSrc}
              alt=""
              className="w-full h-full object-cover rounded-lg pointer-events-none"
            />
          </button>
        )}
        <div className="flex flex-1 min-w-0 p-3 gap-3 sm:p-4">
        <div className="shrink-0">
          {img ? (
            <img src={img} alt="" className="w-12 h-12 rounded-full object-cover" />
          ) : (
            <div
              className={cn(
                'w-12 h-12 rounded-full flex items-center justify-center text-white text-sm font-bold',
                bg
              )}
            >
              {initials}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div
            className={cn(
              'flex flex-wrap items-start justify-between gap-2',
              !isMine && onToggleInterest && 'pr-11',
            )}
          >
            <div>
              <p className="font-semibold text-foreground leading-tight">
                {name} <span className="text-muted-foreground font-normal">·</span>{' '}
                <span className="font-normal text-muted-foreground">{grade}</span>{' '}
                <span className="text-muted-foreground">·</span>{' '}
                <span className="font-normal text-muted-foreground">{major}</span>
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span>{formatPostedAgo(post.created_at, t)}</span>
                {onViewDetails && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewDetails();
                    }}
                    className="text-foreground font-medium hover:underline"
                  >
                    View details
                  </button>
                )}
              </p>
            </div>
            <span
              className={cn(
                'shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border',
                isLooking
                  ? 'border-border text-foreground bg-muted'
                  : 'border-amber-500/50 text-amber-800 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
              )}
            >
              {isLooking ? 'Looking for roommates' : 'Have a place, need people'}
            </span>
          </div>

          <p className="text-sm text-foreground mt-3 line-clamp-2 sm:line-clamp-none whitespace-pre-wrap break-words">
            {post.content}
          </p>

          {/* Primary info chips */}
          <div className="flex flex-wrap gap-1.5 mt-2 sm:mt-3">
            {authorPreferredAreas.map((a) => (
              <span
                key={a}
                className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-sky-50 text-sky-800 border border-sky-100"
              >
                {a}
              </span>
            ))}
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
            <LocationTagChip post={post} />
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
          </div>

          {/* Place details summary line (Have a place posts only) */}
          {isHavePlace && (() => {
            const parts = [
              post.room_type === 'private' ? 'Private room' : post.room_type === 'shared' ? 'Shared room' : '',
              post.is_furnished === true ? 'Furnished' : post.is_furnished === false ? 'Unfurnished' : '',
              post.parking_available === true ? 'Parking' : post.parking_available === false ? 'No parking' : '',
              utilitiesList.length > 0 ? `Utilities: ${utilitiesList.join(', ')}` : '',
              post.lease_length === 'month-to-month' ? 'Month-to-month' : post.lease_length === '6-months' ? '6 mo lease' : post.lease_length === '12-months' ? '12 mo lease' : '',
              post.pets_allowed === true ? 'Pets OK' : post.pets_allowed === false ? 'No pets' : '',
              genderLabel || '',
            ].filter(Boolean);
            return parts.length > 0 ? (
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed line-clamp-1 sm:line-clamp-none">
                {parts.join(' · ')}
              </p>
            ) : null;
          })()}

          {isHavePlace && additional ? (
            <div className="mt-3 hidden sm:block">
              <p
                className={cn(
                  'text-sm text-muted-foreground whitespace-pre-wrap break-words',
                  additionalClamped && !detailsExpanded && 'line-clamp-2'
                )}
              >
                {additional}
              </p>
              {additionalClamped && (
                <button
                  type="button"
                  className="text-xs font-medium text-foreground hover:underline mt-1"
                  onClick={() => setDetailsExpanded((e) => !e)}
                  onClickCapture={(e) => e.stopPropagation()}
                >
                  {detailsExpanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 mt-3 pt-2 border-t border-border/60 sm:mt-4 sm:pt-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {isHavePlace ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                    <Users className="w-3.5 h-3.5" />
                    {post.spots_filled} of {post.spots_total} spots filled · {openSpots} open
                  </span>
                  {isMine && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        openSpotsEditor();
                      }}
                      className="inline-flex items-center gap-1 text-foreground font-medium hover:underline shrink-0"
                    >
                      <UserPlus className="w-3.5 h-3.5" aria-hidden />
                      Update spots
                    </button>
                  )}
                  {fullyFilled && (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold bg-muted text-muted-foreground border border-border">
                      Fully filled!
                    </span>
                  )}
                </div>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border">
                  <Users className="w-3.5 h-3.5" />
                  Looking for {post.spots_total} roommate{post.spots_total !== 1 ? 's' : ''}
                  {genderLabel ? ` · ${genderLabel}` : ''}
                </span>
              )}
              {interestCount > 0 && (
                isMine ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onOpenInterests();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 hover:border-violet-300 transition-colors cursor-pointer shadow-raised"
                  >
                    <span className="text-sm">🔥</span>
                    {interestCount} interested
                    <ChevronRight className="w-3.5 h-3.5 text-violet-400" />
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-violet-50 text-violet-700 border border-violet-100">
                    🔥 {interestCount} interested
                  </span>
                )
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {isMine ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-border text-foreground hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit?.();
                    }}
                  >
                    <Pencil className="w-3.5 h-3.5 mr-1" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeactivate?.();
                    }}
                  >
                    <Ban className="w-3.5 h-3.5 mr-1" />
                    Deactivate
                  </Button>
                </>
              ) : onMessage ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-border text-muted-foreground hover:bg-accent shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMessage();
                  }}
                >
                  <MessageCircle className="w-3.5 h-3.5 mr-1" />
                  Message
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        </div>
      </div>
    </article>

    {isMine && isHavePlace && (
      <Dialog open={spotsEditorOpen} onOpenChange={setSpotsEditorOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Update spots</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor={`spots-filled-${post.id}`}>Spots filled</Label>
              <Input
                id={`spots-filled-${post.id}`}
                type="number"
                min={0}
                value={spotsFilledInput}
                onChange={(e) => setSpotsFilledInput(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor={`spots-total-${post.id}`}>Total spots</Label>
              <Input
                id={`spots-total-${post.id}`}
                type="number"
                min={1}
                value={spotsTotalInput}
                onChange={(e) => setSpotsTotalInput(e.target.value)}
                className="mt-1.5"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setSpotsEditorOpen(false)}>
              Cancel
            </Button>
            <Button
              // KEEP: primary CTA of the spots-editor dialog
              // KEEP: primary CTA of the composer (publish post)
            className="bg-malachite-800 hover:bg-malachite-900 text-white"
              disabled={savingSpots}
              onClick={() => void saveSpots()}
            >
              {savingSpots ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )}

    {isMine && isHavePlace && (
      <AlertDialog open={deactivatePromptOpen} onOpenChange={setDeactivatePromptOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>All spots filled! Deactivate this post?</AlertDialogTitle>
            <AlertDialogDescription>
              If you deactivate, this post will no longer appear in the feed. You can post again anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep active</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                onDeactivate?.();
                setDeactivatePromptOpen(false);
              }}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )}
    </>
  );
}
