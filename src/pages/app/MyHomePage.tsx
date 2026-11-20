import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/EmptyState';
import { HomePageSkeleton, ListingTileSkeleton } from '@/components/skeletons/ContentSkeletons';
import { PullToRefreshIndicator } from '@/components/ui/pull-to-refresh-indicator';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { Capacitor } from '@capacitor/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { LayoutGrid, Loader2, ShoppingBag } from 'lucide-react';
import { parseIsoDateLocal } from '@/lib/dateUtils';
import { formatSubleaseRange } from '@/lib/subleases';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useUniversity } from '@/contexts/UniversityContext';
import { useAnalytics } from '@/hooks/useAnalytics';
import { useDorms } from '@/hooks/useDorms';
import { useChecklist } from '@/hooks/useChecklist';
import { useIsMobile } from '@/hooks/use-mobile';
import { supabase } from '@/integrations/supabase/client';
import { useBlockedUserIds } from '@/hooks/useBlockedUsers';
import { withListingContacts } from '@/lib/marketplaceContact';
import { Button } from '@/components/ui/button';
import { ListingDetailModal } from '@/components/dorm-portal/ListingDetailModalLazy';
import type { MarketplaceListing } from '@/components/dorm-portal/MarketplaceTab';
import { cn } from '@/lib/utils';
import { escapeLikePattern, safeImageSrc } from '@/lib/sanitize';
import { MyHomeCustomizeCanvas } from '@/components/my-home/MyHomeCustomizeCanvas';
import { WidgetCard } from '@/components/my-home/WidgetCard';
import {
  SectionHeading,
  WIDGET_EMPTY_CTA,
  WIDGET_FOOTER_LINK,
} from '@/components/my-home/cardSystem';
import { MessagesPreviewTile } from '@/components/my-home/MessagesPreviewTile';
import { useNotifications } from '@/hooks/useNotifications';
import { useModalOverlay } from '@/contexts/ModalOverlayContext';
import { RecentActivityWidget } from '@/components/my-home/RecentActivityWidget';
import { SavedHomeBand } from '@/components/my-home/SavedHomeBand';
import { YourDormWidget } from '@/components/my-home/YourDormWidget';
import { GettingAroundWidget } from '@/components/my-home/GettingAroundWidget';
import { YourListingsWidget } from '@/components/my-home/YourListingsWidget';
import { YourRoommatePostWidget } from '@/components/my-home/YourRoommatePostWidget';
import {
  MyHousingEditorDialog,
  type HousingProfileSnapshot,
} from '@/components/my-home/MyHousingEditorDialog';
import type { Dorm } from '@/types';
import { useCurrentUserBuilding } from '@/hooks/useCurrentUserBuilding';
import { useSavedDorms } from '@/hooks/useSavedDorms';
import { useSavedRoommates } from '@/hooks/useSavedRoommates';
import type { Json } from '@/integrations/supabase/types';
import {
  DEFAULT_MY_HOME_WIDGET_ORDER,
  ESSENTIAL_MY_HOME_WIDGET_IDS,
  mergeEffectiveHomeLayout,
  parseHomeLayout,
  updateHomeLayout,
  MY_HOME_USER_SIZE_SPAN_CLASS,
  MY_HOME_CARD_DESKTOP_HEIGHT,
  effectiveUserSize,
  type MyHomeWidgetId,
  type MyHomeSizeMap,
  type MyHomeUserSize,
} from '@/lib/myHomeLayout';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { useRoommateGroup } from '@/hooks/useRoommateGroup';
import { deriveSetupSteps } from '@/lib/setupSteps';
import { HomeHero } from '@/components/my-home/HomeHero';
import { JourneyStrip, type JourneyStripStep } from '@/components/my-home/JourneyStrip';
import { GlanceRow } from '@/components/my-home/GlanceRow';
import { QuickLinksRow } from '@/components/my-home/QuickLinksRow';
import { ScheduleWidget } from '@/components/my-home/ScheduleWidget';
import { CampusLiveWidget } from '@/components/pitt/CampusLiveWidget';
import { DesktopCalendarRail } from '@/components/my-home/DesktopCalendarRail';
import { finaleCelebration } from '@/lib/celebrate';
import { format } from 'date-fns';
import { useChat } from '@/contexts/ChatContext';

function isMyHomeWidgetFlagEnabled(
  id: MyHomeWidgetId,
  flags: Pick<
    ReturnType<typeof useFeatureFlags>,
    'showHousing' | 'showRoommates' | 'showConfirmedRoommates' | 'showSchedule' | 'showCampusLive'
  >,
): boolean {
  switch (id) {
    case 'your_dorm':
      // Always available so any student can set / see where they live, even in Phase 1.
      return true;
    case 'campus_live':
      // Same rule as Schedule: My Home must not advertise a surface a school
      // has switched off, even though the route stays reachable by direct link.
      return flags.showCampusLive;
    case 'schedule':
      // Nothing on My Home may advertise Schedule while a school has it off,
      // even though the /schedule route stays reachable by direct link.
      return flags.showSchedule;
    case 'activity_feed':
      return flags.showHousing;
    case 'roommate_group':
      return flags.showConfirmedRoommates;
    case 'roommate_matches':
    case 'your_roommate_post':
      return flags.showRoommates;
    default:
      return true;
  }
}

const SESSION_VIEW_KEY = 'dormcheck_my_home_viewed';


interface MyHomeWidgetEntry {
  id: MyHomeWidgetId;
  essential: boolean;
  canRender?: () => boolean;
  render: () => ReactNode;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  current_dorm: string | null;
  current_floor: string | null;
  current_room: string | null;
  housing_type: string | null;
  neighborhood: string | null;
  is_roommate_searching: boolean | null;
  has_completed_onboarding: boolean | null;
  avatar_url: string | null;
  home_layout: Json | null;
  grade_level: string | null;
  show_in_building: boolean | null;
  move_in_date: string | null;
}

function firstName(fullName: string | null | undefined): string {
  const raw = (fullName ?? '').trim();
  if (!raw) return 'there';
  return raw.split(/\s+/)[0];
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Motion + greeting helpers                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

const STAGGER_PARENT: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

const STAGGER_CHILD: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
};

