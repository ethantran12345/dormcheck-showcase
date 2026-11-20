import { Capacitor } from '@capacitor/core';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useChat } from '@/contexts/ChatContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { useModalOverlay } from '@/contexts/ModalOverlayContext';
import {
  getFreshmanGraduationYear,
  getGraduationCriteriaForMainAndStanding,
  YEAR_STANDING_LABELS,
  type MainYearToggle,
  type YearStandingLabel,
} from '@/lib/academicYear';
import { Card, CardContent } from '@/components/ui/card';
import { PageContainer } from '@/components/ui/page-container';
import { BookmarkToggle } from '@/components/app/BookmarkToggle';
import { AdaptiveOverlay, AdaptiveOverlayContent } from '@/components/ui/adaptive-overlay';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import {
  RoommateCard,
  ROOMMATE_PROFILE_SELECT,
  type RoommateProfileRow,
} from '@/components/roommate/RoommateCard';
import { RoommateDetailModal } from '@/components/roommate/RoommateDetailModal';
import { TopMatchesBand } from '@/components/roommate/TopMatchesBand';
import {
  scoreRoommateMatch,
  getViewerPersona,
  TOP_MATCH_MIN_SCORE,
  type MatchResult,
} from '@/lib/roommateMatch';
import { useViewerRoommateProfile } from '@/hooks/useViewerRoommateProfile';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useHousingSaved } from '@/contexts/HousingSavedContext';
import { useSavedRoommates } from '@/hooks/useSavedRoommates';
import { useHasRoommateProfile } from '@/hooks/useHasRoommateProfile';
import { useBlockedUserIds } from '@/hooks/useBlockedUsers';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { UserPlus, Users, Users2, SlidersHorizontal, Pencil, Search, X } from 'lucide-react';
import { Link } from 'react-router';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import {
  CLEANLINESS_OPTIONS,
  SOCIAL_OPTIONS,
  CONFLICT_STYLE_OPTIONS,
  STUDY_OPTIONS,
  GUESTS_OPTIONS,
  SLEEP_OPTIONS,
  TEMP_OPTIONS,
  DEALBREAKER_OPTIONS,
} from '@/components/roommate/RoommateProfileForm';
import { roommateOptionLabel } from '@/components/roommate/optionLabels';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { SneakPeekBlurWall } from '@/components/ui/sneak-peek-blur-wall';
import { PullToRefreshIndicator } from '@/components/ui/pull-to-refresh-indicator';
import { usePullToRefreshQueries } from '@/hooks/usePullToRefresh';
import EditProfile from './EditProfile';
import { apiPost } from '@/lib/apiPost';

type BrowseStudentType = 'All' | MainYearToggle;

async function fetchRoommateProfiles(
  studentType: BrowseStudentType,
  yearStandingFilters: YearStandingLabel[],
  currentUserId: string | undefined
): Promise<RoommateProfileRow[]> {
  const baseYear = getFreshmanGraduationYear();

  let query = supabase
    .from('roommate_profiles')
    .select(ROOMMATE_PROFILE_SELECT)
    .or('is_public.eq.true,is_roommate_searching.eq.true')
    .not('bio', 'is', null)
    .order('created_at', { ascending: false });

  if (currentUserId) {
    query = query.neq('id', currentUserId);
  }

  if (studentType !== 'All') {
    const criteria = getGraduationCriteriaForMainAndStanding(
      studentType,
      yearStandingFilters,
      baseYear
    );
    if (criteria.exact != null) {
      query = query.or(`graduation_year.eq.${criteria.exact},graduation_year.is.null`);
    } else if (criteria.lt != null) {
      query = query.or(`graduation_year.lt.${criteria.lt},graduation_year.is.null`);
    } else if (criteria.orClause) {
      query = query.or(criteria.orClause);
    }
  }

  const { data, error } = await query;

  if (error) {
    console.error('[RoommatePage] profiles fetch error:', error.message);
    throw error;
  }
  return (data as unknown as RoommateProfileRow[]) ?? [];
}

const BROWSE_ROOMMATE_DM_DIVIDER = '━━━━━━━━━━━━━━━';

// "Find Roommates" (finding) tab retired 2026-07-15 - roommates is Browse-only now.

