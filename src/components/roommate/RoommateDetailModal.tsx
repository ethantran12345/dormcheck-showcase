import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { interestLabel } from '@/lib/interestOptions';
import { roommatePromptLabel, type ProfilePrompt } from '@/lib/roommatePrompts';
import { MessageCircle, Sparkles, PartyPopper, BookOpen, Moon, Thermometer, DoorOpen, Ban, ExternalLink, X, Cigarette, Flag, Check, AlertTriangle } from 'lucide-react';
import type { MatchResult } from '@/lib/roommateMatch';
import { ImageGalleryCarousel } from '@/components/ImageGalleryCarousel';
import { formatAcademicStatus } from '@/lib/academicYear';
import { safeSocialHandle, safeImageSrc } from '@/lib/sanitize';
import { InstagramLogo, SnapchatLogo } from './SocialLogos';
import { PRESET_DEALBREAKERS } from './RoommateProfileForm';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, AvatarImage } from '@/components/ui/avatar';
import { ProfileAvatarFallback } from '@/components/profile/ProfileAvatarFallback';
import { ProfilePhotoPlaceholder } from '@/components/profile/ProfilePhotoPlaceholder';
import { Button } from '@/components/ui/button';
import { BlockUserButton } from '@/components/safety/BlockUserButton';
import { ReportContentDialog } from '@/components/ReportContentDialog';
import { cn } from '@/lib/utils';
import { useModalOverlay } from '@/contexts/ModalOverlayContext';
import type { RoommateProfileRow } from './RoommateCard';

interface RoommateDetailModalProps {
  profile: RoommateProfileRow | null;
  open: boolean;
  onClose: () => void;
  onMessage?: (profile: RoommateProfileRow) => void;
  isOwnProfile?: boolean;
  /** Compatibility result for this profile; section hidden when absent. */
  match?: MatchResult | null;
}