/* ────────────────────────────────────────────────────────────────────────── */
/*  Greeting + customize controls                                            */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Official Pitt move-in WINDOWS (source: Pitt Housing, updated 2026-05-28). Used
 * as the countdown target until a dorm's exact assigned date is published (which
 * overrides this). Pitt assigns exact per-building/floor dates within these
 * windows later. Update annually - dates are subject to change.
 */
const PITT_MOVE_IN_2026 = {
  firstYear: { start: '2026-08-15', end: '2026-08-16', range: 'Aug 15–16 · first-years' },
  upperclass: { start: '2026-08-21', end: '2026-08-22', range: 'Aug 21–22 · upperclass' },
  general: { start: '2026-08-15', end: '2026-08-22', range: 'Aug 15–22' },
} as const;

/** Resolve the countdown target: a published exact date wins; otherwise the
 *  class-appropriate window (first-year vs upperclass) from `gradeLevel`. */
function resolveMoveInTarget(
  exactDate: string | null | undefined,
  gradeLevel: string | null | undefined,
  universitySlug: string,
): { iso: string | null; endIso: string | null; range: string | null } {
  const exact = exactDate?.trim();
  if (exact) return { iso: exact, endIso: exact, range: null };
  // The window fallback is Pitt's published schedule - other tenants show the
  // "coming soon" countdown state until their exact date is in the dorm data.
  if (universitySlug !== 'pitt') return { iso: null, endIso: null, range: null };
  const g = (gradeLevel ?? '').toLowerCase();
  const win = /fresh|first.?year|incoming|new student/.test(g)
    ? PITT_MOVE_IN_2026.firstYear
    : /soph|junior|senior|upper|grad|return|transfer/.test(g)
      ? PITT_MOVE_IN_2026.upperclass
      : PITT_MOVE_IN_2026.general;
  return { iso: win.start, endIso: win.end, range: win.range };
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Widget: Marketplace for {dorm}                                           */
/* ────────────────────────────────────────────────────────────────────────── */

const LISTING_SELECT =
  'id, user_id, title, description, price, category, image_urls, created_at, status, condition, meetup_location, show_instagram, show_snapchat, show_phone, is_sublease, sublease_start, sublease_end, building_name, included_utilities, is_furnished, has_parking, gender_preference, house_rules, additional_rules, profiles:public_profiles(full_name)';

function MarketplaceForDormWidget({
  dormName,
  userId,
}: {
  dormName: string | null;
  userId: string;
}) {
  const { t } = useTranslation();
  const { university } = useUniversity();
  const [openListing, setOpenListing] = useState<MarketplaceListing | null>(null);
  // App Store 1.2: blocked sellers must not surface in the dorm band either.
  const { blockedUserIds } = useBlockedUserIds();

  const { data: listings = [], isLoading } = useQuery({
    queryKey: ['my-home-marketplace', (dormName ?? '').toLowerCase(), blockedUserIds.size],
    queryFn: async (): Promise<MarketplaceListing[]> => {
      const needle = (dormName ?? '').trim();
      // Dorm match happens SERVER-side now (design-audit A-10). This used to
      // fetch the 50 newest listings and substring-match `meetup_location` in
      // the client, which silently rendered the empty state whenever a dorm's
      // listings were all older than the newest 50 platform-wide — the exact
      // case a returning student in a quiet building hits. The old comment
      // cited PostgREST `.or()` escaping as the reason; a single `.ilike()`
      // needs no `.or()`, and escaping only requires neutralising the LIKE
      // metacharacters below.
      let query = supabase
        .from('marketplace_listings')
        .select(LISTING_SELECT)
        // No post-type filter: this band is "what's happening in my building",
        // and a sublease in your own building is the single most relevant thing
        // it can show. The verified-lister gate lives on the WRITE path
        // (migration 20260907000000) — browsing is open to any signed-in student
        // by decision (vault `08 - Decisions Log`, 2026-08-05).
        .eq('status', 'available');
      if (needle) {
        // `%` and `_` are LIKE wildcards; a dorm called "Sutherland_East" must
        // not match "SutherlandXEast". Escaping lives in sanitize.ts so it is
        // unit-testable — it is the part of this change most likely to regress
        // silently, since a broken escape still returns plausible rows.
        query = query.ilike('meetup_location', `%${escapeLikePattern(needle)}%`);
      }
      // Over-fetch a little so blocked sellers can be removed without dropping
      // below the four tiles the band renders.
      const { data, error } = await query.order('created_at', { ascending: false }).limit(20);
      if (error) throw error;
      const rows = ((data ?? []) as unknown as MarketplaceListing[]).filter(
        (l) => !l.user_id || !blockedUserIds.has(l.user_id),
      );
      // Seller contact comes from the opt-out-masked view (SEC-6), merged by id.
      return withListingContacts(rows.slice(0, 4));
    },
    enabled: true,
  });

  const titleSuffix = dormName ? ` for ${dormName}` : '';

  return (
    <WidgetCard
      title={`Marketplace${titleSuffix}`}
      icon={<ShoppingBag className="w-4 h-4" />}
      tint="amber"
    >
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* A-14 + tell 4: the whole tile (border, square well, title and
              price lines), not just the well, so the band does not grow when
              the text arrives. */}
          {[0, 1, 2, 3].map((i) => (
            <ListingTileSkeleton key={i} />
          ))}
        </div>
      ) : listings.length === 0 ? (
        <EmptyState
          className="flex-1 py-6 lg:min-h-[180px]"
          icon={ShoppingBag}
          title={t('marketplace:homeBand.emptyTitle', { school: university.shortName })}
          description={t('marketplace:homeBand.emptyBody')}
          action={
            <Link to="/marketplace" className={cn('self-center', WIDGET_EMPTY_CTA)}>
              {t('marketplace:homeBand.postListing')}
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {listings.map((l) => {
              const img =
                safeImageSrc(l.image_urls?.[0] ?? '') ??
                safeImageSrc(l.image_url ?? '') ??
                '/placeholder.svg';
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setOpenListing(l)}
                  className="group rounded-card border border-border bg-card overflow-hidden text-left transition-shadow hover:shadow-raised"
                >
                  <div className="aspect-square w-full overflow-hidden bg-muted">
                    <img
                      src={img}
                      alt={l.title}
                      className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                      loading="lazy"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = '/placeholder.svg';
                      }}
                    />
                  </div>
                  {/* A-8: price outranks the title. Both were text-xs and
                      differed only by font-weight, so the attribute students
                      actually scan for had no rank. */}
                  <div className="p-2">
                    <div className="truncate text-xs text-muted-foreground">{l.title}</div>
                    <div className="text-sm font-semibold tabular-nums text-foreground">
                      {formatPrice(l.price)}
                    </div>
                    {/* A rent figure with no term reads as a purchase price, so a
                        sublease card states its dates. Structured columns only —
                        house_rules never surfaces on a card. */}
                    {l.is_sublease && (
                      <div className="truncate text-[11px] text-muted-foreground">
                        {formatSubleaseRange(l.sublease_start, l.sublease_end)}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <Link to="/marketplace" className={cn('mt-4 self-start', WIDGET_FOOTER_LINK)}>
            View all
            <span aria-hidden="true"> →</span>
          </Link>
        </>
      )}

      <ListingDetailModal
        listing={openListing}
        open={!!openListing}
        onClose={() => setOpenListing(null)}
        isOwnListing={openListing?.user_id === userId}
        isLoggedIn={!!userId}
      />
    </WidgetCard>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Desktop bento header - stat tiles                                        */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Donezo-style stat tile: label on top, big number, muted footnote. Every tile
 * is a uniform flat neutral card — numbers read via size/weight, not colour
 * (Phase 1.7 subtractive). Desktop (lg+) only - mobile keeps the hero/glance
 * layout, which this row replaces on the big screen.
 */
function DesktopStatTile({
  to,
  label,
  value,
  sub,
}: {
  to: string;
  label: string;
  value: ReactNode;
  sub: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'group relative flex min-h-[136px] min-w-0 flex-col justify-between rounded-card border border-border bg-card p-5 shadow-flat transition-shadow hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-2',
        // Every tile is a uniform flat neutral card — no green outline, fill, or
        // number. Emphasis comes from the number's size/weight (Phase 1.7).
      )}
    >
      <div className="flex items-start gap-2">
        <span className="text-sm font-bold text-foreground">{label}</span>
      </div>
      <div>
        <div
          className={cn(
            'font-display text-[34px] font-extrabold leading-none tabular-nums text-foreground',
          )}
        >
          {value}
        </div>
        <div className="mt-1.5 truncate text-xs font-semibold text-muted-foreground">
          {sub}
        </div>
      </div>
    </Link>
  );
}

function DesktopStatRow({
  setupDone,
  setupTotal,
  allDone,
  setupHref,
  checklist,
  unread,
}: {
  setupDone: number;
  setupTotal: number;
  allDone: boolean;
  setupHref: string;
  checklist: { packed: number; total: number; pct: number; nextItem: string | null };
  unread: number;
}) {
  return (
    <div className="hidden gap-4 lg:grid lg:grid-cols-3">
      <DesktopStatTile
        to={setupHref}
        label="Setup"
        value={`${setupDone}/${setupTotal}`}
        sub={allDone ? 'all set - nice work' : 'steps done · finish setup'}
      />
      <DesktopStatTile
        to="/checklist"
        label="Checklist"
        value={`${checklist.packed}/${checklist.total}`}
        sub={
          checklist.nextItem
            ? `${checklist.pct}% packed · next: ${checklist.nextItem}`
            : `${checklist.pct}% packed`
        }
      />
      <DesktopStatTile
        to="/messages"
        label="Messages"
        value={unread}
        sub={unread === 1 ? 'unread conversation' : 'unread conversations'}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Page                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export default function MyHomePage() {
  const { user, isLoading: authLoading } = useAuth();
  const { university } = useUniversity();
  const {
    showHousing,
    showRoommates,
    showConfirmedRoommates,
    showSchedule,
    showCampusLive,
    showBuildingChats,
    showSavedDorms,
  } = useFeatureFlags();
  const widgetFlags = useMemo(
    () => ({ showHousing, showRoommates, showConfirmedRoommates, showSchedule, showCampusLive }),
    [showHousing, showRoommates, showConfirmedRoommates, showSchedule, showCampusLive],
  );
  const { dorms, isLoading: dormsLoading } = useDorms();
  const setHideTopNav = useModalOverlay()?.setHideTopNav;
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [housingEditorOpen, setHousingEditorOpen] = useState(false);
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [isSavingLayout, setIsSavingLayout] = useState(false);
  const [workingOrder, setWorkingOrder] = useState<MyHomeWidgetId[]>(DEFAULT_MY_HOME_WIDGET_ORDER);
  const [workingHidden, setWorkingHidden] = useState<MyHomeWidgetId[]>([]);
  const [workingSizes, setWorkingSizes] = useState<MyHomeSizeMap>({});

  // While customizing, hide the top-nav pill so the Cancel/Done bar (top-right of the
  // customize header) isn't overlapped by it. Restored on exit / unmount.
  useEffect(() => {
    setHideTopNav?.(isCustomizing);
    return () => setHideTopNav?.(false);
  }, [isCustomizing, setHideTopNav]);
  const { track } = useAnalytics();
  const { unreadCount } = useChat();
  const reduceMotion = useReducedMotion();
  const isMobile = useIsMobile();
  const {
    items: checklistItems,
    totalItems,
    packedItems,
    loading: checklistLoading,
  } = useChecklist(null);
  const trackedRef = useRef(false);
  const queryClient = useQueryClient();

  const {
    data: profile,
    isLoading: profileLoading,
    refetch: refetchProfile,
  } = useQuery({
    queryKey: ['my-home-profile', user?.id ?? ''],
    queryFn: async (): Promise<ProfileRow | null> => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select(
          'id, full_name, current_dorm, current_floor, current_room, housing_type, neighborhood, is_roommate_searching, has_completed_onboarding, avatar_url, home_layout, grade_level, show_in_building, move_in_date',
        )
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ProfileRow | null;
    },
    enabled: !!user?.id,
  });

  const currentDorm = useMemo<Dorm | null>(() => {
    const name = (profile?.current_dorm ?? '').trim();
    if (!name) return null;
    const lower = name.toLowerCase();
    const exact = dorms.find((d) => d.name.trim().toLowerCase() === lower);
    if (exact) return exact;
    // Building units (e.g. "Bouquet Gardens A/B/C/D") share one dorm record - match on
    // the base name with a trailing single-letter unit suffix stripped, so every unit
    // shows the preview even if only one variant is on file.
    const stripUnit = (s: string) => s.trim().toLowerCase().replace(/\s+[a-z]$/i, '').trim();
    const base = stripUnit(name);
    return dorms.find((d) => stripUnit(d.name) === base) ?? null;
  }, [dorms, profile?.current_dorm]);

  const hasMoveInDate = !!(profile?.move_in_date || currentDorm?.moveInDate);
  const checklistPct = totalItems === 0 ? 0 : Math.round((packedItems / totalItems) * 100);

  // The next few still-unpacked items, surfaced on the hero tile for one-tap packing.
  const nextChecklistItems = useMemo(
    () =>
      checklistItems
        .filter((i) => (i.status ?? (i.is_checked ? 'packed' : 'need')) !== 'packed')
        .slice(0, 3)
        .map((i) => ({ id: i.id, name: i.item, status: i.status })),
    [checklistItems],
  );

  const { building: myBuilding } = useCurrentUserBuilding();
  const { roommateGroup, isLoading: roommateGroupLoading } = useRoommateGroup(user?.id);
  const { savedDormIds, isLoading: savedDormsLoading } = useSavedDorms();
  const { savedIds: savedRoommateIds } = useSavedRoommates(user?.id);
  const { notifications: homeNotifications } = useNotifications();

  const userId = user?.id ?? '';

  const { data: hasRoommatePosts, isLoading: roommatePostsProbeLoading } = useQuery({
    queryKey: ['my-home-has-roommate-posts', userId],
    queryFn: async (): Promise<boolean> => {
      const { count, error } = await supabase
        .from('roommate_search_posts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
    enabled: !!userId,
  });

  const { data: savedItemsCount = 0, isLoading: savedItemsCountLoading } = useQuery({
    queryKey: ['saved_items', userId, 'count'],
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('saved_items')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!userId,
  });

  const housingSnapshot: HousingProfileSnapshot = useMemo(
    () => ({
      housing_type: profile?.housing_type ?? null,
      current_dorm: profile?.current_dorm ?? null,
      current_floor: profile?.current_floor ?? null,
      current_room: profile?.current_room ?? null,
      neighborhood: profile?.neighborhood ?? null,
    }),
    [profile],
  );

  // The building community (Community / People & Move-in) moved to its own page.
  // Old deep links (/my-home?dormTab=people) redirect there so bookmarks and the
  // setup card's "See your building" step keep working.
  useEffect(() => {
    if (!user?.id) return;
    const tab = searchParams.get('dormTab');
    if (tab !== 'people' && tab !== 'community') return;
    navigate(`/my-home/dorm?tab=${tab}`, { replace: true });
  }, [user?.id, searchParams, navigate]);

  useEffect(() => {
    if (!user?.id) return;
    if (searchParams.get('openHousing') !== 'true') return;
    setHousingEditorOpen(true);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('openHousing');
        return next;
      },
      { replace: true },
    );
  }, [user?.id, searchParams, setSearchParams]);

  useEffect(() => {
    if (trackedRef.current) return;
    if (authLoading || profileLoading || dormsLoading) return;
    if (!profile) return;
    try {
      if (sessionStorage.getItem(SESSION_VIEW_KEY) === '1') {
        trackedRef.current = true;
        return;
      }
      sessionStorage.setItem(SESSION_VIEW_KEY, '1');
    } catch {
      /* private mode */
    }
    trackedRef.current = true;
    track('my_home_viewed', {
      has_move_in_date: hasMoveInDate,
      checklist_completion_pct: checklistPct,
    });
  }, [authLoading, profileLoading, dormsLoading, profile, hasMoveInDate, checklistPct, track]);

  const dormName = useMemo(
    () => (profile?.current_dorm ?? '').trim(),
    [profile?.current_dorm],
  );

  // Move-in countdown target: exact assigned date if published, else the
  // class-appropriate official Pitt window.
  // The student's own saved date (set on the Move-In journey) beats the
  // dorm-level published date, which beats the class-wide window.
  const moveInTarget = useMemo(
    () =>
      resolveMoveInTarget(
        profile?.move_in_date ?? currentDorm?.moveInDate,
        profile?.grade_level,
        university.slug,
      ),
    [profile?.move_in_date, currentDorm?.moveInDate, profile?.grade_level, university.slug],
  );

  // The set of queries this dashboard owns. Defined once and shared by BOTH the
  // background auto-refresh below and the pull-to-refresh gesture, so the two can
  // never drift into refreshing different things.
  const isHomeQuery = useCallback(
    (key: unknown) =>
      typeof key === 'string' && (key.startsWith('my-home') || key === 'saved_items'),
    [],
  );

  // Background auto-refresh: silently refetch the home dashboard's data when the
  // app/tab returns to the foreground and on a gentle interval while it's open.
  // Scoped to the home queries (never the whole app) and paused while customizing
  // the layout or backgrounded.
  //
  // NOTE: this originally REPLACED a manual pull-to-refresh. Pull-to-refresh is
  // back (IPP-2) deliberately and additively — passive refresh does not cover the
  // case where a user has just changed something elsewhere and wants to force the
  // dashboard to catch up now. Both go through the same predicate.
  useEffect(() => {
    const refresh = () => {
      if (isCustomizing || document.hidden) return;
      void queryClient.invalidateQueries({
        predicate: (query) => isHomeQuery(query.queryKey[0]),
      });
    };
    const interval = window.setInterval(refresh, 120_000);
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [queryClient, isCustomizing, isHomeQuery]);

  // Pull-to-refresh over the SAME predicate. Uses the raw hook rather than the
  // root-key helper because this dashboard matches by `my-home` PREFIX, not by an
  // exact root segment. Disabled while customizing, exactly like the interval
  // refresh — a pull while dragging widgets would be a layout gesture, not a
  // refresh gesture.
  const { pull, refreshing } = usePullToRefresh(
    () =>
      queryClient.invalidateQueries({
        predicate: (query) => isHomeQuery(query.queryKey[0]),
      }),
    { enabled: !isCustomizing },
  );

  const savedLayout = useMemo(
    () => parseHomeLayout(profile?.home_layout),
    [profile?.home_layout],
  );

  const {
    order: effectiveWidgetOrder,
    hidden: hiddenWidgets,
    sizes: effectiveSizes,
  } = useMemo(() => mergeEffectiveHomeLayout(savedLayout), [savedLayout]);

  const canRenderRoommatePost = !roommatePostsProbeLoading && hasRoommatePosts === true;
  const savedProbeLoading =
    savedDormsLoading || savedItemsCountLoading;
  const canRenderSaved =
    !savedProbeLoading &&
    ((showSavedDorms && savedDormIds.size > 0) ||
      (showRoommates && savedRoommateIds.size > 0) ||
      savedItemsCount > 0);

  // "Finish setting up" signals, derived fresh each render (see setupSteps.ts).
  // Checklist counts as started only on engagement - every account is seeded
  // with starter items by handle_new_user_checklist(), so existence alone is
  // meaningless.
  const hasStartedChecklist = useMemo(
    () =>
      checklistItems.some(
        (i) => i.is_custom || (i.status ?? (i.is_checked ? 'packed' : 'need')) !== 'need',
      ),
    [checklistItems],
  );
  const setupSteps = useMemo(
    () =>
      deriveSetupSteps({
        hasDorm: !!(profile?.current_dorm ?? '').trim(),
        hasConfirmedRoommates: (roommateGroup?.members.length ?? 0) >= 2,
        hasStartedChecklist,
        showInBuilding: profile?.show_in_building === true,
      }),
    [profile?.current_dorm, profile?.show_in_building, roommateGroup, hasStartedChecklist],
  );
  const allSetupDone = setupSteps.every((s) => s.done);
  // Hero band CTA: the first unfinished setup step, else the checklist. Labels
  // are hero-specific (never reuse the setup-row strings, so no CTA appears
  // twice on the page), and the roommates step closes the "no roommates yet"
  // loop: browse Roommates when that surface is available, else invite.
  const nextBestAction = useMemo(() => {
    const next = setupSteps.find((s) => !s.done);
    if (!next) return { label: 'Open your checklist', href: '/checklist' };
    switch (next.id) {
      case 'dorm':
        return { label: 'Add your housing', href: next.href };
      case 'roommates':
        return showRoommates
          ? { label: 'Find your roommates', href: '/roommates' }
          : { label: 'Invite your roommates', href: next.href };
      case 'checklist':
        return { label: 'Pack your first item', href: next.href };
      case 'visibility':
        return { label: 'Show up in your building', href: next.href };
      default:
        return { label: 'Open your checklist', href: '/checklist' };
    }
  }, [setupSteps, showRoommates]);
  // Don't flash the card while its signals are still loading.
  const setupSignalsLoading = profileLoading || checklistLoading || roommateGroupLoading;

  const hasDorm = !!dormName;
  const setupDoneCount = setupSteps.filter((s) => s.done).length;

  // Journey card states: before the dorm is set only step 1 is actionable
  // (rest locked); once set, remaining steps open up and the first undone one
  // is "current".
  const journeySteps = useMemo((): JourneyStripStep[] => {
    const firstUndone = setupSteps.find((s) => !s.done)?.id ?? null;
    return setupSteps.map((s) => ({
      ...s,
      state: s.done
        ? 'done'
        : !hasDorm
          ? s.id === 'dorm'
            ? 'current'
            : 'locked'
          : s.id === firstUndone
            ? 'current'
            : 'available',
    }));
  }, [setupSteps, hasDorm]);

  const heroCta = useMemo(() => {
    if (allSetupDone) return { label: "See who's on your floor", href: '/my-home/dorm?tab=people' };
    if (setupDoneCount === 0) return { label: 'Start setup', href: '/my-home?openHousing=true' };
    return { label: 'Finish setup', href: nextBestAction.href };
  }, [allSetupDone, setupDoneCount, nextBestAction]);

  // "Aug 15–16" (window) or "Aug 15" (exact) - hero chip + finale banner copy.
  const moveInLabel = useMemo(() => {
    if (moveInTarget.range) return moveInTarget.range;
    const parsed = parseIsoDateLocal(moveInTarget.iso ?? null);
    return parsed ? format(parsed, 'MMM d') : null;
  }, [moveInTarget]);

  // ---- Fill-in transition + finale orchestration ----------------------------
  // `justFilledIn` flips true the moment the dorm is set *during this session*
  // (profile refetch flips hasDorm false→true). It only stretches animation
  // delays so the photo → step-check → unlock → glance sequence reads as one
  // motion; every component renders the same final state without it, so a
  // refresh shows the identical populated page.
  const [justFilledIn, setJustFilledIn] = useState(false);
  const prevHasDormRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (profileLoading) return;
    const prev = prevHasDormRef.current;
    prevHasDormRef.current = hasDorm;
    if (prev === false && hasDorm) setJustFilledIn(true);
  }, [profileLoading, hasDorm]);
  useEffect(() => {
    if (!justFilledIn) return;
    const t = setTimeout(() => setJustFilledIn(false), 1600);
    return () => clearTimeout(t);
  }, [justFilledIn]);

  // Finale: all four steps flipping done during the session rains confetti
  // (no-op under prefers-reduced-motion; never re-fires on a refresh).
  const prevAllDoneRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (setupSignalsLoading) return;
    const prev = prevAllDoneRef.current;
    prevAllDoneRef.current = allSetupDone;
    if (prev === false && allSetupDone) finaleCelebration();
  }, [setupSignalsLoading, allSetupDone]);

  const widgetRegistryById = useMemo((): Record<MyHomeWidgetId, MyHomeWidgetEntry> => {
    const entries: Record<MyHomeWidgetId, MyHomeWidgetEntry> = {
      setup_guide: {
        id: 'setup_guide',
        essential: false,
        // Superseded by the JourneyStrip rendered above the widget grid; the
        // entry stays so saved layouts holding 'setup_guide' keep resolving.
        canRender: () => false,
        render: () => null,
      },
      notifications: {
        id: 'notifications',
        essential: false,
        // Replaced by the compact Recent Activity section above the dashboard.
        canRender: () => false,
        render: () => null,
      },
      checklist: {
        id: 'checklist',
        essential: false,
        // Superseded by the hero countdown + GlanceRow checklist card.
        canRender: () => false,
        render: () => null,
      },
      schedule: {
        id: 'schedule',
        essential: false,
        render: () => <ScheduleWidget />,
      },
      campus_live: {
        id: 'campus_live',
        essential: false,
        render: () => <CampusLiveWidget residenceHall={profile?.current_dorm ?? null} />,
      },
      move_logistics: {
        id: 'move_logistics',
        essential: false,
        // Deferred for the current iteration; saved layouts remain compatible.
        canRender: () => false,
        render: () => null,
      },
      resources: {
        id: 'resources',
        essential: false,
        // Pitt Resources feature removed; entry stays so saved layouts holding
        // 'resources' keep resolving (retired via RETIRED_MY_HOME_WIDGET_IDS).
        canRender: () => false,
        render: () => null,
      },
      your_dorm: {
        id: 'your_dorm',
        essential: ESSENTIAL_MY_HOME_WIDGET_IDS.has('your_dorm'),
        render: () => (
          <YourDormWidget
            dorm={currentDorm}
            currentDormName={dormName || null}
            housing={housingSnapshot}
            loading={dormsLoading || profileLoading}
            onEditHousing={() => setHousingEditorOpen(true)}
            showRoommates={showRoommates}
            buildingId={myBuilding?.buildingId ?? null}
            showBuildingChats={showBuildingChats}
          />
        ),
      },
      getting_around: {
        id: 'getting_around',
        essential: false,
        render: () => (
          <GettingAroundWidget
            home={
              currentDorm &&
              typeof currentDorm.latitude === 'number' &&
              typeof currentDorm.longitude === 'number'
                ? {
                    name: currentDorm.name,
                    lat: currentDorm.latitude,
                    lng: currentDorm.longitude,
                  }
                : null
            }
            universitySlug={university.slug}
            onSetHome={() => setHousingEditorOpen(true)}
          />
        ),
      },
      roommate_group: {
        id: 'roommate_group',
        essential: false,
        // Superseded by the GlanceRow roommates card (group, unread, chat link).
        canRender: () => false,
        render: () => null,
      },
      roommate_matches: {
        id: 'roommate_matches',
        essential: false,
        // Superseded by the GlanceRow roommates card's "Find your people" state.
        canRender: () => false,
        render: () => null,
      },
      marketplace_dorm: {
        id: 'marketplace_dorm',
        essential: false,
        render: () => (
          <MarketplaceForDormWidget dormName={dormName || null} userId={userId} />
        ),
      },
      messages: {
        id: 'messages',
        essential: ESSENTIAL_MY_HOME_WIDGET_IDS.has('messages'),
        render: () => <MessagesPreviewTile userId={userId} />,
      },
      your_roommate_post: {
        id: 'your_roommate_post',
        essential: false,
        canRender: () => canRenderRoommatePost,
        render: () => <YourRoommatePostWidget userId={userId} />,
      },
      your_listings: {
        id: 'your_listings',
        essential: false,
        render: () => <YourListingsWidget userId={userId} />,
      },
      saved: {
        id: 'saved',
        essential: false,
        canRender: () => canRenderSaved,
        render: () => (
          <SavedHomeBand
            userId={userId}
            showSavedDorms={showSavedDorms}
            showSavedRoommates={showRoommates}
            showTitle={false}
          />
        ),
      },
      activity_feed: {
        id: 'activity_feed',
        essential: false,
        // Replaced by personal Recent Activity above the dashboard.
        canRender: () => false,
        render: () => null,
      },
    };

    return entries;
  }, [
    myBuilding,
    canRenderRoommatePost,
    canRenderSaved,
    userId,
    currentDorm,
    university.slug,
    dormName,
    housingSnapshot,
    dormsLoading,
    profileLoading,
    showBuildingChats,
    showSavedDorms,
    showRoommates,
  ]);

  const visibleWidgets = useMemo(() => {
    return effectiveWidgetOrder
      .map((id) => widgetRegistryById[id])
      .filter((widget): widget is MyHomeWidgetEntry => {
        if (!widget) return false;
        if (!isMyHomeWidgetFlagEnabled(widget.id, widgetFlags)) return false;
        if (hiddenWidgets.has(widget.id) && !widget.essential) return false;
        if (widget.canRender && !widget.canRender()) return false;
        return true;
      });
  }, [effectiveWidgetOrder, hiddenWidgets, widgetRegistryById, widgetFlags]);

  // Two-size bento: every widget spans one column (small) or the full two-column
  // row (large), from its effective user size - identical on mobile and desktop.
  // The grid's `grid-flow-row-dense` packs adjacent smalls and backfills holes,
  // so the user's wide/small choices lay out cleanly. One size map + one order =
  // exactly what the customize screen controls.
  const widgetSpanClasses = useMemo(
    () =>
      visibleWidgets.map(
        (widget) => MY_HOME_USER_SIZE_SPAN_CLASS[effectiveUserSize(widget.id, effectiveSizes)],
      ),
    [visibleWidgets, effectiveSizes],
  );

  const startCustomize = useCallback(() => {
    setWorkingOrder(
      effectiveWidgetOrder.filter((id) => isMyHomeWidgetFlagEnabled(id, widgetFlags)),
    );
    setWorkingHidden(Array.from(hiddenWidgets));
    setWorkingSizes({ ...effectiveSizes });
    setIsCustomizing(true);
  }, [effectiveWidgetOrder, hiddenWidgets, effectiveSizes, widgetFlags]);

  const clearCustomizeParam = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('customize');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const cancelCustomize = useCallback(() => {
    setIsCustomizing(false);
    clearCustomizeParam();
  }, [clearCustomizeParam]);

  // The bottom-nav action button toggles customize mode via ?customize=1 - keep
  // isCustomizing mirrored to the param so tapping the button again closes it.
  useEffect(() => {
    const wantsCustomize = searchParams.get('customize') === '1';
    if (wantsCustomize && !isCustomizing) {
      startCustomize();
    } else if (!wantsCustomize && isCustomizing && !isSavingLayout) {
      setIsCustomizing(false);
    }
  }, [searchParams, isCustomizing, isSavingLayout, startCustomize]);

  // Apply a wide/small choice to the working draft. Natural default drops out of
  // the map (only real overrides are persisted, matching sanitizeSizeMap).
  const handleSizeChange = useCallback((id: MyHomeWidgetId, size: MyHomeUserSize) => {
    setWorkingSizes((prev) => ({ ...prev, [id]: size }));
  }, []);

  // Desktop web edits in place on the real grid; mobile / native use the list.
  const openCustomize = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('customize', '1');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const saveCustomize = useCallback(async () => {
    setIsSavingLayout(true);
    try {
      await updateHomeLayout(queryClient, {
        order: workingOrder,
        hidden: workingHidden,
        sizes: workingSizes,
      });
      setIsCustomizing(false);
      clearCustomizeParam();
      toast.success('Home layout saved');
    } catch (err) {
      console.error('[MyHome] save layout failed:', err);
      toast.error('Could not save layout', { description: 'Please try again.' });
    } finally {
      setIsSavingLayout(false);
    }
  }, [queryClient, workingOrder, workingHidden, workingSizes, clearCustomizeParam]);

  // Hold the skeleton until the setup signals land too (checklist + roommate
  // group, not just the profile). RecentActivityWidget and JourneyStrip wait on
  // them, and mounting one frame after the column painted pushed everything
  // below down ~487px: CLS 0.46-0.49 on phones, on /my-home and on every sheet
  // over it (/settings, ⌘K). Swapping skeleton → final layout once is not a
  // shift; inserting above painted content is.
  if (authLoading || setupSignalsLoading) {
    return (
      <HomePageSkeleton />
    );
  }

  if (!user) {
    // Defensive - ProtectedRoute should already handle this.
    return <Navigate to="/auth" replace />;
  }

  // Redirect ONLY on a profile we actually read whose flag is explicitly false.
  //
  // This used to be `!profile?.has_completed_onboarding`, which fires on three
  // very different states: the flag is false, the query errored (`undefined`),
  // and the query returned no row (`null`). The last two mean "we could not read
  // your profile", and treating them as "you have not onboarded" is what made
  // this page bounce to onboarding on every visit and never stop: RLS on
  // `profiles` is `id = auth.uid()`, so a read on a stale or still-refreshing
  // token returns zero rows and NO error, onboarding then re-writes a flag that
  // was already true, sends you back here, and the read fails again.
  //
  // Every user who can sign in has a profile row (the 10 prod users without one
  // are unconfirmed and have never signed in), so a missing row is a failed read,
  // not a new account. `isProfileError` renders a retry instead of a silent
  // half-empty dashboard.
  //
  // `!== true` rather than `=== false`: the column is nullable with a `false`
  // default, so a null must still route to onboarding. The distinction that
  // matters is whether we read a ROW, not which falsy value the flag holds.
  if (profile && profile.has_completed_onboarding !== true) {
    return <Navigate to="/onboarding/intro" replace />;
  }

  // Past the loading guard with no profile means the read failed: `undefined`
  // from an errored query, `null` from a query that succeeded but returned no
  // row (the RLS/stale-token case). Neither is a state this page can render
  // honestly, and neither is grounds for sending anyone to onboarding.
  if (!profile) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm font-medium text-foreground">We could not load your profile.</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          This is usually a connection hiccup. Your data is safe.
        </p>
        <Button variant="outline" onClick={() => void refetchProfile()}>
          Try again
        </Button>
      </div>
    );
  }

  const isNative = Capacitor.isNativePlatform();

  return (
    // On web the shell always offsets `main` by pt-12 (the chromeless 48px top
    // strip); -mt-12 cancels it so the canvas reaches the viewport top and the
    // transparent top-bar pill floats over it. Native skips that main offset
    // (My Home is a scroll-away-title route), so no -mt-12 there. The container
    // below re-pads so content clears the pill on every surface.
    <div
      className={cn(
        // Page background stays plain white/token — the gloss lives on the
        // left dashboard column below, not the whole viewport.
        'relative overflow-hidden bg-background',
        isNative ? 'min-h-[60vh]' : '-mt-12 min-h-[calc(60vh+3rem)]',
      )}
    >
      <PullToRefreshIndicator pull={pull} refreshing={refreshing} />
      <div
        className={cn(
          // `body` already pads by env(safe-area-inset-top) (index.css). On
          // mobile/native the "Hey {name}" greeting now shares the top band with
          // the floating avatar/notifications pill — greeting left, pill right —
          // so we pull the stack up (the greeting reserves right space via its
          // own `pe-28`). Desktop keeps the larger clearance for its taller
          // top-right cluster.
          // lg widens past the old max-w-6xl and the bento shell below carries
          // the visual frame, so the page fills the desktop viewport instead of
          // floating in side white space.
          'mx-auto w-full max-w-6xl lg:max-w-[1440px] px-3 sm:px-6 lg:px-8 pb-16 space-y-6 pt-3 sm:pt-4 lg:pt-20',
        )}
      >
        {/* One framed bento shell, always rendered. Customizing edits IN PLACE:
            only the dashboard grid below swaps to the drag/resize canvas while
            the header, stat row, journey and calendar rail stay put — so you
            edit exactly where the widgets live, not on a separate page. Desktop
            (lg+) is the framed shell; below lg the shell/grid classes are inert
            and the mobile/iOS layout is byte-identical. */}
        <div
          className={cn(
            'lg:grid lg:items-stretch lg:rounded-3xl lg:border lg:border-border/50 lg:bg-card lg:shadow-[0_24px_70px_-30px_rgba(15,23,42,0.35)]',
            // The right column IS the calendar rail. With Schedule off there is
            // no rail, so the shell collapses to one column rather than
            // reserving 340px of empty card.
            showSchedule
              ? 'lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_360px]'
              : 'lg:grid-cols-1 lg:overflow-hidden',
          )}
        >
          <div
            className={cn(
              'min-w-0 space-y-6 lg:bg-page lg:p-6 xl:p-8',
              // With the rail, this column rounds its own left edge and butts up
              // against the rail on the right. Without it, the column spans the
              // shell, so the shell's own rounding + clip does the work.
              showSchedule && 'lg:rounded-l-[calc(1.5rem-1px)]',
            )}
          >
            {/* Bento header - replaces the mobile hero greeting on desktop.
                Just the welcome now; the Customize control moved down to the
                "Your dashboard" row (where the editing actually happens). */}
            <div className="hidden lg:block">
              <h1 className="font-display text-2xl font-extrabold text-foreground">
                Welcome {firstName(profile.full_name)}
              </h1>
            </div>

            <DesktopStatRow
              setupDone={setupDoneCount}
              setupTotal={setupSteps.length}
              allDone={allSetupDone}
              setupHref={heroCta.href}
              checklist={{
                packed: packedItems,
                total: totalItems,
                pct: checklistPct,
                nextItem: nextChecklistItems[0]?.name ?? null,
              }}
              unread={unreadCount}
            />

            <div className="lg:hidden">
            <HomeHero
              firstName={firstName(profile.full_name)}
            />
            </div>

            <RecentActivityWidget
              notifications={homeNotifications}
              unreadMessages={unreadCount}
              packedItems={packedItems}
              totalItems={totalItems}
              hasChecklistActivity={hasStartedChecklist}
              checklistLoading={checklistLoading}
            />

            {!setupSignalsLoading && (
              <JourneyStrip
                steps={journeySteps}
                allDone={allSetupDone}
                moveInLabel={moveInLabel}
                popDelayMs={justFilledIn ? 450 : 0}
              />
            )}

            {/* Replaced by the stat-tile row on lg+. */}
            <div className="lg:hidden">
            <GlanceRow
              populated={hasDorm || setupDoneCount > 0}
              checklist={{
                packed: packedItems,
                total: totalItems,
                pct: checklistPct,
                nextItem: nextChecklistItems[0]?.name ?? null,
              }}
              roommates={{ members: roommateGroup?.members ?? [], unread: unreadCount }}
              showRoommates={showRoommates}
              onSetDorm={() => setHousingEditorOpen(true)}
              entranceDelay={justFilledIn ? 0.56 : 0}
            />
            </div>

            {/* Mobile-web launcher row (Roommates / Move-in / Sell).
                Hidden on lg+ where the left sidebar already links these, and on
                the native iOS shell where the ⊞ bottom-nav menu already does —
                so the row only shows on responsive mobile web. */}
            {!isNative && (
              <div className="lg:hidden">
                <QuickLinksRow showRoommates={showRoommates} showSchedule={showSchedule} />
              </div>
            )}

            {/* Tablet-width web (md, no bottom nav, below the lg bento header)
                still needs a way INTO customize; lg+ has it in the dashboard
                row below. Hidden while customizing (the row's Cancel/Done takes
                over on every width). */}
            {!isMobile && !isNative && !isCustomizing && (
              <div className="flex justify-end lg:hidden">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={openCustomize}
                  className="gap-1.5"
                >
                  <LayoutGrid className="h-4 w-4" aria-hidden />
                  Customize home
                </Button>
              </div>
            )}

            {/* Dashboard section header. Right slot carries the Customize entry
                (desktop) or, while editing, the Cancel/Done controls. When
                customizing the row shows on every width so there's always a
                visible way to finish; otherwise it's desktop-only. */}
            <SectionHeading
              title="Your dashboard"
              className={cn('lg:-mb-3', isCustomizing ? 'flex' : 'hidden lg:flex')}
              trailing={
                isCustomizing ? (
                  <span className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={cancelCustomize}
                      disabled={isSavingLayout}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="bg-malachite-800 hover:bg-malachite-900 text-white"
                      onClick={saveCustomize}
                      disabled={isSavingLayout}
                    >
                      {isSavingLayout ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        'Done'
                      )}
                    </Button>
                  </span>
                ) : !isNative ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={openCustomize}
                    className="gap-1.5"
                  >
                    <LayoutGrid className="h-4 w-4" aria-hidden />
                    Customize home
                  </Button>
                ) : null
              }
            />

            {isCustomizing ? (
              // Edit in place — the real widget cards, drag/resize/hide, sitting
              // exactly where they live on the dashboard (same grid, same frame).
              <MyHomeCustomizeCanvas
                order={workingOrder}
                hidden={workingHidden}
                sizes={workingSizes}
                widgets={widgetRegistryById}
                allowResize={!isMobile && !isNative}
                onOrderChange={setWorkingOrder}
                onHiddenChange={setWorkingHidden}
                onSizeChange={handleSizeChange}
              />
            ) : (
              <motion.div
                variants={reduceMotion ? undefined : STAGGER_PARENT}
                initial={reduceMotion ? false : 'hidden'}
                animate="visible"
                className="grid grid-cols-1 gap-4 md:grid-flow-row-dense md:grid-cols-2 md:gap-6"
              >
                {visibleWidgets.map((widget, index) => (
                  <motion.div
                    key={widget.id}
                    id={`myhome-widget-${widget.id}`}
                    variants={reduceMotion ? undefined : STAGGER_CHILD}
                    layout={!reduceMotion}
                    // Uniform desktop card height + clip so every tile matches; the
                    // widget child fills the tile. Mobile stays content-height.
                    className={cn(
                      'min-w-0',
                      MY_HOME_CARD_DESKTOP_HEIGHT,
                      'md:overflow-hidden md:[&>*]:h-full',
                      // On lg+ the DesktopCalendarRail supersedes the small
                      // schedule tile; grid-flow-row-dense backfills the hole.
                      widget.id === 'schedule' && 'lg:hidden',
                      widgetSpanClasses[index],
                    )}
                  >
                    {widget.render()}
                  </motion.div>
                ))}
              </motion.div>
            )}
          </div>

          {/* Right column: full calendar rail (desktop only) - replaces the
              small Class-schedule bento tile, which is lg:hidden above. The
              wrapper is the Dstudio-style white pane: full-height card surface
              split from the gray dashboard by a hairline divider. */}
          {showSchedule && (
            <div className="hidden min-w-0 lg:block lg:rounded-r-[calc(1.5rem-1px)] lg:border-l lg:border-border/50 lg:bg-card">
              <DesktopCalendarRail
                moveInRange={
                  moveInTarget.iso
                    ? { start: moveInTarget.iso, end: moveInTarget.endIso ?? moveInTarget.iso }
                    : null
                }
              />
            </div>
          )}
          </div>
      </div>

      {/* Housing editor is mounted page-level (not inside the feature-gated dorm
          widget) so any student - including non-admins in Phase 1 - can set their
          on-campus housing from here or via /my-home?openHousing=true. */}
      <MyHousingEditorDialog
        userId={userId}
        open={housingEditorOpen}
        onOpenChange={setHousingEditorOpen}
        profile={housingSnapshot}
      />
    </div>
  );
}