function buildBrowseRoommateProfileDmCard(profile: RoommateProfileRow): string {
  const currentDorm =
    typeof profile.current_dorm === 'string' ? profile.current_dorm.trim() : '';
  const lines = [
    `Hey! I saw your roommate profile and wanted to reach out.`,
    ``,
    BROWSE_ROOMMATE_DM_DIVIDER,
    `👤 ${profile.full_name || 'Student'}`,
    [
      profile.grade_level ? `🎓 ${profile.grade_level}` : '',
      profile.major ? `📚 ${profile.major}` : '',
      currentDorm ? `🏠 Currently in ${currentDorm}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    profile.bio?.trim()
      ? `\n${
          profile.bio.length > 120 ? `${profile.bio.slice(0, 120)}...` : profile.bio
        }`
      : '',
    BROWSE_ROOMMATE_DM_DIVIDER,
  ];
  const body = lines.filter((line) => line !== undefined && line !== '').join('\n');
  return `${body}\n\n[Dormcheck:profile:${profile.id}]`;
}

// Shared pill skin for the browse filter groups. Composes the ToggleGroupItem
// primitive (keyboard roving + roles for free) but keeps the pre-existing pill
// look: rounded-full, muted "off", tinted "on" (brand green, or destructive red
// for the boundaries group). tailwind-merge lets these override toggleVariants'
// rounded-md / h-10 / accent defaults so there's no visual drift.
const filterPillClass = (tone: 'brand' | 'destructive', disabled?: boolean) =>
  cn(
    'h-auto min-w-0 rounded-full border border-transparent bg-muted/50 px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-border',
    tone === 'brand'
      ? 'data-[state=on]:border-border data-[state=on]:bg-muted data-[state=on]:text-foreground'
      : 'data-[state=on]:border-destructive/30 data-[state=on]:bg-destructive/10 data-[state=on]:text-destructive',
    disabled && 'cursor-not-allowed opacity-50',
  );

function FilterPillGroup({
  options,
  value,
  onValueChange,
  getLabel,
  disabled,
  tone = 'brand',
}: {
  options: readonly string[];
  value: string[];
  onValueChange: (value: string[]) => void;
  getLabel: (opt: string) => ReactNode;
  disabled?: boolean;
  tone?: 'brand' | 'destructive';
}) {
  return (
    <ToggleGroup
      type="multiple"
      value={value}
      onValueChange={onValueChange}
      className="flex flex-wrap justify-start gap-2"
    >
      {options.map((opt) => (
        <ToggleGroupItem
          key={opt}
          value={opt}
          disabled={disabled}
          className={filterPillClass(tone, disabled)}
        >
          {getLabel(opt)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export default function RoommatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAdmin } = useAuth();
  const { blockedUserIds } = useBlockedUserIds();
  const { savedIds: savedRoommateIds, savedIdList: savedRoommateIdList, toggle: toggleSavedRoommate, isSaved: isSavedRoommate } = useSavedRoommates(user?.id);
  const [selectedProfile, setSelectedProfile] = useState<RoommateProfileRow | null>(null);
  const [studentTypeFilter, setStudentTypeFilter] = useState<BrowseStudentType>('All');
  const [yearStandingFilters, setYearStandingFilters] = useState<YearStandingLabel[]>([]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [habitFilters, setHabitFilters] = useState<{
    roomState: string[];
    socialLevel: string[];
    conflictStyle: string[];
    focusZone: string[];
    guests: string[];
    sleep: string[];
    temp: string[];
  }>({
    roomState: [],
    socialLevel: [],
    conflictStyle: [],
    focusZone: [],
    guests: [],
    sleep: [],
    temp: [],
  });
  const [boundaryFilters, setBoundaryFilters] = useState<string[]>([]);
  const [minMatchFilter, setMinMatchFilter] = useState(0);
  const [sameDormOnly, setSameDormOnly] = useState(false);
  const [hideBoundaryConflicts, setHideBoundaryConflicts] = useState(false);
  // null = persona default; user choice always wins once set.
  const [userSort, setUserSort] = useState<'best' | 'newest' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isEditProfileModalOpen, setIsEditProfileModalOpen] = useState(false);
  // Roommates is Browse-only (the "Find Roommates" tab was retired 2026-07-15).
  const activeTab = 'browse' as const;

  useEffect(() => {
    const requestedTab = new URLSearchParams(location.search).get('tab');
    const requestedStateTab = (location.state as { roommateTab?: string } | null)?.roommateTab;
    if (requestedTab !== 'finding' && requestedStateTab !== 'finding') return;

    // Normalize retired deep links instead of leaving users on a URL that
    // promises a post composer which no longer exists.
    navigate('/roommates', { replace: true, state: null });
  }, [location.search, location.state, navigate]);

  const isMobile = useIsMobile();
  const { showConfirmedRoommates } = useFeatureFlags();

  // Desktop opens the filters as a lightweight dropdown popover, so they must
  // NOT hide the native bottom nav / housing sheet the way the mobile
  // full-screen drawer does.
  const shouldHideBottomNav =
    isEditProfileModalOpen ||
    !!selectedProfile ||
    (isMobile && advancedFiltersOpen);

  const modalOverlay = useModalOverlay();
  const { openChatWithConversation, primeKeyboard } = useChat();
  const registerHeartClickOverride = useHousingSaved()?.registerHeartClickOverride;
  const setHeartOverrideActive = useHousingSaved()?.setHeartOverrideActive;
  const setSavedCount = useHousingSaved()?.setSavedCount;

  useEffect(() => {
    modalOverlay?.setHideBottomNav(shouldHideBottomNav);
  }, [shouldHideBottomNav, modalOverlay]);

  useEffect(() => {
    return () => {
      modalOverlay?.setHideBottomNav(false);
    };
  }, [modalOverlay]);

  const openEditProfile = () => {
    if (!user) {
      navigate('/auth');
      return;
    }

    // Mobile keeps the existing full-page behavior.
    if (isMobile) {
      navigate('/profile/edit');
      return;
    }

    // Desktop: open the existing overlay modal without changing routes.
    setIsEditProfileModalOpen(true);
  };

  // Per-item toggle handlers removed in Tranche 3: the browse filter groups now
  // compose <FilterPillGroup> (ToggleGroup), which reports the full next value
  // array via onValueChange, so membership toggling lives in the primitive.

  const clearBrowseAdvancedFilters = useCallback(() => {
    setStudentTypeFilter('All');
    setYearStandingFilters([]);
    setHabitFilters({
      roomState: [],
      socialLevel: [],
      conflictStyle: [],
      focusZone: [],
      guests: [],
      sleep: [],
      temp: [],
    });
    setBoundaryFilters([]);
    setMinMatchFilter(0);
    setSameDormOnly(false);
    setHideBoundaryConflicts(false);
  }, []);

  const {
    data: profiles = null,
    isLoading: profilesLoading,
    error: profilesError,
  } = useQuery({
    queryKey: ['profiles_feed', studentTypeFilter, yearStandingFilters, user?.id ?? 'guest'],
    queryFn: () =>
      fetchRoommateProfiles(studentTypeFilter, yearStandingFilters, user?.id),
  });

  // Window-scrolled page, so the hook's default window listeners apply. Scoped to
  // the feed's own keys — the filter/user segments live deeper in the key, so a
  // root-segment match refreshes whichever filter combination is on screen.
  const { pull, refreshing } = usePullToRefreshQueries(['profiles_feed']);

  // Support deep-links/back navigation from /roommates/liked
  useEffect(() => {
    const s = (location.state ?? {}) as Record<string, unknown>;
    if (s?.preselectProfile) {
      setSelectedProfile(s.preselectProfile as RoommateProfileRow);
    }
  }, [location.state]);

  useEffect(() => {
    if (activeTab !== 'browse') return;
    registerHeartClickOverride?.(() => setShowFavoritesOnly((v) => !v));
    return () => {
      registerHeartClickOverride?.(null);
      setHeartOverrideActive?.(false);
      setSavedCount?.(null);
    };
  }, [activeTab, registerHeartClickOverride, setHeartOverrideActive, setSavedCount]);

  useEffect(() => {
    if (activeTab !== 'browse') return;
    setHeartOverrideActive?.(showFavoritesOnly);
  }, [activeTab, showFavoritesOnly, setHeartOverrideActive]);

  useEffect(() => {
    if (activeTab !== 'browse') return;
    setSavedCount?.(savedRoommateIdList.length);
  }, [activeTab, savedRoommateIdList.length, setSavedCount]);

  useEffect(() => {
    if (savedRoommateIdList.length === 0) setShowFavoritesOnly(false);
  }, [savedRoommateIdList.length]);

  const { hasProfile: hasRoommateProfile } = useHasRoommateProfile();

  // Compatibility scoring baseline: the viewer's own roommate profile.
  const { data: viewerProfile } = useViewerRoommateProfile();
  const persona = useMemo(
    () => (viewerProfile ? getViewerPersona(viewerProfile) : 'underclassman'),
    [viewerProfile],
  );

  // id -> MatchResult over the fetched pool; null until the viewer has a
  // scorable profile (badges, band, sort, and compat filters all key off this).
  const scored = useMemo(() => {
    if (!viewerProfile || !hasRoommateProfile || profiles == null) return null;
    return new Map<string, MatchResult>(
      profiles
        .filter((p) => p.id)
        .map((p) => [p.id, scoreRoommateMatch(viewerProfile, p)]),
    );
  }, [viewerProfile, hasRoommateProfile, profiles]);

  const effectiveSort: 'best' | 'newest' = scored
    ? (userSort ?? (persona === 'underclassman' ? 'best' : 'newest'))
    : 'newest';

  const profileList = useMemo(() => {
    if (profiles == null) return [];
    let list = Array.isArray(profiles) ? [...profiles] : [];
    list = list.filter((p) => !p.id || !blockedUserIds.has(p.id));
    if (showFavoritesOnly && user) {
      list = list.filter((p) => p.id && savedRoommateIds.has(p.id));
    }
    const { roomState, socialLevel, conflictStyle, focusZone, guests, sleep, temp } = habitFilters;
    const hasHabits =
      roomState.length > 0 ||
      socialLevel.length > 0 ||
      conflictStyle.length > 0 ||
      focusZone.length > 0 ||
      guests.length > 0 ||
      sleep.length > 0 ||
      temp.length > 0;
    const hasBoundaries = boundaryFilters.length > 0;
    if (hasHabits) {
      list = list.filter((p) => {
        const roomOk = roomState.length === 0 || (p.cleanliness && roomState.includes(p.cleanliness));
        const socialOk = socialLevel.length === 0 || (p.social_level && socialLevel.includes(p.social_level));
        const conflictOk = conflictStyle.length === 0 || (p.conflict_style && conflictStyle.includes(p.conflict_style));
        const focusOk = focusZone.length === 0 || (p.study_style && focusZone.includes(p.study_style));
        const guestsVal = p.guest_preference ?? p.guests;
        const guestsOk = guests.length === 0 || (guestsVal && guests.includes(guestsVal));
        const sleepVal = p.sleep_habit ?? p.sleep;
        const sleepOk = sleep.length === 0 || (sleepVal && sleep.includes(sleepVal));
        const tempVal = p.temp_preference ?? p.temp;
        const tempOk = temp.length === 0 || (tempVal && temp.includes(tempVal));
        return roomOk && socialOk && conflictOk && focusOk && guestsOk && sleepOk && tempOk;
      });
    }
    if (hasBoundaries) {
      const profileDealbreakers = (p: RoommateProfileRow) =>
        Array.isArray(p.dealbreakers) ? p.dealbreakers : [];
      list = list.filter((p) =>
        boundaryFilters.some((b) => profileDealbreakers(p).includes(b))
      );
    }
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      list = list.filter((p) => (p.full_name || '').toLowerCase().includes(query));
    }
    // Compatibility filters (only meaningful once the viewer is scorable)
    if (scored) {
      if (minMatchFilter > 0) {
        list = list.filter((p) => (scored.get(p.id)?.score ?? 0) >= minMatchFilter);
      }
      if (hideBoundaryConflicts) {
        list = list.filter((p) => (scored.get(p.id)?.conflicts.length ?? 0) === 0);
      }
      const viewerDorm = viewerProfile?.current_dorm?.trim();
      if (sameDormOnly && viewerDorm) {
        list = list.filter(
          (p) => typeof p.current_dorm === 'string' && p.current_dorm.trim() === viewerDorm,
        );
      }
    }
    if (effectiveSort === 'best' && scored) {
      list = [...list].sort((a, b) => {
        const ma = scored.get(a.id);
        const mb = scored.get(b.id);
        const confA = ma?.confidence === 'high' ? 1 : 0;
        const confB = mb?.confidence === 'high' ? 1 : 0;
        if (confA !== confB) return confB - confA;
        return (mb?.score ?? 0) - (ma?.score ?? 0);
      });
    }
    return list;
  }, [profiles, habitFilters, boundaryFilters, showFavoritesOnly, user, savedRoommateIds, searchQuery, blockedUserIds, scored, minMatchFilter, hideBoundaryConflicts, sameDormOnly, viewerProfile, effectiveSort]);

  // Top matches band: filtered pool, high-confidence, score >= threshold.
  const topMatches = useMemo(() => {
    if (!scored || persona !== 'underclassman') return [];
    const entries = profileList
      .filter((p) => !user || p.id !== user.id)
      .map((p) => ({ profile: p, match: scored.get(p.id) }))
      .filter(
        (e): e is { profile: RoommateProfileRow; match: MatchResult } =>
          !!e.match && e.match.confidence === 'high' && e.match.score >= TOP_MATCH_MIN_SCORE,
      )
      .sort((a, b) => b.match.score - a.match.score)
      .slice(0, 6);
    return entries;
  }, [scored, persona, profileList, user]);

  const browseAdvancedFilterCount = useMemo(() => {
    let count = 0;
    if (studentTypeFilter !== 'All') count++;
    if (yearStandingFilters.length > 0) count++;
    const { roomState, socialLevel, conflictStyle, focusZone, guests, sleep, temp } = habitFilters;
    const hasHabits =
      roomState.length > 0 ||
      socialLevel.length > 0 ||
      conflictStyle.length > 0 ||
      focusZone.length > 0 ||
      guests.length > 0 ||
      sleep.length > 0 ||
      temp.length > 0;
    if (hasHabits) count++;
    if (boundaryFilters.length > 0) count++;
    if (minMatchFilter > 0) count++;
    if (sameDormOnly) count++;
    if (hideBoundaryConflicts) count++;
    return count;
  }, [studentTypeFilter, yearStandingFilters, habitFilters, boundaryFilters, minMatchFilter, sameDormOnly, hideBoundaryConflicts]);

  const handleMessageRoommate = async (profile: RoommateProfileRow) => {
    if (!user) {
      toast.error(t('roommates:browse.signInRequired'), {
        description: t('roommates:browse.signInToMessage'),
      });
      navigate('/auth');
      return;
    }
    const targetUserId = profile.id;
    if (!targetUserId) return;
    if (targetUserId === user.id) {
      toast.error(t('roommates:browse.cantMessageSelf'));
      return;
    }
    // In-gesture: raise the iOS keyboard now so it survives the async lookup + navigation.
    primeKeyboard();
    const me = user.id;
    const them = targetUserId;
    const { data: existingRows } = await supabase
      .from('conversations')
      .select('id')
      .or(`and(participant_1.eq.${me},participant_2.eq.${them}),and(participant_1.eq.${them},participant_2.eq.${me})`)
      .limit(1);
    const existing = existingRows?.[0];
    let conversationId = existing?.id;
    if (!conversationId) {
      const p1 = me < them ? me : them;
      const p2 = me < them ? them : me;
      const { data: created, error } = await supabase
        .from('conversations')
        .insert({ participant_1: p1, participant_2: p2, initiated_by: me, status: 'pending' })
        .select('id')
        .single();
      if (error || !created?.id) {
        console.error('Create conversation error:', error);
        toast.error(t('roommates:browse.couldNotStartConversation'));
        return;
      }
      conversationId = created.id;
    }

    const contextMessage = buildBrowseRoommateProfileDmCard(profile);

    const { data: existingMsgs, error: existingMsgsError } = await supabase
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .limit(1);

    const conversationHasMessages =
      !existingMsgsError && (existingMsgs?.length ?? 0) > 0;

    if (!conversationHasMessages) {
      try {
        const { error: msgError } = await supabase.from('messages').insert({
          conversation_id: conversationId,
          sender_id: me,
          content: contextMessage,
        });
        if (msgError) throw msgError;
        if (!isAdmin) {
          void apiPost('/api/notify-message-request', { conversationId }).catch(() => {});
        }
      } catch (e) {
        console.warn('[RoommatePage] send profile context failed:', e);
      }
    }
    if (isMobile) {
      navigate(`/messages?conversation=${encodeURIComponent(conversationId)}`);
    } else {
      openChatWithConversation(conversationId);
    }
  };

  const viewerHasDorm = !!viewerProfile?.current_dorm?.trim();

  const browseFiltersFields = (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{t('roommates:browse.filters.showLikedOnly')}</h3>
        <Switch checked={showFavoritesOnly} onCheckedChange={setShowFavoritesOnly} />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">{t('roommates:browse.filters.compatibility')}</h3>
        {!scored ? (
          <p className="text-xs text-muted-foreground">
            {t('roommates:browse.filters.completeProfileMessage')}
          </p>
        ) : (
          <div className="space-y-5">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">{t('roommates:browse.filters.minimumMatch')}</p>
                <span className="text-xs font-semibold text-foreground">
                  {minMatchFilter > 0 ? `${minMatchFilter}%` : t('roommates:browse.filters.any')}
                </span>
              </div>
              <Slider
                value={[minMatchFilter]}
                onValueChange={(v) => setMinMatchFilter(v[0] ?? 0)}
                min={0}
                max={100}
                step={5}
                aria-label={t('roommates:browse.filters.minimumMatchAriaLabel')}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">{t('roommates:browse.filters.sameDormOnly')}</p>
                {!viewerHasDorm && (
                  <p className="text-xs text-muted-foreground">
                    {t('roommates:browse.filters.addDormMessage')}
                  </p>
                )}
              </div>
              <Switch
                checked={sameDormOnly}
                onCheckedChange={setSameDormOnly}
                disabled={!viewerHasDorm}
                aria-label={t('roommates:browse.filters.sameDormOnlyAriaLabel')}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-foreground">
                {t('roommates:browse.filters.hideBoundaryConflicts')}
              </p>
              <Switch
                checked={hideBoundaryConflicts}
                onCheckedChange={setHideBoundaryConflicts}
                aria-label={t('roommates:browse.filters.hideBoundaryConflictsAriaLabel')}
              />
            </div>
          </div>
        )}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">{t('roommates:browse.filters.studentType')}</h3>
        <ToggleGroup
          type="single"
          value={studentTypeFilter}
          onValueChange={(v) => {
            // Deselect-guard: this control is always single-select with one active.
            if (!v) return;
            setStudentTypeFilter(v as BrowseStudentType);
            if (v === 'All' || v === 'Freshmen') {
              setYearStandingFilters([]);
            }
          }}
          className="flex flex-wrap justify-start gap-2"
        >
          {(['All', 'Freshmen', 'Upperclassmen'] as const).map((opt) => (
            <ToggleGroupItem key={opt} value={opt} className={filterPillClass('brand')}>
              {opt === 'All' ? t('roommates:browse.filters.studentTypeAll') : opt === 'Freshmen' ? t('roommates:browse.filters.studentTypeFreshmen') : t('roommates:browse.filters.studentTypeUpperclassmen')}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">{t('roommates:browse.filters.yearStanding')}</h3>
        <p className="text-xs text-muted-foreground mb-3">
          {studentTypeFilter === 'Upperclassmen'
            ? t('roommates:browse.filters.yearStandingUpperclassmenHelp')
            : t('roommates:browse.filters.yearStandingHelp')}
        </p>
        <FilterPillGroup
          options={YEAR_STANDING_LABELS}
          value={yearStandingFilters}
          onValueChange={(v) => setYearStandingFilters(v as YearStandingLabel[])}
          getLabel={(opt) => opt}
          disabled={studentTypeFilter !== 'Upperclassmen'}
        />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">{t('roommates:browse.filters.habits')}</h3>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">{t('roommates:browse.filters.roomState')}</p>
            <FilterPillGroup
              options={CLEANLINESS_OPTIONS}
              value={habitFilters.roomState}
              onValueChange={(v) => setHabitFilters((prev) => ({ ...prev, roomState: v }))}
              getLabel={(opt) => roommateOptionLabel(t, opt)}
            />
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">{t('roommates:browse.filters.socialLevel')}</p>
            <FilterPillGroup
              options={SOCIAL_OPTIONS}
              value={habitFilters.socialLevel}
              onValueChange={(v) => setHabitFilters((prev) => ({ ...prev, socialLevel: v }))}
              getLabel={(opt) => roommateOptionLabel(t, opt)}
            />
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">{t('roommates:browse.filters.conflictStyle')}</p>
            <FilterPillGroup
              options={CONFLICT_STYLE_OPTIONS}
              value={habitFilters.conflictStyle}
              onValueChange={(v) => setHabitFilters((prev) => ({ ...prev, conflictStyle: v }))}
              getLabel={(opt) => roommateOptionLabel(t, opt)}
            />
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">{t('roommates:browse.filters.focusZone')}</p>
            <FilterPillGroup
              options={STUDY_OPTIONS}
              value={habitFilters.focusZone}
              onValueChange={(v) => setHabitFilters((prev) => ({ ...prev, focusZone: v }))}
              getLabel={(opt) => roommateOptionLabel(t, opt)}
            />
          </div>
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">{t('roommates:browse.filters.lifestyle')}</h3>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">{t('roommates:browse.filters.guests')}</p>
            <FilterPillGroup
              options={GUESTS_OPTIONS}
              value={habitFilters.guests}
              onValueChange={(v) => setHabitFilters((prev) => ({ ...prev, guests: v }))}
              getLabel={(opt) => roommateOptionLabel(t, opt)}
            />
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">{t('roommates:browse.filters.sleep')}</p>
            <FilterPillGroup
              options={SLEEP_OPTIONS}
              value={habitFilters.sleep}
              onValueChange={(v) => setHabitFilters((prev) => ({ ...prev, sleep: v }))}
              getLabel={(opt) => roommateOptionLabel(t, opt)}
            />
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">{t('roommates:browse.filters.temp')}</p>
            <FilterPillGroup
              options={TEMP_OPTIONS}
              value={habitFilters.temp}
              onValueChange={(v) => setHabitFilters((prev) => ({ ...prev, temp: v }))}
              getLabel={(opt) => roommateOptionLabel(t, opt)}
            />
          </div>
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">{t('roommates:browse.filters.myBoundaries')}</h3>
        <p className="text-xs text-muted-foreground mb-3">
          {t('roommates:browse.filters.boundariesHelp')}
        </p>
        <FilterPillGroup
          options={DEALBREAKER_OPTIONS}
          value={boundaryFilters}
          onValueChange={setBoundaryFilters}
          getLabel={(opt) => roommateOptionLabel(t, opt)}
          tone="destructive"
        />
      </div>
    </div>
  );

  // Shared trigger styling so the mobile drawer button and the desktop popover
  // trigger stay identical.
  const filtersButtonClass = cn(
    'shrink-0 h-11 gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground shadow-none hover:bg-accent hover:text-foreground [&_svg]:text-muted-foreground',
    browseAdvancedFilterCount > 0 && 'border-foreground'
  );
  const filtersButtonInner = (
    <>
      <SlidersHorizontal className="w-4 h-4 shrink-0" />
      {browseAdvancedFilterCount > 0
        ? t('roommates:browse.filtersWithCount', { count: browseAdvancedFilterCount })
        : t('roommates:browse.filters.label')}
    </>
  );

  return (
    <div className="roommates-container relative bg-background overflow-x-hidden min-h-screen">
      <PullToRefreshIndicator pull={pull} refreshing={refreshing} />
      {/* WIDE, widened: the card grid runs to xl:grid-cols-5, and at the 1152px
          `wide` default five columns fall to ~200px each. 1400px is what keeps a
          five-across roommate card readable. Below md the list is full-bleed. */}
      <PageContainer width="wide" className="px-4 sm:px-8 lg:px-12 pt-2 pb-0 md:max-w-[1400px] md:pb-12">
        <div className="mt-2 space-y-3 sm:space-y-6 min-h-screen">
          <div className="min-w-0 shrink-0">
            {/* Native: title scrolls away with content (sits by the pill) instead of a fixed top-bar title. */}
            <div className="flex items-center gap-2">
              <h1 className={cn("truncate text-2xl font-bold leading-tight text-foreground", Capacitor.isNativePlatform() && "pr-28 text-3xl")}>{t('roommates:browse.title')}</h1>
              <BookmarkToggle />
            </div>
            <p className="hidden text-sm text-muted-foreground mt-1 md:block">{t('roommates:browse.subtitle')}</p>
          </div>

          <div className="flex items-center justify-end gap-2 md:hidden">
            {showConfirmedRoommates && (
              <Link
                to="/roommates/us"
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-card px-3 py-2 text-sm font-medium leading-none text-foreground"
              >
                <Users2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {t('misc:nav.myRoommates')}
              </Link>
            )}
          </div>

        {activeTab === 'browse' && (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center sm:flex-wrap gap-3 sm:gap-2 shrink-0">
              <div className="flex items-center gap-2 flex-1 min-w-0 w-full sm:w-auto">
                <div className="relative flex-1 min-w-0">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder={t('roommates:browse.searchPlaceholder')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={cn(
                      'h-11 pl-9 rounded-full bg-card border border-border shadow-raised focus-visible:ring-2 focus-visible:ring-malachite-600/30 focus-visible:border-malachite-600/40', // KEEP: interaction-only focus ring
                      isMobile && 'pr-12',
                    )}
                  />
                  {/* Mobile: Filters live inside the search bar (one control
                      surface); desktop keeps the labelled pill beside it. */}
                  {isMobile && (
                    <button
                      type="button"
                      aria-label={
                        browseAdvancedFilterCount > 0
                          ? t('roommates:browse.filtersWithCount', { count: browseAdvancedFilterCount })
                          : t('roommates:browse.filters.label')
                      }
                      onClick={() => setAdvancedFiltersOpen((prev) => !prev)}
                      className={cn(
                        'absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full transition-colors',
                        browseAdvancedFilterCount > 0
                          ? 'bg-foreground text-background'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden />
                    </button>
                  )}
                </div>
                <div className="relative shrink-0">
                  {isMobile ? (
                      <AdaptiveOverlay open={advancedFiltersOpen} onOpenChange={setAdvancedFiltersOpen} mobileVariant="drawer" shouldScaleBackground={false}>
                        <AdaptiveOverlayContent
                          priority
                          hideDefaultHandle
                          className="h-auto max-h-[85vh] w-full rounded-t-2xl pb-0"
                        >
                          <div className="mx-auto mt-4 h-2 w-[100px] shrink-0 rounded-full bg-muted md:hidden" />
                          <div className="shrink-0 p-4 pb-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-lg font-semibold">{t('roommates:browse.filters.label')}</span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={clearBrowseAdvancedFilters}
                                  className="cursor-pointer text-sm text-foreground hover:underline"
                                >
                                  {t('roommates:browse.filters.clearAll')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setAdvancedFiltersOpen(false)}
                                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                                  aria-label={t('roommates:browse.filters.closeAriaLabel')}
                                >
                                  <X className="h-5 w-5" />
                                </button>
                              </div>
                            </div>
                          </div>
                          <div className="overflow-y-auto overscroll-contain p-4 pt-0 max-h-[min(56vh,calc(85vh-10rem))]">
                            {browseFiltersFields}
                          </div>
                          <div className="shrink-0 border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                            <Button
                              type="button"
                              // KEEP: primary CTA of this filter dialog (apply)
                            className="w-full bg-malachite-800 hover:bg-malachite-900 text-white"
                              onClick={() => setAdvancedFiltersOpen(false)}
                            >
                              {t('roommates:browse.filters.showResults')}
                            </Button>
                          </div>
                        </AdaptiveOverlayContent>
                      </AdaptiveOverlay>
                  ) : (
                    <Popover open={advancedFiltersOpen} onOpenChange={setAdvancedFiltersOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          className={filtersButtonClass}
                        >
                          {filtersButtonInner}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        sideOffset={8}
                        className="flex max-h-[min(70vh,640px)] w-[min(92vw,420px)] flex-col gap-0 p-0"
                      >
                        <div className="shrink-0 border-b border-border p-4">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-base font-semibold">{t('roommates:browse.filters.label')}</span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={clearBrowseAdvancedFilters}
                                className="cursor-pointer text-sm text-foreground hover:underline"
                              >
                                {t('roommates:browse.filters.clearAll')}
                              </button>
                              <button
                                type="button"
                                onClick={() => setAdvancedFiltersOpen(false)}
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                                aria-label={t('roommates:browse.filters.closeAriaLabel')}
                              >
                                <X className="h-5 w-5" />
                              </button>
                            </div>
                          </div>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 scrollbar-thin">
                          {browseFiltersFields}
                        </div>
                        <div className="shrink-0 border-t border-border p-4">
                          <Button
                            type="button"
                            // KEEP: primary CTA of this filter dialog (apply)
                            className="w-full bg-malachite-800 hover:bg-malachite-900 text-white"
                            onClick={() => setAdvancedFiltersOpen(false)}
                          >
                            {t('roommates:browse.filters.showResults')}
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </div>
            </div>

            {scored && (
              <div
                className="flex shrink-0 items-center gap-2"
                role="group"
                aria-label={t('roommates:browse.sortAriaLabel')}
              >
                <span className="text-xs font-medium text-muted-foreground">{t('roommates:browse.sort')}:</span>
                {(
                  [
                    { key: 'best' as const, labelKey: 'roommates:browse.sortBestMatch' },
                    { key: 'newest' as const, labelKey: 'roommates:browse.sortNewest' },
                  ]
                ).map(({ key, labelKey }) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={effectiveSort === key}
                    onClick={() => setUserSort(key)}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
                      effectiveSort === key
                        ? 'bg-muted text-foreground border-border'
                        : 'bg-muted/50 text-muted-foreground border-transparent hover:border-border',
                    )}
                  >
                    {t(labelKey)}
                  </button>
                ))}
              </div>
            )}

            {user && !scored && !profilesLoading && (
              <div className="flex shrink-0 flex-col items-start justify-between gap-2 rounded-xl border border-border bg-muted p-3 sm:flex-row sm:items-center">
                <p className="text-sm text-foreground">
                  {t('roommates:browse.completeProfileToMatchMessage')}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 rounded-full border-border text-foreground hover:bg-accent hover:text-foreground"
                  onClick={openEditProfile}
                >
                  {hasRoommateProfile ? t('roommates:browse.finishProfile') : t('roommates:browse.createProfile')}
                </Button>
              </div>
            )}

            <div className="grid w-full shrink-0 grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-row sm:items-center sm:justify-end">
              <Button
                size="sm"
                // KEEP: primary CTA of the roommates screen (create profile)
                className="h-10 min-h-[44px] w-full justify-center rounded-md bg-malachite-800 hover:bg-malachite-900 text-white [&_svg]:text-white focus-visible:[&_svg]:text-white sm:h-9 sm:min-h-0 sm:w-auto"
                onClick={openEditProfile}
              >
                {hasRoommateProfile ? (
                  <>
                    <Pencil className="w-4 h-4 mr-2 shrink-0" />
                    {t('roommates:browse.editProfile')}
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4 mr-2 shrink-0" />
                    {t('roommates:browse.createProfile')}
                  </>
                )}
              </Button>
            </div>

            {profilesLoading && profiles == null ? (
              <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
                {t('roommates:browse.loadingProfiles')}
              </div>
            ) : profilesError ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12 px-6 text-center">
                  <p className="text-muted-foreground mb-4">
                    {t('roommates:browse.loadError')}
                  </p>
                  <Button variant="outline" onClick={() => window.location.reload()}>
                    {t('common:actions.retry')}
                  </Button>
                </CardContent>
              </Card>
            ) : !profileList.length ? (
              <div className="w-full">
                <Card className="border-dashed">
                  <CardContent className="flex flex-col items-center justify-center py-12 px-6 text-center">
                    <Users className="w-12 h-12 text-muted-foreground mb-4" />
                    {showFavoritesOnly && profiles && profiles.length > 0 ? (
                      <>
                        <p className="font-medium text-foreground mb-1">{t('roommates:browse.noSavedProfiles')}</p>
                        <p className="text-sm text-muted-foreground mb-4">
                          {t('roommates:browse.saveProfilesHelp')}
                        </p>
                        <Button variant="outline" size="sm" onClick={() => setShowFavoritesOnly(false)}>
                          {t('roommates:browse.showAllProfiles')}
                        </Button>
                      </>
                    ) : (
                      <>
                        <p className="text-muted-foreground mb-4">
                          {t('roommates:browse.noProfilesYet')}
                        </p>
                        <Button
                          className="gap-2"
                          onClick={openEditProfile}
                        >
                          {user && hasRoommateProfile ? (
                            <>
                              <Pencil className="w-4 h-4" />
                              {t('roommates:browse.editProfile')}
                            </>
                          ) : (
                            <>
                              <UserPlus className="w-4 h-4" />
                              {t('roommates:browse.createProfile')}
                            </>
                          )}
                        </Button>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : (
              <SneakPeekBlurWall
                isAuthenticated={!!user}
                className="w-full"
                revealHeight="1150px"
                title={t('roommates:browse.peekTitle')}
                description={t('roommates:browse.peekDescription')}
              >
                {topMatches.length >= 3 && (
                  <TopMatchesBand
                    entries={topMatches}
                    onSelect={(profile) => setSelectedProfile(profile)}
                  />
                )}
                <div className="grid grid-cols-2 gap-3 md:gap-6 lg:grid-cols-4 xl:grid-cols-5">
                  {profileList.map((profile) => {
                  const roommateUserId = profile.id;
                  const isOwnProfile = !!user && roommateUserId === user.id;
                  return (
                    <RoommateCard
                      key={profile.id}
                      profile={profile}
                      onClick={() => setSelectedProfile(profile)}
                      isOwnProfile={isOwnProfile}
                      match={scored?.get(profile.id)}
                      matchEmphasis={persona === 'underclassman' ? 'primary' : 'secondary'}
                      isFavorite={isSavedRoommate(profile.id)}
                      onToggleFavorite={(e) => {
                        e.stopPropagation();
                        if (!user) {
                          toast.error(t('roommates:browse.signInRequired'), { description: t('roommates:browse.signInToSave') });
                          navigate('/auth');
                          return;
                        }
                        toggleSavedRoommate(profile.id).catch(() => {
                          toast.error(t('roommates:browse.favoriteUpdateFailed'), {
                            description: t('roommates:browse.unableToSave'),
                          });
                        });
                      }}
                    />
                  );
                })}
                </div>
              </SneakPeekBlurWall>
            )}
          </>
        )}
        </div>

        <RoommateDetailModal
          profile={selectedProfile}
          open={!!selectedProfile}
          onClose={() => setSelectedProfile(null)}
          onMessage={handleMessageRoommate}
          match={selectedProfile ? scored?.get(selectedProfile.id) : undefined}
          isOwnProfile={
            !!selectedProfile && !!user && selectedProfile.id === user.id
          }
        />

        {isEditProfileModalOpen && user && (
          <EditProfile onClose={() => setIsEditProfileModalOpen(false)} />
        )}
      </PageContainer>
    </div>
  );
}