export function RoommateDetailModal({
  profile,
  open,
  onClose,
  onMessage,
  isOwnProfile = false,
  match,
}: RoommateDetailModalProps) {
  const { t } = useTranslation();
  const modalOverlay = useModalOverlay();
  const [failedSrcs, setFailedSrcs] = useState<Record<string, boolean>>({});
  const [reportUserOpen, setReportUserOpen] = useState(false);

  useEffect(() => {
    modalOverlay?.setHideBottomNav(open);
    return () => { modalOverlay?.setHideBottomNav(false); };
  }, [open, modalOverlay]);

  const rawPhotos =
    profile && Array.isArray(profile.profile_photos) && profile.profile_photos.length > 0
      ? profile.profile_photos
      : profile?.avatar_url
        ? [profile.avatar_url]
        : [];
  const photos =
    profile != null
      ? rawPhotos.map((u) => safeImageSrc(u)).filter((u): u is string => u != null)
      : [];

  useEffect(() => {
    setFailedSrcs({});
  }, [profile?.id, photos.join('|')]);

  const galleryImages = useMemo(
    () => photos.filter((src) => !failedSrcs[src]),
    [photos, failedSrcs],
  );

  if (!profile) return null;

  const name = profile.full_name ?? profile.display_name ?? profile.name ?? 'Anonymous';
  const pronouns = (profile.pronouns as string | null | undefined)?.trim() || null;
  const major = profile.major ?? 'Undeclared';
  const academicStatus = formatAcademicStatus(profile.graduation_year, {
    gradeLevel: profile.grade_level,
    graduationSemester: profile.graduation_semester,
  });
  const bio = profile.bio ?? 'No bio yet.';
  const tags = (Array.isArray(profile.tags) ? profile.tags : []).filter(
    (t): t is string => typeof t === 'string' && Boolean(t) && !t.startsWith('onboarding_interest:'),
  );
  const dealbreakers = Array.isArray(profile.dealbreakers) ? profile.dealbreakers : [];
  const presetDealbreakers = dealbreakers.filter((d) => (PRESET_DEALBREAKERS as readonly string[]).includes(d));
  const customDealbreakers = dealbreakers.filter((d) => !(PRESET_DEALBREAKERS as readonly string[]).includes(d));
  const interests = (Array.isArray(profile.interests) ? profile.interests : []).filter(
    (s): s is string => typeof s === 'string' && Boolean(s),
  );
  const prompts = (Array.isArray(profile.prompts) ? profile.prompts : []).filter(
    (p): p is ProfilePrompt =>
      !!p && typeof p.prompt === 'string' && typeof p.answer === 'string' && Boolean(p.answer.trim()),
  );
  const avatarUrl = profile.avatar_url ?? null;
  const instagramUsername = safeSocialHandle(profile.instagram_username);
  const snapchatUsername = safeSocialHandle(profile.snapchat_username);

  const guestsVal = profile.guest_preference ?? profile.guests;
  const sleepVal = profile.sleep_habit ?? profile.sleep;
  const tempVal = profile.temp_preference ?? profile.temp;

  // Living Habits: Room State, Social level, Focus Zone, Conflict Style, Sleep
  const livingHabits = [
    { key: 'cleanliness', icon: Sparkles, label: 'Room State', value: profile.cleanliness },
    { key: 'social_level', icon: PartyPopper, label: 'Social Level', value: profile.social_level },
    { key: 'study_style', icon: BookOpen, label: 'Focus Zone', value: profile.study_style },
    { key: 'conflict_style', icon: MessageCircle, label: 'Conflict Style', value: profile.conflict_style },
    { key: 'sleep', icon: Moon, label: 'Sleep', value: sleepVal },
    { key: 'smoking', icon: Cigarette, label: 'Smoking', value: profile.smoking },
  ].filter((h) => h.value);

  // Preferences: Temp, Guests
  const preferences = [
    { key: 'temp', icon: Thermometer, label: 'Temp', value: tempVal },
    { key: 'guests', icon: DoorOpen, label: 'Guests', value: guestsVal },
  ].filter((p) => p.value);

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        overlayClassName="bg-black/60"
        className={cn(
          // Full-screen takeover on every breakpoint (Facebook Marketplace style):
          // photo pane left, details column right on md+; single scroll on mobile.
          'fixed inset-0 z-[10061] m-0 flex h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-card p-0 shadow-overlay',
          '[&>:last-child]:hidden',
        )}
      >
        <DialogTitle className="sr-only">{t('roommates:detail.profileTitle', { name })}</DialogTitle>

        {/* Mobile: single scroll surface. Desktop: two-pane grid takeover. */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain bg-card md:grid md:min-h-0 md:grid-cols-[minmax(0,1fr)_480px] md:overflow-hidden lg:grid-cols-[minmax(0,1fr)_560px]">
        {/* Photo pane - full-bleed on mobile; fills the left column on desktop */}
        <div
          className="relative w-full h-80 sm:h-[40vh] flex-shrink-0 bg-black pt-[env(safe-area-inset-top)] md:pt-0 md:h-full md:min-h-0"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {galleryImages.length === 0 ? (
            <ProfilePhotoPlaceholder name={name} className="absolute inset-0 h-full w-full" />
          ) : (
            <ImageGalleryCarousel
              key={profile.id}
              images={galleryImages}
              alt={name}
              objectFit="contain"
              showArrows="desktop-only"
              className="h-full w-full"
              dotsClassName="bottom-3 md:bottom-4"
              slideInnerClassName="h-full w-full"
              onImageError={(_index, src) =>
                setFailedSrcs((prev) => (prev[src] ? prev : { ...prev, [src]: true }))
              }
            />
          )}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="absolute left-[max(0.75rem,env(safe-area-inset-left,0px))] top-[max(0.75rem,env(safe-area-inset-top,0px))] z-30 h-11 w-11 rounded-full bg-black/50 text-white shadow-raised transition-colors hover:bg-black/70 hover:text-white md:left-4 md:top-4 md:bg-black/20 md:shadow-none md:backdrop-blur-md md:hover:bg-black/30 [&_svg]:size-4 md:[&_svg]:size-5"
            aria-label={t('common:actions.close')}
          >
            <X />
          </Button>
        </div>

        {/* Details column - right side on desktop, flows under the photo on mobile */}
        <div className="bg-card md:flex md:h-full md:min-h-0 md:flex-col md:overflow-hidden md:border-l md:border-border">
          <div className="pb-4 md:min-h-0 md:flex-1 md:overflow-y-auto md:pb-6">
          {/* Header - Name, Major (Message moved to footer) */}
          <div className="border-b border-border p-6 pb-4">
            <div className="flex items-start gap-4">
              <Avatar className="h-16 w-16 shrink-0 rounded-full border-2 border-border ">
                {avatarUrl ? <AvatarImage src={safeImageSrc(avatarUrl) ?? undefined} alt={name} /> : null}
                <ProfileAvatarFallback size="lg" name={name} />
              </Avatar>
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-semibold text-foreground ">
                  {name}{pronouns ? ` (${pronouns})` : ''}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {academicStatus} • {major}
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Desktop action row - Message primary, high up like the marketplace detail */}
            {!isOwnProfile && onMessage && (
              <Button
                // KEEP: primary CTA of the roommate detail (message) — desktop variant
                className="hidden h-11 w-full gap-2 bg-malachite-800 text-base font-semibold text-white hover:bg-malachite-900 md:flex"
                onClick={() => onMessage(profile)}
              >
                <MessageCircle className="h-4 w-4" />
                {t('roommates:detail.message')}
              </Button>
            )}

            {/* Connect - Large rounded buttons with platform logos */}
            {(instagramUsername || snapchatUsername) && (
              <section>
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-3">
                  {t('roommates:detail.connect')}
                </h3>
                <div className="flex flex-wrap gap-3">
                  {instagramUsername && (
                    <a
                      href={`https://instagram.com/${encodeURIComponent(instagramUsername)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium bg-card border-2 border-border hover:border-pink-300 shadow-raised hover:shadow-overlay transition-all min-w-[160px]"
                    >
                      <div className="shrink-0">
                        <InstagramLogo className="w-8 h-8" />
                      </div>
                      <span className="text-foreground ">{instagramUsername.startsWith('@') ? instagramUsername : `@${instagramUsername}`}</span>
                      <ExternalLink className="w-4 h-4 shrink-0 ml-auto text-muted-foreground" />
                    </a>
                  )}
                  {snapchatUsername && (
                    <a
                      href={`https://snapchat.com/add/${encodeURIComponent(snapchatUsername)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium bg-[#FFFC00] border-2 border-amber-200 hover:border-amber-400 shadow-raised hover:shadow-overlay transition-all min-w-[160px]"
                    >
                      <div className="shrink-0">
                        <SnapchatLogo className="w-8 h-8" />
                      </div>
                      <span className="text-foreground">{snapchatUsername.startsWith('@') ? snapchatUsername : snapchatUsername}</span>
                      <ExternalLink className="w-4 h-4 shrink-0 ml-auto text-muted-foreground" />
                    </a>
                  )}
                </div>
              </section>
            )}

            {/* About Me */}
            <section>
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-3">
                {t('roommates:detail.aboutMe')}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{bio}</p>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {tags.map((tag) => (
                    <span
                      key={String(tag)}
                      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground"
                    >
                      {String(tag)}
                    </span>
                  ))}
                </div>
              )}
            </section>

            {/* Interests (Phase 2): personality color, capped taxonomy */}
            {interests.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-3">
                  {t('roommates:profileForm.interestsLabel')}
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {interests.map((slug) => (
                    <span
                      key={slug}
                      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border"
                    >
                      {interestLabel(t, slug)}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Prompts (Phase 2): answered { prompt, answer } pairs */}
            {prompts.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-3">
                  {t('roommates:profileForm.promptsDisplayTitle')}
                </h3>
                <div className="space-y-3">
                  {prompts.map((p, i) => (
                    <div key={i} className="rounded-xl border border-border bg-muted/20 p-3">
                      <p className="text-xs font-semibold text-foreground">{roommatePromptLabel(t, p.prompt)}</p>
                      <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{p.answer}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Daily Vibe: Living Habits + Preferences */}
            {(livingHabits.length > 0 || preferences.length > 0) && (
              <section>
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-3">
                  {t('roommates:detail.dailyVibe')}
                </h3>
                <div className="flex flex-wrap gap-2 min-w-0 overflow-hidden">
                  {livingHabits.map(({ icon: Icon, label, value }) => (
                    <span
                      key={`habit-${label}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-muted text-muted-foreground whitespace-nowrap"
                    >
                      <Icon className="w-4 h-4 shrink-0" aria-hidden />
                      {label}: {String(value)}
                    </span>
                  ))}
                  {preferences.map(({ icon: Icon, label, value }) => (
                    <span
                      key={`pref-${label}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-muted text-muted-foreground whitespace-nowrap"
                    >
                      <Icon className="w-4 h-4 shrink-0" aria-hidden />
                      {label}: {value}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Compatibility: score + reasons + conflicts (rule-based, not AI) */}
            {match && !isOwnProfile && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                    {t('roommates:detail.compatibility')}
                  </h3>
                  {match.confidence === 'high' ? (
                    <span className="inline-flex items-center rounded-full bg-foreground px-2.5 py-0.5 text-xs font-semibold text-background">
                      {t('roommates:detail.matchPct', { pct: match.score })}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                      {t('roommates:detail.notEnoughInfo')}
                    </span>
                  )}
                </div>
                {match.confidence === 'low' && (
                  <p className="text-sm text-muted-foreground mb-3">
                    {t('roommates:detail.lowConfidenceWarning')}
                  </p>
                )}
                {match.reasons.length > 0 && (
                  <div className="mb-3">
                    <h4 className="text-xs font-semibold text-foreground mb-1.5">{t('roommates:detail.whyYouMatch')}</h4>
                    <ul className="space-y-1">
                      {match.reasons.map((reason) => (
                        <li key={reason} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                          {reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {match.conflicts.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-foreground mb-1.5">{t('roommates:detail.thingsToTalkAbout')}</h4>
                    <ul className="space-y-1">
                      {match.conflicts.map((conflict) => (
                        <li key={conflict} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
                          {conflict}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {/* My Boundaries: presets + custom */}
            {dealbreakers.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Ban className="w-4 h-4 text-destructive" aria-hidden />
                  <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                    {t('roommates:detail.myBoundaries')}
                  </h3>
                </div>
                {presetDealbreakers.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {presetDealbreakers.map((d) => (
                      <li key={d}>
                        <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-destructive/10 text-destructive border border-destructive/20">
                          {d}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {customDealbreakers.length > 0 && (
                  <ul className="flex flex-wrap gap-2 mt-2">
                    {customDealbreakers.map((d) => (
                      <li key={d}>
                        <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-destructive/10 text-destructive border border-dashed border-destructive/30">
                          {d}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {/* Safety - report / block */}
            {!isOwnProfile && (
              <section className="border-t border-border pt-4">
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 w-full gap-2 rounded-full"
                    onClick={() => setReportUserOpen(true)}
                  >
                    <Flag className="h-4 w-4" />
                    {t('roommates:detail.report')}
                  </Button>
                  <BlockUserButton
                    targetUserId={profile.id}
                    displayName={profile.full_name}
                    className="h-11 w-full rounded-full"
                  />
                </div>
              </section>
            )}
          </div>
          </div>
        </div>
        </div>

        {/* Mobile sticky footer - Message */}
        {!isOwnProfile && onMessage && (
          <div className="flex-none border-t border-border bg-card p-4 pb-[max(5rem,env(safe-area-inset-bottom))] pt-3 md:hidden">
            <Button
              // KEEP: primary CTA of the roommate detail (message) — mobile variant
              className="h-12 w-full gap-2 rounded-full bg-malachite-800 text-white hover:bg-malachite-900"
              onClick={() => onMessage(profile)}
            >
              <MessageCircle className="h-5 w-5" />
              {t('roommates:detail.message')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
      <ReportContentDialog
        open={reportUserOpen}
        onOpenChange={setReportUserOpen}
        contentType="user"
        contentId={profile.id}
        contentLabel={name !== 'Anonymous' ? name : 'this user'}
      />
    </>
  );
}
