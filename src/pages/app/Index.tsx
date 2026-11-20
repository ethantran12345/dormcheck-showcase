import { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { useSearchParams, useNavigate, useLocation, useParams } from 'react-router';
import { DormCard } from '@/components/DormCard';
import {
  AdvancedFilters,
  defaultFilters,
  type AudienceFilterTab,
  type CampusScopeTab,
} from '@/components/DormSearch';
import { ExploreHousingFilterBar } from '@/components/ExploreHousingFilterBar';
import { MapMiniFilterBar } from '@/components/MapMiniFilterBar';
const DormDetail = lazy(() => import('@/components/DormDetail').then(module => ({ default: module.DormDetail })));
const MapView = lazy(() => import('@/components/MapView').then(module => ({ default: module.MapView })));
import { useAuth } from '@/hooks/useAuth';
import { useSavedDorms } from '@/hooks/useSavedDorms';
import { useDorms, findDormById } from '@/hooks/useDorms';
import { dormSlugFromName, findDormBySlugInList } from '@/lib/dormSlug';
import { Dorm } from '@/types';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { belongsInTab } from '@/lib/dormUtils';
import { getPostLoginRedirect } from '@/lib/authRedirects';
import { Heart, Loader2, Map as MapIcon, SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/button';
import { ExploreHousingRankingsOverlay } from '@/components/ExploreHousingRankingsOverlay';
import { ExploreHousingAdvancedFiltersDrawer } from '@/components/explore/ExploreHousingAdvancedFiltersDrawer';
import { useHousingSaved } from '@/contexts/HousingSavedContext';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { useScrollEngagement } from '@/contexts/ScrollEngagementContext';
import {
  EXPLORE_SHEET_SNAP_FULL,
  EXPLORE_SHEET_SNAP_HALF,
  EXPLORE_SHEET_SNAP_PEEK,
  MapBottomSheet,
  PEEK_VISIBLE_PX,
} from '@/components/explore/MapBottomSheet';
import { MapPreviewCarousel } from '@/components/explore/MapPreviewCarousel';
import { motion } from 'framer-motion';
import { listItemVariants } from '@/lib/motion';
import {
  MapTransitPreviewCard,
  type MapTransitSelection,
} from '@/components/explore/MapTransitPreviewCard';
import {
  busStopTransitKey,
  pogohTransitKey,
  type BusStop,
  type PogohStation,
} from '@/lib/transitMap';
import { useModalOverlay } from '@/contexts/ModalOverlayContext';
import {
  applyExploreViewportLockStyles,
  clearExploreViewportLockStyles,
} from '@/lib/exploreViewportLock';
import { MapLegend } from '@/components/explore/MapLegend';
import { CompareDormsTray } from '@/components/explore/CompareDormsTray';
import { useCurrentUserBuilding } from '@/hooks/useCurrentUserBuilding';
import { normalizeResidenceHallName } from '@/lib/housing-match';
import { walkMinutesToCathedral } from '@/lib/campusDistance';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Tab = 'campus' | 'map';

/** Desktop list sort. 'recommended' keeps source order with the user's own hall pinned first. */
type ExploreSortMode = 'recommended' | 'price-asc' | 'price-desc' | 'walk' | 'first-year';

const SORT_OPTIONS: { value: ExploreSortMode; label: string }[] = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'walk', label: 'Walk to Cathedral' },
  { value: 'first-year', label: 'First-year friendly' },
];

// Map a room-type string to normalized capacity filter ids. Hoisted to module scope
// so it is defined once, not re-created per dorm on every filter pass / keystroke.
const extractCapacityIds = (roomType: string): string[] => {
  const lower = String(roomType || '').toLowerCase();
  const ids: string[] = [];
  const personMatch = lower.match(/(\d+)-person/);
  const bedroomMatch = lower.match(/(\d+)\s*-\s*bedroom/i) || lower.match(/(\d+)\s*bedroom/i);
  if (personMatch) {
    const n = parseInt(personMatch[1], 10);
    if (n >= 5) ids.push('5-plus-person');
    else ids.push(`${n}-person`);
  } else if (bedroomMatch) {
    const n = parseInt(bedroomMatch[1], 10);
    if (n >= 5) ids.push('5-plus-person');
    else ids.push(`${n}-person`);
  } else if (/\bprivate\b|\bsingle\b|\bstudio\b|\b1-bed\b/.test(lower)) {
    ids.push('1-person');
  } else if (/\bshared room\b|2-person|\bdouble\b|\b2-bed\b/.test(lower)) {
    ids.push('2-person');
  } else if (/3-person|\btriple\b|\b3-bed\b/.test(lower)) {
    ids.push('3-person');
  } else if (/4-person|\bquad\b|\b4-bed\b/.test(lower)) {
    ids.push('4-person');
  } else if (/5-person|\bquintuple\b|\b5-bed\b|6-person|7-person|8-person/.test(lower)) {
    ids.push('5-plus-person');
  }
  return ids;
};

