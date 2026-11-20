import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Heart } from 'lucide-react';
import { formatAcademicStatus } from '@/lib/academicYear';
import { safeImageSrc } from '@/lib/sanitize';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';
import { ProfilePhotoPlaceholder } from '@/components/profile/ProfilePhotoPlaceholder';
import type { MatchResult } from '@/lib/roommateMatch';
import { interestLabel } from '@/lib/interestOptions';

/**
 * Columns read from roommate_profiles for browse, liked, and DM profile previews.
 *
 * These columns live on `roommate_profiles`, NOT `public_profiles` — public_profiles
 * is identity-only (id, full_name, avatar_url); social handles were deliberately
 * removed from it by migration 20260814000000 (directory_views_write_revoke_socials_trim).
 */
export const ROOMMATE_PROFILE_SELECT =
  'id, full_name, pronouns, major, grade_level, graduation_year, graduation_semester, bio, tags, avatar_url, profile_photos, dealbreakers, instagram_username, snapchat_username, cleanliness, social_level, study_style, conflict_style, guests, guest_preference, sleep, sleep_habit, temp, temp_preference, smoking, current_dorm, preferred_areas, housing_type, interests, prompts';

/** Profile row from roommate_profiles (roommate browse, liked, DM preview). */
export interface RoommateProfileRow {
  id: string;
  full_name?: string | null;
  display_name?: string | null;
  name?: string | null;
  pronouns?: string | null;
  major?: string | null;
  grade_level?: string | null;
  graduation_year?: number | null;
  graduation_semester?: string | null;
  bio?: string | null;
  tags?: string[] | null;
  avatar_url?: string | null;
  cleanliness?: string | null;
  social_level?: string | null;
  study_style?: string | null;
  guests?: string | null;
  guest_preference?: string | null;
  sleep?: string | null;
  sleep_habit?: string | null;
  temp?: string | null;
  temp_preference?: string | null;
  conflict_style?: string | null;
  dealbreakers?: string[] | null;
  instagram_username?: string | null;
  snapchat_username?: string | null;
  profile_photos?: string[] | null;
  current_dorm?: string | null;
  preferred_areas?: string[] | null;
  housing_type?: string | null;
  interests?: string[] | null;
  prompts?: { prompt: string; answer: string }[] | null;
  [key: string]: unknown;
}

interface RoommateCardProps {
  profile: RoommateProfileRow;
  onClick?: () => void;
  isOwnProfile?: boolean;
  isFavorite?: boolean;
  onToggleFavorite?: (e: React.MouseEvent) => void;
  /** Compatibility result for this profile; badge hidden when absent. */
  match?: MatchResult;
  /** 'primary' = solid pill (underclassman viewer), 'secondary' = outline. */
  matchEmphasis?: 'primary' | 'secondary';
}

export function RoommateCard({
  profile,
  onClick,
  isOwnProfile = false,
  isFavorite = false,
  onToggleFavorite,
  match,
  matchEmphasis = 'primary',
}: RoommateCardProps) {
  const { t } = useTranslation();
  const [failedSrcs, setFailedSrcs] = useState<Record<string, boolean>>({});
  const rawPhotos =
    Array.isArray(profile.profile_photos) && profile.profile_photos.length > 0
      ? profile.profile_photos
      : profile.avatar_url
        ? [profile.avatar_url]
        : [];
  const photos = rawPhotos.length > 0
    ? rawPhotos.map((u) => safeImageSrc(u)).filter((u): u is string => u != null)
    : [];

  const galleryImages = useMemo(
    () => photos.filter((src) => !failedSrcs[src]),
    [photos, failedSrcs],
  );

  useEffect(() => {
    setFailedSrcs({});
  }, [profile.id, photos.join('|')]);

  const cardRef = useRef<HTMLDivElement>(null);

  // Predictive loading: preload remaining 4 photos when card enters viewport
  useEffect(() => {
    const el = cardRef.current;
    if (!el || photos.length <= 1) return;
    const toPreload = photos.slice(1, 5);
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        toPreload.forEach((src) => {
          const img = new Image();
          img.src = src;
        });
      },
      { rootMargin: '100px', threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [photos]);

  const name =
    profile.full_name ?? profile.display_name ?? profile.name ?? 'Anonymous';
  const pronouns = (profile.pronouns as string | null | undefined)?.trim() || null;
  const major = profile.major ?? 'Undeclared';
  const academicStatus = formatAcademicStatus(profile.graduation_year, {
    gradeLevel: profile.grade_level,
    graduationSemester: profile.graduation_semester,
  });

  return (
    /* Click-to-open on the container for mouse users only (role="presentation");
       keyboard and AT activation live on the name button in CardContent. This
       was role="button" tabIndex={0}, which nested the favorite and message
       controls inside an interactive element and made Space double-fire on
       them. Matches DormCard.tsx and BusinessListingCard.tsx. */
    <Card
      ref={cardRef}
      role={onClick ? 'presentation' : undefined}
      onClick={onClick ? () => onClick() : undefined}
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-card shadow-raised transition-all flex flex-col',
        onClick &&
          'cursor-pointer hover:shadow-overlay hover:border-border focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
      )}
    >
      {/* Cover photo - aspect-[4/5]; first image only; tap opens detail */}
      <div
        className="relative flex-shrink-0 overflow-hidden bg-muted/50 w-full aspect-[4/5] min-[768px]:aspect-[4/5]"
        style={{ minHeight: 0 }}
      >
        {galleryImages.length === 0 ? (
          <ProfilePhotoPlaceholder name={name} className="absolute inset-0" />
        ) : (
          /* One img for both cases now. It carried role="button" tabIndex={0}
             and a keydown handler, which is not a valid pattern on an <img>
             (an image has no activation behavior, so AT announced a button
             that only a mouse could use) and it sat inside the card's own
             role="button". The container's onClick still opens the profile on
             tap; keyboard users reach it through the name button below. */
          <img
            src={galleryImages[0]}
            alt={name}
            className="absolute inset-0 w-full h-full object-cover object-top select-none"
            draggable={false}
            onError={() => {
              const src = galleryImages[0];
              setFailedSrcs((prev) => (prev[src] ? prev : { ...prev, [src]: true }));
            }}
          />
        )}
        {/* KEEP: the roommates surface's ONE earned status indicator (compatibility score).
            Solid fill uses malachite-800 for AA contrast; duplicates of this badge in
            TopMatchesBand / RoommateDetailModal were neutralised in the 1.7 sweep. */}
        {match && !isOwnProfile && (
          <span
            className={cn(
              'absolute top-3 left-3 z-30 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold shadow-raised',
              match.confidence === 'low'
                ? 'bg-card text-muted-foreground'
                : matchEmphasis === 'primary'
                  ? 'bg-malachite-800 text-white'
                  : 'border border-malachite-800 bg-card text-malachite-800',
            )}
          >
            {match.confidence === 'low' ? (
              <>
                {t('roommates:card.notEnoughInfo')}
                <span className="sr-only">
                  {t('roommates:card.notEnoughInfoDetail')}
                </span>
              </>
            ) : (
              t('roommates:card.matchPct', { pct: match.score })
            )}
          </span>
        )}
        {/* Favorite heart - top right (white circle, pink when saved) */}
        {!isOwnProfile && onToggleFavorite && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={(e) => {
              haptic.medium();
              e.stopPropagation();
              onToggleFavorite(e);
            }}
            // The heart's colour moves onto the button: Button's base
            // `[&_svg]:text-current` outranks a text class on the svg itself,
            // but not one inherited from the button.
            className={cn(
              'pointer-events-auto absolute right-3 top-3 z-30 h-10 w-10 rounded-full bg-card shadow-raised transition-colors hover:bg-accent',
              isFavorite
                ? 'text-[#FF6B6B] hover:text-[#FF6B6B]'
                : 'text-muted-foreground hover:text-muted-foreground',
            )}
            aria-label={isFavorite ? t('roommates:card.removeFromSaved') : t('roommates:card.saveRoommate')}
          >
            <Heart
              className={cn(
                isFavorite ? 'fill-[#FF6B6B]' : 'fill-none stroke-muted-foreground stroke-[1.5]',
              )}
              strokeWidth={isFavorite ? 0 : 1.5}
            />
          </Button>
        )}
      </div>

      <CardContent className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-2 sm:p-4">
        {/* Identity stack: Name (pronouns), Academic status • Major */}
        <div className="flex shrink-0 flex-col text-left">
          {/* The card's activation target for keyboard and AT. When the card is
              not clickable (no onClick) it stays plain text — a button that does
              nothing is worse than no button. */}
          <h3 className="truncate text-sm font-semibold text-foreground sm:text-base">
            {onClick ? (
              <Button
                type="button"
                variant="link"
                onClick={(e) => {
                  e.stopPropagation();
                  onClick();
                }}
                /* The overrides exist to make the primitive disappear into the
                   h3: inherit the heading's responsive size rather than the
                   primitive's text-sm, keep the heading's weight and colour,
                   and drop link's underline. What we keep from Button is the
                   focus ring — the raw <button> this replaced set
                   `focus-visible:outline-none` on the card's own keyboard
                   activation target, which left AT users no visible focus. */
                className="h-auto max-w-full justify-start p-0 text-left text-[length:inherit] font-semibold text-foreground no-underline hover:no-underline"
              >
                <span className="block truncate">
                  {name}{pronouns ? ` (${pronouns})` : ''}
                </span>
              </Button>
            ) : (
              <>{name}{pronouns ? ` (${pronouns})` : ''}</>
            )}
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground sm:text-sm">
            {academicStatus} • {major}
          </p>
        </div>

        {/* Bio - concise two-line teaser; full text lives in the detail view */}
        <div className="mt-1.5 min-h-[2.5rem]">
          {profile.bio != null && profile.bio.trim() !== '' ? (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed sm:text-sm">
              {profile.bio}
            </p>
          ) : (
            <span className="invisible text-xs line-clamp-2 select-none sm:text-sm">placeholder</span>
          )}
        </div>

        {/* Habits & Boundaries - only render when data exists; no placeholders */}
        {(() => {
          const habits = (
            Array.isArray(profile.tags)
              ? profile.tags.filter(
                  (t: string) => Boolean(t) && !t.startsWith('onboarding_interest:'),
                )
              : []
          ).slice(0, 2);
          const boundaries = (Array.isArray(profile.dealbreakers) ? profile.dealbreakers.filter(Boolean) : []).slice(0, 2);
          const interests = (Array.isArray(profile.interests) ? profile.interests.filter(Boolean) : []).slice(0, 3);
          const hasAny = interests.length > 0 || habits.length > 0 || boundaries.length > 0;
          if (!hasAny) return null;
          return (
            <div className="mt-2 hidden shrink-0 flex-col gap-2 sm:flex">
              {interests.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {interests.map((slug, i) => (
                    <span
                      key={i}
                      className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border"
                    >
                      {interestLabel(t, String(slug))}
                    </span>
                  ))}
                </div>
              )}
              {habits.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {habits.map((habit, i) => (
                    <span
                      key={i}
                      className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground"
                    >
                      {habit}
                    </span>
                  ))}
                </div>
              )}
              {boundaries.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {boundaries.map((boundary, i) => (
                    <span
                      key={i}
                      className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground"
                    >
                      {boundary}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

      </CardContent>
    </Card>
  );
}