const Index = () => {
  const { t } = useTranslation();
  const { dormSlug } = useParams<{ dormSlug?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { isSaved, toggleSave, isLoggedIn, savedDormIds } = useSavedDorms();
  const { dorms, mapDorms, isLoading: dormsLoading, error: dormsError } = useDorms();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>('campus');
  const [selectedDorm, setSelectedDorm] = useState<Dorm | null>(null);
  const [campusScope, setCampusScope] = useState<CampusScopeTab>('on-campus');

  const handleCampusScopeChange = useCallback(
    (scope: CampusScopeTab) => {
      setCampusScope(scope);
      const next = new URLSearchParams(searchParams);
      next.set('type', scope);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const [audienceFilter, setAudienceFilter] = useState<AudienceFilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>(defaultFilters);
  const [hoveredDormId, setHoveredDormId] = useState<string | null>(null);
  const [scrollToDormId, setScrollToDormId] = useState<string | null>(null);
  const [focusDormIdForMap, setFocusDormIdForMap] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [highlightedFromMapDormId, setHighlightedFromMapDormId] = useState<string | null>(null);
  const [selectedMapDorm, setSelectedMapDorm] = useState<Dorm | null>(null);
  const [selectedTransit, setSelectedTransit] = useState<MapTransitSelection | null>(null);
  const markerTapFlyGuardRef = useRef<string | null>(null);
  const [mapShowBusStops, setMapShowBusStops] = useState(false);
  const [mapShowPogoh, setMapShowPogoh] = useState(false);
  const [mapShowBusLines, setMapShowBusLines] = useState(true);
  const [availableBusRoutes, setAvailableBusRoutes] = useState<string[]>([]);
  const [transitStops, setTransitStops] = useState<BusStop[]>([]);
  const [selectedRoutes, setSelectedRoutes] = useState<string[]>([]);
  const [focusStop, setFocusStop] = useState<{ lng: number; lat: number } | null>(null);
  const [focusStopNonce, setFocusStopNonce] = useState(0);
  const [exploreSheetSnapIndex, setExploreSheetSnapIndex] = useState(EXPLORE_SHEET_SNAP_PEEK);
  const [peekSheetVisiblePx, setPeekSheetVisiblePx] = useState(PEEK_VISIBLE_PX);
  const [exploreSheetFiltersOpen, setExploreSheetFiltersOpen] = useState(false);
  const [showRankings, setShowRankings] = useState(false);
  const { showSavedDorms } = useFeatureFlags();
  const { registerScrollTarget } = useScrollEngagement();
  const registerHeartClickOverride = useHousingSaved()?.registerHeartClickOverride;
  const setHeartOverrideActive = useHousingSaved()?.setHeartOverrideActive;
  const setSavedCount = useHousingSaved()?.setSavedCount;
  const modalOverlay = useModalOverlay();
  const desktopListRef = useRef<HTMLDivElement>(null);
  const mobileListRef = useRef<HTMLDivElement>(null);
  const cardRefsMap = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (activeTab !== 'campus' || selectedDorm) return;
    registerHeartClickOverride?.(() => setShowRankings((v) => !v));
    return () => {
      registerHeartClickOverride?.(null);
      setHeartOverrideActive?.(false);
    };
  }, [registerHeartClickOverride, setHeartOverrideActive, activeTab, selectedDorm]);

  useEffect(() => {
    if (activeTab !== 'campus' || selectedDorm) return;
    setHeartOverrideActive?.(showRankings);
  }, [activeTab, selectedDorm, showRankings, setHeartOverrideActive]);

  useEffect(() => {
    if (activeTab !== 'campus' || selectedDorm) {
      setSavedCount?.(null);
      return;
    }
    setSavedCount?.(savedDormIds.size);
    return () => setSavedCount?.(null);
  }, [activeTab, savedDormIds.size, selectedDorm, setSavedCount]);

  useEffect(() => {
    if (activeTab === 'campus' && !selectedDorm) return;
    setShowRankings(false);
  }, [activeTab, selectedDorm]);

  // Dorms map fills to the very top at peek AND half - any detent where the map
  // is still on screen; only the full detent covers it.
  const setFullBleedTop = modalOverlay?.setFullBleedTop;
  useEffect(() => {
    const dormsMapView = isMobile && activeTab === 'campus' && !selectedDorm;
    if (dormsMapView) {
      setFullBleedTop?.(exploreSheetSnapIndex !== EXPLORE_SHEET_SNAP_FULL);
    } else {
      setFullBleedTop?.(false);
    }
  }, [isMobile, activeTab, selectedDorm, exploreSheetSnapIndex, setFullBleedTop]);
  useEffect(() => () => setFullBleedTop?.(false), [setFullBleedTop]);

  useEffect(() => {
    const type = searchParams.get('type');
    const tab = searchParams.get('tab');
    if (type === 'on-campus' || tab === 'on-campus') setCampusScope('on-campus');
  }, [searchParams]);

  // Redirect logged-in users who haven't completed onboarding (e.g. email confirmation landing on /)
  useEffect(() => {
    if (!user?.id) return;
    let isMounted = true;
    getPostLoginRedirect(user.id).then((target) => {
      if (isMounted && target !== '/') {
        navigate(target, { replace: true });
      }
    });
    return () => { isMounted = false; };
  }, [user?.id, navigate]);

  // Redirect /campus?tab=map to /map for clean routing
  useEffect(() => {
    const tab = searchParams.get('tab');
    const focus = searchParams.get('focus');
    if (tab === 'map') {
      navigate(focus ? `/map?focus=${encodeURIComponent(focus)}` : '/map', {
        replace: true,
      });
    }
  }, [searchParams, navigate]);

  const focusFromUrl = searchParams.get('focus');
  // Deep link /campus?focus=<slug-or-id>: pan map + mobile preview (same as marker tap)
  useEffect(() => {
    if (dormSlug) return;
    const raw = focusFromUrl?.trim();
    if (!raw || dorms.length === 0) return;

    const focusTarget = decodeURIComponent(raw).trim();
    const resolved =
      dorms.find((d) => d.id === focusTarget) ?? findDormBySlugInList(dorms, focusTarget);

    setFocusDormIdForMap(resolved?.id ?? focusTarget);
    setFocusNonce((n) => n + 1);
    setCampusScope('on-campus');

    if (isMobile && resolved) {
      markerTapFlyGuardRef.current = resolved.id;
      setSelectedTransit(null);
      setSelectedMapDorm(resolved);
      setExploreSheetSnapIndex(EXPLORE_SHEET_SNAP_PEEK);
    }
  }, [focusFromUrl, dormSlug, dorms.length, isMobile]);

  // Sync tab from navigation state when returning home via BottomNav (Campus/Map)
  useEffect(() => {
    const tab = location.state?.activeTab;
    if (tab === 'campus' || tab === 'map') {
      setActiveTab(tab);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const mobileCampusExploreActive =
    isMobile && activeTab === 'campus' && !selectedDorm;
  const mobileExploreSheetActive = mobileCampusExploreActive && !showRankings;

  /**
   * Minimal vertical offset for mobile embed marker fly-to (no map padding).
   * Housing-only: the transit card must never alter the housing fly-to camera, so
   * `selectedTransit` is intentionally excluded from this calc.
   */
  const mobileExploreMapFocusOffsetY = useMemo(() => {
    const previewCardPx =
      selectedMapDorm && exploreSheetSnapIndex === EXPLORE_SHEET_SNAP_PEEK ? 140 : 0;
    const bottomObstruction = peekSheetVisiblePx + previewCardPx;
    return -Math.round(bottomObstruction * 0.35);
  }, [exploreSheetSnapIndex, peekSheetVisiblePx, selectedMapDorm]);

  const showMobileMapFiltersPill =
    isMobile &&
    activeTab === 'campus' &&
    !selectedDorm &&
    !showRankings &&
    (exploreSheetSnapIndex === EXPLORE_SHEET_SNAP_PEEK ||
      exploreSheetSnapIndex === EXPLORE_SHEET_SNAP_HALF);

  const clearMapPreviewSelection = useCallback(() => {
    setSelectedMapDorm(null);
    setSelectedTransit(null);
    setHighlightedFromMapDormId(null);
    setFocusDormIdForMap(null);
    markerTapFlyGuardRef.current = null;
  }, []);

  useEffect(() => {
    if (!mobileExploreSheetActive) {
      clearMapPreviewSelection();
    }
  }, [mobileExploreSheetActive, clearMapPreviewSelection]);

  // Feed the housing explore's internal scroll list to the nav chrome's "solidify on scroll"
  // material (the list scrolls inside MapBottomSheet / the desktop column, not window).
  useEffect(() => {
    const exploreListShown = activeTab === 'campus' && !selectedDorm && !showRankings;
    if (!exploreListShown) {
      registerScrollTarget(null);
      return;
    }
    registerScrollTarget((isMobile ? mobileListRef.current : desktopListRef.current) ?? null);
    return () => registerScrollTarget(null);
  }, [isMobile, activeTab, selectedDorm, showRankings, registerScrollTarget]);

  useEffect(() => {
    if (exploreSheetSnapIndex !== EXPLORE_SHEET_SNAP_PEEK) {
      clearMapPreviewSelection();
    }
  }, [exploreSheetSnapIndex, clearMapPreviewSelection]);

  // Legacy ?dorm=<id> → /campus/<slug> (preserve other query params)
  useEffect(() => {
    const legacyId = searchParams.get('dorm');
    if (!legacyId || dorms.length === 0) return;

    let cancelled = false;

    const finish = (d: Dorm | null) => {
      if (cancelled) return;
      const next = new URLSearchParams(searchParams);
      next.delete('dorm');
      const q = next.toString();
      if (d) {
        navigate(`/campus/${dormSlugFromName(d.name)}${q ? `?${q}` : ''}`, { replace: true });
      } else {
        navigate({ pathname: '/campus', search: q ? `?${q}` : '' }, { replace: true });
      }
    };

    const fromList = dorms.find((x) => x.id === legacyId);
    if (fromList) {
      finish(fromList);
      return () => {
        cancelled = true;
      };
    }
    findDormById(legacyId).then((d) => finish(d));
    return () => {
      cancelled = true;
    };
  }, [searchParams, dorms, navigate]);

  // Direct /campus/:dormSlug (and numeric segment → canonical slug)
  useEffect(() => {
    let cancelled = false;

    if (!dormSlug) {
      if (searchParams.get('dorm')) return;
      setSelectedDorm(null);
      return;
    }
    if (dorms.length === 0) return;

    if (/^\d+$/.test(dormSlug)) {
      const fromList = dorms.find((d) => d.id === dormSlug);
      if (fromList) {
        navigate(`/campus/${dormSlugFromName(fromList.name)}`, { replace: true });
        return;
      }
      findDormById(dormSlug).then((d) => {
        if (cancelled) return;
        if (d) navigate(`/campus/${dormSlugFromName(d.name)}`, { replace: true });
        else navigate('/campus', { replace: true });
      });
      return () => {
        cancelled = true;
      };
    }

    const found = findDormBySlugInList(dorms, dormSlug);
    if (found) setSelectedDorm(found);
    else {
      setSelectedDorm(null);
      navigate('/campus', { replace: true });
    }

    return () => {
      cancelled = true;
    };
  }, [dormSlug, dorms, navigate, searchParams]);

  useEffect(() => {
    if (dormSlug) setActiveTab('campus');
  }, [dormSlug]);

  // Get saved dorms for profile view - memoized to avoid recalculation on every render
  const savedDorms = useMemo(() => {
    return dorms.filter(d => savedDormIds.has(d.id));
  }, [dorms, savedDormIds]);

  const handleDormClick = (dorm: Dorm) => {
    navigate(`/campus/${dormSlugFromName(dorm.name)}`);
  };

  const handleMarkerClick = useCallback(
    (dorm: Dorm) => {
      setSelectedTransit(null);
      if (isMobile) {
        markerTapFlyGuardRef.current = dorm.id;
        setSelectedMapDorm(dorm);
        setExploreSheetSnapIndex(EXPLORE_SHEET_SNAP_PEEK);
        setFocusDormIdForMap(dorm.id);
        setFocusNonce((n) => n + 1);
        return;
      }
      setHighlightedFromMapDormId(dorm.id);
      setScrollToDormId(dorm.id);
    },
    [isMobile],
  );

  const handleBusStopClick = useCallback((stop: BusStop) => {
    setSelectedMapDorm(null);
    setHighlightedFromMapDormId(null);
    markerTapFlyGuardRef.current = null;
    setSelectedTransit({ type: 'bus', stop });
    setExploreSheetSnapIndex(EXPLORE_SHEET_SNAP_PEEK);
  }, []);

  // Stop picked from the transit search: fly the map to it (routes are selected inside the filter bar).
  const handleTransitStopSelect = useCallback((stop: BusStop) => {
    const lng = typeof stop.stop_lon === 'number' ? stop.stop_lon : parseFloat(String(stop.stop_lon ?? ''));
    const lat = typeof stop.stop_lat === 'number' ? stop.stop_lat : parseFloat(String(stop.stop_lat ?? ''));
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    setFocusStop({ lng, lat });
    setFocusStopNonce((n) => n + 1);
  }, []);

  const handlePogohClick = useCallback((station: PogohStation) => {
    setSelectedMapDorm(null);
    setHighlightedFromMapDormId(null);
    markerTapFlyGuardRef.current = null;
    setSelectedTransit({ type: 'pogoh', station });
    setExploreSheetSnapIndex(EXPLORE_SHEET_SNAP_PEEK);
  }, []);

  const handleMapPreviewDismiss = useCallback(() => {
    clearMapPreviewSelection();
  }, [clearMapPreviewSelection]);

  const handleCarouselActiveChange = useCallback((dorm: Dorm) => {
    const guardMatch = markerTapFlyGuardRef.current === dorm.id;
    setSelectedMapDorm(dorm);
    if (guardMatch) {
      markerTapFlyGuardRef.current = null;
      return;
    }
    setFocusDormIdForMap((prev) => {
      if (prev === dorm.id) return prev;
      setFocusNonce((n) => n + 1);
      return dorm.id;
    });
  }, []);

  const handleCarouselDismiss = useCallback(() => {
    clearMapPreviewSelection();
  }, [clearMapPreviewSelection]);

  const selectedTransitKey = useMemo(() => {
    if (!selectedTransit) return null;
    return selectedTransit.type === 'bus'
      ? busStopTransitKey(selectedTransit.stop)
      : pogohTransitKey(selectedTransit.station);
  }, [selectedTransit]);

  /** Mobile explore: pin emphasis follows map preview selection only (never focusDormId / stale highlight id). */
  const mobileMapHighlightedDormId = selectedMapDorm?.id ?? null;

  const handleCardClickForMap = useCallback(
    (dorm: Dorm) => {
      setFocusDormIdForMap(dorm.id);
      setFocusNonce((n) => n + 1);
      if (isMobile) {
        setExploreSheetSnapIndex(EXPLORE_SHEET_SNAP_PEEK);
      }
    },
    [isMobile],
  );

  const setCardRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) cardRefsMap.current.set(id, el);
    else cardRefsMap.current.delete(id);
  }, []);

  // Desktop only: scroll list to the card for a map marker tap. Mobile uses MapPreviewCarousel instead.
  useEffect(() => {
    if (isMobile || !scrollToDormId) return;
    const listEl = desktopListRef.current;
    if (!listEl) return;
    const el = cardRefsMap.current.get(scrollToDormId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    setScrollToDormId(null);
  }, [scrollToDormId, isMobile]);

  // Scroll listing container to top when audience filter changes (desktop and mobile)
  useLayoutEffect(() => {
    const el = isMobile ? mobileListRef.current : desktopListRef.current;
    if (el) {
      el.scrollTop = 0;
      el.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [audienceFilter, isMobile]);

  const handleBackFromDetail = () => {
    navigate('/campus');
  };

  const handleClearExploreFilters = useCallback(() => {
    setSearchQuery('');
    setAdvancedFilters(defaultFilters);
    setAudienceFilter('all');
  }, []);

  // Search is an additional predicate, not a hidden reset of every visible
  // filter. A result must satisfy the selected audience/room/price/amenity
  // filters and the name query so the controls always articulate the result.
  const filteredDorms = useMemo(() => {
    const lowerQuery = (searchQuery || '').trim().toLowerCase();

    return dorms.filter((dorm) => {
      if (lowerQuery && !(dorm.name || '').toLowerCase().includes(lowerQuery)) return false;
      if (audienceFilter !== 'all' && !belongsInTab(dorm, audienceFilter)) return false;

      const capacitySet = new Set<string>();
      const roomSources: string[] = [];
      if (Array.isArray(dorm.variants) && dorm.variants.length > 0) {
        dorm.variants.forEach((v) => v.roomType && roomSources.push(v.roomType));
      }
      if (roomSources.length === 0 && Array.isArray(dorm.roomTypes)) {
        dorm.roomTypes.forEach((t) => t && roomSources.push(String(t)));
      }
      roomSources.forEach((rt) => extractCapacityIds(rt).forEach((id) => capacitySet.add(id)));

      if (advancedFilters.roomCapacities.size > 0) {
        const matches = [...advancedFilters.roomCapacities].some((id) => capacitySet.has(id));
        if (!matches) return false;
      }

      // Price: only apply when rate exists. Resilient: missing rate must not hide the block (Mayflower, Darragh St, etc.).
      const rate = dorm.semesterRate ?? 0;
      if (rate > 0) {
        const [minPrice, maxPrice] = advancedFilters.priceRange;
        if (rate < minPrice || rate > maxPrice) return false;
      }

      // Amenities: AC←heat_and_air_conditioning (acType), private bath/kitchen←building_amenities, inroom_amenities, amenities_on_each_floor, bathrooms
      const allAmenities = [
        dorm.buildingAmenities || '',
        dorm.inroomAmenities || '',
        dorm.acType || '',
        dorm.housingType || ''
      ].join(' ').toLowerCase();

      if (advancedFilters.hasAC && !dorm.heat_and_air_conditioning) {
        return false; // Skip if user wants AC but dorm is False
      }

      if (advancedFilters.hasPrivateBath) {
        const hasPrivateBath = allAmenities.includes('private bath') ||
          allAmenities.includes('private bathroom') || allAmenities.includes('en-suite');
        if (!hasPrivateBath) return false;
      }

      if (advancedFilters.hasKitchen) {
        const hasKitchen = allAmenities.includes('kitchen') ||
          allAmenities.includes('kitchenette') || allAmenities.includes('apartment');
        if (!hasKitchen) return false;
      }

      return true;
    });
  }, [dorms, audienceFilter, searchQuery, advancedFilters]);

  const [sortMode, setSortMode] = useState<ExploreSortMode>('recommended');
  const { building: currentUserBuilding } = useCurrentUserBuilding();

  // Grouped dorm matching the user's profile hall (e.g. "Bouquet Gardens B" → "Bouquet Gardens").
  const yourHallDormId = useMemo(() => {
    if (!currentUserBuilding) return null;
    const target = normalizeResidenceHallName(currentUserBuilding.residenceHallName);
    if (!target) return null;
    const match = dorms.find((d) => {
      const n = normalizeResidenceHallName(d.name ?? '');
      return n !== '' && (n === target || target.startsWith(`${n} `));
    });
    return match?.id ?? null;
  }, [currentUserBuilding, dorms]);

  const sortedDorms = useMemo(() => {
    const list = [...filteredDorms];
    // Semester-equivalent rate for fair price sorting; missing rates sort last.
    const termRate = (d: Dorm): number | null => {
      const r = d.semesterRate ?? 0;
      if (r <= 0) return null;
      return String(d.rentPeriod ?? '').toLowerCase() === 'month' ? r * 4 : r;
    };
    switch (sortMode) {
      case 'price-asc':
        list.sort((a, b) => (termRate(a) ?? Infinity) - (termRate(b) ?? Infinity));
        break;
      case 'price-desc':
        list.sort((a, b) => (termRate(b) ?? -Infinity) - (termRate(a) ?? -Infinity));
        break;
      case 'walk':
        list.sort(
          (a, b) =>
            (walkMinutesToCathedral(a.latitude, a.longitude) ?? Infinity) -
            (walkMinutesToCathedral(b.latitude, b.longitude) ?? Infinity),
        );
        break;
      case 'first-year':
        list.sort(
          (a, b) => Number(b.audienceType === 'Freshman') - Number(a.audienceType === 'Freshman'),
        );
        break;
      default:
        break;
    }
    if (sortMode === 'recommended' && yourHallDormId) {
      const idx = list.findIndex((d) => d.id === yourHallDormId);
      if (idx > 0) {
        const [yourHall] = list.splice(idx, 1);
        list.unshift(yourHall);
      }
    }
    return list;
  }, [filteredDorms, sortMode, yourHallDormId]);

  const renderContent = () => {
    // If a dorm is selected, show detail view
    if (selectedDorm && activeTab === 'campus') {
      return (
        <Suspense fallback={
          <div className="flex justify-center items-center p-10 min-h-screen">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        }>
          <DormDetail
            dorm={selectedDorm}
            photos={[]}
            onBack={handleBackFromDetail}
            onViewMap={() =>
              navigate(`/campus?focus=${encodeURIComponent(dormSlugFromName(selectedDorm.name))}`)
            }
            allDorms={dorms}
            onDormSelect={handleDormClick}
          />
        </Suspense>
      );
    }

    switch (activeTab) {
      case 'campus': {
        const isCardHighlighted = (id: string) => hoveredDormId === id || highlightedFromMapDormId === id;
        const exploreSheetPeekHalfTitle =
          campusScope === 'off-campus' ? 'Off-Campus Housing' : 'On-Campus Housing';
        const renderMobileExploreDormList = () => (
          <div className="grid grid-cols-1 gap-2 px-2 pt-1 pb-4 items-stretch [grid-auto-rows:minmax(0,1fr)]">
            {dormsLoading && dorms.length === 0 &&
              Array.from({ length: 4 }).map((_, idx) => (
                <div key={`dorm-skeleton-${idx}`} className="overflow-hidden rounded-xl border border-border bg-card shadow-raised" aria-hidden>
                  <div className="h-32 animate-pulse bg-muted" />
                  <div className="space-y-2 p-3">
                    <div className="h-4 w-3/5 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
                  </div>
                </div>
              ))}
            {dormsError && !dormsLoading && (
              <div className="col-span-2 text-center py-12">
                <p className="text-destructive mb-2">Failed to load dorms</p>
                <p className="text-muted-foreground text-sm">{dormsError.message}</p>
              </div>
            )}
            {!dormsLoading && !dormsError && dorms.length > 0 && filteredDorms.length === 0 && (
              <EmptyState
                className="col-span-2 py-20"
                icon={SearchX}
                title={t('housing:emptyStates.exploreNoMatchTitle')}
                description={t('housing:emptyStates.exploreNoMatchBody')}
                action={
                  <Button
                    type="button"
                    onClick={handleClearExploreFilters}
                    className="rounded-full bg-malachite-800 px-6 text-white hover:bg-malachite-900"
                  >
                    {t('housing:emptyStates.exploreClearFilters')}
                  </Button>
                }
              />
            )}
            {!dormsLoading && !dormsError && filteredDorms.map((dorm, dormIndex) => (
              <motion.div
                key={dorm.id}
                ref={(el) => setCardRef(dorm.id, el)}
                onMouseEnter={() => setHoveredDormId(dorm.id)}
                onMouseLeave={() => setHoveredDormId(null)}
                className="h-full min-h-0"
                variants={listItemVariants}
                initial="hidden"
                animate="visible"
                custom={dormIndex}
              >
                <DormCard
                  dorm={dorm}
                  dense
                  isHighlighted={isCardHighlighted(dorm.id)}
                  isYourHall={dorm.id === yourHallDormId}
                  onClick={() => handleDormClick(dorm)}
                  onViewDetails={() => handleCardClickForMap(dorm)}
                  ctaLabel="Show on map"
                  hideMapCtaOnMobile
                  isSaved={isSaved(dorm.id)}
                  onToggleSave={toggleSave}
                  isLoggedIn={isLoggedIn}
                />
              </motion.div>
            ))}
          </div>
        );
        const listSectionTitle =
          audienceFilter === 'freshman'
            ? 'University of Pittsburgh on-campus dorms'
            : audienceFilter === 'upperclass'
              ? 'University of Pittsburgh university owned apartments/dorms'
              : 'University of Pittsburgh on-campus housing';
        return (
          <div
            className={cn(
              'flex flex-col flex-1 min-h-0 overflow-hidden bg-background mt-[-1px]',
              useStrictMobileLayout && 'max-h-full overscroll-none',
            )}
          >
            {/* Global Filter Bar - spans full width above split (desktop only) */}
            <div className="hidden md:block shrink-0">
              <ExploreHousingFilterBar
              allDorms={dorms}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onDormSelect={handleDormClick}
              campusScope={campusScope}
              onCampusScopeChange={handleCampusScopeChange}
              audienceFilter={audienceFilter}
              onAudienceFilterChange={setAudienceFilter}
              filters={advancedFilters}
              onFiltersChange={setAdvancedFilters}
              disableHousingToggle={false}
              />
            </div>
            {/* Desktop: 50/50 split - Map left (h-full, non-scrollable), List right (h-full, overflow-y-auto) */}
            <div className="hidden md:flex flex-1 min-h-0 w-full overflow-hidden">
              <div className="w-1/2 h-full relative shrink-0 min-w-0 overflow-hidden">
                <MapMiniFilterBar
                  filters={advancedFilters}
                  onFiltersChange={setAdvancedFilters}
                  showBusLines={mapShowBusLines}
                  onShowBusLinesChange={setMapShowBusLines}
                  showBusStops={mapShowBusStops}
                  onShowBusStopsChange={setMapShowBusStops}
                  showPogoh={mapShowPogoh}
                  onShowPogohChange={setMapShowPogoh}
                  availableRoutes={availableBusRoutes}
                  busStops={transitStops}
                  selectedRoutes={selectedRoutes}
                  onSelectedRoutesChange={setSelectedRoutes}
                  onStopSelect={handleTransitStopSelect}
                />
                <Suspense fallback={<div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
                  <MapView
                    dorms={dorms}
                    mapDorms={mapDorms}
                    embedMode
                    filteredDorms={filteredDorms}
                    focusDormId={focusDormIdForMap}
                    focusNonce={focusNonce}
                    highlightedDormId={hoveredDormId ?? highlightedFromMapDormId}
                    hoverPeekDormId={hoveredDormId}
                    embedShowBusStops={mapShowBusStops}
                    embedShowPogoh={mapShowPogoh}
                    embedShowBusLines={mapShowBusLines}
                    embedSelectedRoutes={selectedRoutes}
                    onBusRoutesLoaded={setAvailableBusRoutes}
                    onBusStopsLoaded={setTransitStops}
                    embedFocusStop={focusStop}
                    focusStopNonce={focusStopNonce}
                    onDormClick={handleMarkerClick}
                  />
                </Suspense>
                <MapLegend
                  className="absolute bottom-3 left-3 z-10"
                  showBusLines={mapShowBusLines}
                  showBusStops={mapShowBusStops}
                  showPogoh={mapShowPogoh}
                />
              </div>
              <div className="w-1/2 h-full flex flex-col min-w-0 border-l border-border bg-card overflow-hidden shrink-0">
                {showRankings ? (
                  <ExploreHousingRankingsOverlay
                    savedDorms={savedDorms}
                    onDormClick={handleDormClick}
                    isSaved={isSaved}
                    onToggleSave={toggleSave}
                    isLoggedIn={isLoggedIn}
                    onClose={() => setShowRankings(false)}
                    isMobile={false}
                    showRankingsTab={false}
                  />
                ) : (
                <div
                  ref={desktopListRef}
                  className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-thin"
                >
                  <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3 bg-card">
                    <h2 className="min-w-0 text-lg font-bold text-foreground">
                      {listSectionTitle}
                    </h2>
                    <div className="flex shrink-0 items-center gap-2">
                      <label htmlFor="explore-sort" className="text-sm text-muted-foreground">
                        Sort
                      </label>
                      <Select
                        value={sortMode}
                        onValueChange={(v) => setSortMode(v as ExploreSortMode)}
                      >
                        <SelectTrigger id="explore-sort" className="h-9 w-[190px] bg-card">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="end">
                          {SORT_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 pt-4 items-stretch [grid-auto-rows:minmax(0,1fr)]">
                    {dormsLoading && dorms.length === 0 &&
                      Array.from({ length: 6 }).map((_, idx) => (
                        <div key={`dorm-skeleton-${idx}`} className="overflow-hidden rounded-xl border border-border bg-card shadow-raised" aria-hidden>
                          <div className="h-32 animate-pulse bg-muted" />
                          <div className="space-y-2 p-3">
                            <div className="h-4 w-3/5 animate-pulse rounded bg-muted" />
                            <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
                          </div>
                        </div>
                      ))}
                    {dormsError && !dormsLoading && (
                      <div className="col-span-2 text-center py-12">
                        <p className="text-destructive mb-2">Failed to load dorms</p>
                        <p className="text-muted-foreground text-sm">{dormsError.message}</p>
                      </div>
                    )}
                    {!dormsLoading && !dormsError && dorms.length > 0 && filteredDorms.length === 0 && (
                      <EmptyState
                        className="col-span-2 py-20"
                        icon={SearchX}
                        title={t('housing:emptyStates.exploreNoMatchTitle')}
                        description={t('housing:emptyStates.exploreNoMatchBody')}
                        action={
                          <Button
                            type="button"
                            onClick={handleClearExploreFilters}
                            className="rounded-full bg-malachite-800 px-6 text-white hover:bg-malachite-900"
                          >
                            {t('housing:emptyStates.exploreClearFilters')}
                          </Button>
                        }
                      />
                    )}
                    {!dormsLoading && !dormsError && sortedDorms.map((dorm, dormIndex) => (
                      <motion.div
                        key={dorm.id}
                        ref={(el) => setCardRef(dorm.id, el)}
                        onMouseEnter={() => { setHoveredDormId(dorm.id); setHighlightedFromMapDormId(null); }}
                        onMouseLeave={() => setHoveredDormId(null)}
                        className="h-full min-h-0"
                        variants={listItemVariants}
                        initial="hidden"
                        animate="visible"
                        custom={dormIndex}
                      >
                        <DormCard
                          dorm={dorm}
                          compact
                          isHighlighted={isCardHighlighted(dorm.id)}
                          isYourHall={dorm.id === yourHallDormId}
                          onClick={() => handleDormClick(dorm)}
                          onViewDetails={() => handleCardClickForMap(dorm)}
                          ctaLabel="Show on map"
                          isSaved={isSaved(dorm.id)}
                          onToggleSave={toggleSave}
                          isLoggedIn={isLoggedIn}
                        />
                      </motion.div>
                    ))}
                  </div>
                </div>
                )}
                {!showRankings && (
                  <CompareDormsTray savedDorms={savedDorms} onDormClick={handleDormClick} />
                )}
              </div>
            </div>

            {/* Mobile: full-bleed map + snap-point list sheet; or Rankings overlay */}
            <div
              className={cn(
                'md:hidden flex flex-1 min-h-0 flex-col overflow-hidden',
                useStrictMobileLayout && 'overscroll-none',
              )}
            >
              <div className="relative min-h-0 flex-1">
              {showRankings ? (
                <div className="absolute inset-0 z-30 flex min-h-0 flex-col bg-card">
                  <ExploreHousingRankingsOverlay
                    savedDorms={savedDorms}
                    onDormClick={(dorm) => { handleDormClick(dorm); setShowRankings(false); }}
                    isSaved={isSaved}
                    onToggleSave={toggleSave}
                    isLoggedIn={isLoggedIn}
                    onClose={() => setShowRankings(false)}
                    isMobile={true}
                    showRankingsTab={false}
                  />
                </div>
              ) : (
                <>
                  <div className="absolute inset-0 z-0 min-h-0">
                    <Suspense fallback={<div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
                      <MapView
                        dorms={dorms}
                        mapDorms={mapDorms}
                        embedMode
                        filteredDorms={filteredDorms}
                        focusDormId={focusDormIdForMap}
                        focusNonce={focusNonce}
                        highlightedDormId={mobileMapHighlightedDormId}
                        embedShowBusStops={mapShowBusStops}
                        embedShowPogoh={mapShowPogoh}
                        embedShowBusLines={mapShowBusLines}
                        embedSelectedRoutes={selectedRoutes}
                        onBusRoutesLoaded={setAvailableBusRoutes}
                        onBusStopsLoaded={setTransitStops}
                        embedFocusStop={focusStop}
                        focusStopNonce={focusStopNonce}
                        onDormClick={handleMarkerClick}
                        embedMobileFocusOffsetY={mobileExploreMapFocusOffsetY}
                        onBusStopClick={handleBusStopClick}
                        onPogohClick={handlePogohClick}
                        onMapBackgroundClick={handleMapPreviewDismiss}
                        selectedTransitKey={selectedTransitKey}
                      />
                    </Suspense>
                    {selectedMapDorm && exploreSheetSnapIndex === EXPLORE_SHEET_SNAP_PEEK && (
                      <MapPreviewCarousel
                        className="absolute inset-x-3 z-20"
                        style={{ bottom: peekSheetVisiblePx + 8 }}
                        dorms={filteredDorms}
                        activeDormId={selectedMapDorm.id}
                        onActiveDormChange={handleCarouselActiveChange}
                        onCardTap={handleDormClick}
                        onDismiss={handleCarouselDismiss}
                      />
                    )}
                    {selectedTransit && exploreSheetSnapIndex === EXPLORE_SHEET_SNAP_PEEK && (
                      <MapTransitPreviewCard
                        className="absolute inset-x-3 z-20"
                        style={{ bottom: peekSheetVisiblePx + 8 }}
                        selection={selectedTransit}
                        onDismiss={handleMapPreviewDismiss}
                      />
                    )}
                  </div>
                  <MapBottomSheet
                    snapIndex={exploreSheetSnapIndex}
                    onSnapIndexChange={setExploreSheetSnapIndex}
                    headerLabel={exploreSheetPeekHalfTitle}
                    headerAccessory={
                      <div className="flex w-full items-center gap-2">
                        <div className="min-w-0 flex-1 [&_button]:w-full">
                          <ExploreHousingAdvancedFiltersDrawer
                            filters={advancedFilters}
                            onFiltersChange={setAdvancedFilters}
                            audienceFilter={audienceFilter}
                            onAudienceFilterChange={setAudienceFilter}
                            open={exploreSheetFiltersOpen}
                            onOpenChange={setExploreSheetFiltersOpen}
                            triggerVariant="compact-filled"
                          />
                        </div>
                        {showSavedDorms && (
                          <button
                            type="button"
                            onClick={() => setShowRankings(true)}
                            onPointerDown={(e) => e.stopPropagation()}
                            onTouchStart={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-full border border-malachite-600 bg-malachite-800 px-3 text-xs font-medium text-white shadow-none transition-colors hover:bg-malachite-900 [&_svg]:text-white"
                            aria-label="Saved dorms"
                          >
                            <Heart className="h-3.5 w-3.5 shrink-0" />
                            Saved
                          </button>
                        )}
                      </div>
                    }
                    listRef={mobileListRef}
                    onPeekVisibleHeightChange={setPeekSheetVisiblePx}
                  >
                    {renderMobileExploreDormList()}
                  </MapBottomSheet>
                  {showMobileMapFiltersPill && (
                      <div className="pointer-events-auto absolute right-3 top-[calc(env(safe-area-inset-top)+3.5rem)] z-20 md:hidden">
                        <MapMiniFilterBar
                          floating
                          filters={advancedFilters}
                          onFiltersChange={setAdvancedFilters}
                          showBusLines={mapShowBusLines}
                          onShowBusLinesChange={setMapShowBusLines}
                          showBusStops={mapShowBusStops}
                          onShowBusStopsChange={setMapShowBusStops}
                          showPogoh={mapShowPogoh}
                          onShowPogohChange={setMapShowPogoh}
                          availableRoutes={availableBusRoutes}
                          busStops={transitStops}
                          selectedRoutes={selectedRoutes}
                          onSelectedRoutesChange={setSelectedRoutes}
                          onStopSelect={handleTransitStopSelect}
                        />
                      </div>
                  )}
                  {exploreSheetSnapIndex === EXPLORE_SHEET_SNAP_FULL && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center pb-3">
                      <button
                        type="button"
                        onClick={() => setExploreSheetSnapIndex(EXPLORE_SHEET_SNAP_PEEK)}
                        className="pointer-events-auto inline-flex min-h-[44px] items-center gap-2 rounded-full border border-white/15 bg-stone-900/70 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(0,0,0,0.28)] backdrop-blur-2xl backdrop-saturate-150 transition-transform active:scale-[0.98] supports-[backdrop-filter]:bg-stone-900/60"
                        aria-label="Show map"
                      >
                        <MapIcon className="h-4 w-4 shrink-0" aria-hidden />
                        Map
                      </button>
                    </div>
                  )}
                </>
              )}
              </div>
            </div>
          </div>
        );
      }

      default:
        return null;
    }
  };

  const isExploreHousingSplit =
    activeTab === 'campus' && !selectedDorm;
  const useStrictMobileLayout = isExploreHousingSplit && isMobile;
  const isDormDetailView = Boolean(
    selectedDorm && activeTab === 'campus',
  );

  // body has safe-area padding-top; 100dvh layout + iOS rubber-band need document scroll locked on map+sheet explore only
  useLayoutEffect(() => {
    if (!useStrictMobileLayout) {
      clearExploreViewportLockStyles();
      return;
    }
    applyExploreViewportLockStyles();
    return () => {
      clearExploreViewportLockStyles();
    };
  }, [useStrictMobileLayout]);

  return (
    <div
      className={cn(
        'bg-background flex flex-col',
        isExploreHousingSplit
          ? 'h-full overflow-hidden'
          : 'min-h-screen',
        useStrictMobileLayout && 'min-h-0 max-h-full overscroll-none'
      )}
    >
      <div
        className={cn(
          'flex-1 min-h-0 flex flex-col',
          isDormDetailView ? 'overflow-visible' : 'overflow-hidden',
          useStrictMobileLayout && 'overscroll-none'
        )}
      >
        {renderContent()}
      </div>
    </div>
  );
};

export default Index;
