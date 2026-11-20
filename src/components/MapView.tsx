import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { Dorm } from '@/types';
import { MapPin, Filter, ChevronDown, ChevronRight, ChevronUp, Search, X } from 'lucide-react';
import {
  AdaptiveOverlay,
  AdaptiveOverlayContent,
  AdaptiveOverlayHeader,
  AdaptiveOverlayTitle,
  AdaptiveOverlayTrigger,
} from '@/components/ui/adaptive-overlay';
import { Switch } from '@/components/ui/switch';
import { useIsMobile } from '@/hooks/use-mobile';
import { useModalOverlay } from '@/contexts/ModalOverlayContext';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { safeImageSrc } from '@/lib/sanitize';
import { dormSlugFromName, findDormBySlugInList } from '@/lib/dormSlug';
import { useUniversity } from '@/contexts/UniversityContext';
import { useMapboxTheme } from '@/hooks/useMapboxTheme';

// Token from Vite env; set in .env or .env.local as VITE_MAPBOX_TOKEN (never commit the token).
const MAPBOX_PUBLIC_TOKEN = (() => {
  const token = import.meta.env.VITE_MAPBOX_TOKEN;
  if (!token || typeof token !== 'string' || token.trim() === '') {
    console.warn(
      '[MapView] VITE_MAPBOX_TOKEN is missing. Add it to .env or .env.local so the map works locally.'
    );
    return '';
  }
  return token;
})();
// Default center comes from the user's university (universities.ts campusCenter,
// Mapbox order [longitude, latitude]); DEFAULT_UNIVERSITY (Pitt, Schenley Quad)
// applies while signed out or before the profile resolves.
// Pitt campus placeholder when image_url is missing (master_housing)
const DORM_PLACEHOLDER_IMAGE = '/placeholder.svg';
const DEFAULT_ZOOM = 14.2;
/** Mobile explore embed: floor zoom so idle drift cannot pull out to metro-wide view. */
const MOBILE_EMBED_MIN_ZOOM = 13.5;

/** Mobile embed: reliable single-tap on Mapbox HTML markers (avoids map dblclick / missed click). */
function applyMobileEmbedMarkerHitTarget(el: HTMLElement) {
  el.style.pointerEvents = 'auto';
  el.style.touchAction = 'manipulation';
  el.style.zIndex = '2';
  // Invisible slop so the pin tip stays on the coordinate but the tap target is larger.
  el.style.padding = '10px';
  el.style.margin = '-10px';
  el.style.boxSizing = 'content-box';
}

function bindMarkerTap(
  el: HTMLElement,
  handler: (e: Event) => void,
  mobileEmbed: boolean,
) {
  const run = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    handler(e);
  };
  if (!mobileEmbed) {
    el.addEventListener('click', run);
    return;
  }
  let suppressClick = false;
  el.addEventListener('pointerup', (e) => {
    const pe = e as PointerEvent;
    if (pe.pointerType === 'mouse' && pe.button !== 0) return;
    suppressClick = true;
    run(e);
    window.setTimeout(() => {
      suppressClick = false;
    }, 400);
  });
  el.addEventListener('click', (e) => {
    if (suppressClick) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    run(e);
  });
}

const PITT_BLUE = '#1e3a5f';

// Pin colors: First-Year = green, Upperclass = violet. Shared with the explore MapLegend.
import { PIN_COLORS, getDormPinCategory, type PinCategory } from '@/lib/dormPins';

/** Darker fill for selected/active dorm pins (derived from base pin color). */
function darkenPinColor(hex: string, amount = 0.22): string {
  const raw = hex.replace('#', '');
  if (raw.length !== 6) return hex;
  const factor = 1 - amount;
  const toByte = (start: number) =>
    Math.max(0, Math.min(255, Math.round(parseInt(raw.slice(start, start + 2), 16) * factor)));
  const r = toByte(0);
  const g = toByte(2);
  const b = toByte(4);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

import {
  busStopTransitKey,
  pogohTransitKey,
  BUS_STOP_COLOR,
  POGOH_TEAL,
  type BusStop,
  type PogohStation,
} from '@/lib/transitMap';
import { useTransitData } from '@/hooks/useTransitData';
import { useTransitLayers } from '@/hooks/useTransitLayers';
import type { RouteFeatureProps } from '@/lib/transitLayers';

export type { BusStop, PogohStation };
export { busStopTransitKey, pogohTransitKey };

export type { PinCategory };

export interface MapBuilding {
  id: number;
  name: string;
  housingType: string;
  latitude: number;
  longitude: number;
  dormId: string;
  pinCategory: PinCategory;
  hasAC: boolean;
  isLLC: boolean;
  rateNum: number;
  rateDisplay: string;
  whoLivesHere: string;
  imageUrl: string | null;
}

interface MapViewProps {
  dorms: Dorm[];
  /** Flat list for map pins (one per building/location). If provided, used instead of dorms for markers. Enables distinct pins for Bouquet Gardens A, B, J, etc. */
  mapDorms?: Dorm[];
  /** When set (e.g. from ?focus=dormId), fly to this dorm and show its popup immediately. */
  focusDormId?: string | null;
  /** Increment to force re-run focus logic (e.g. when user clicks "Show on map" again for same building). */
  focusNonce?: number;
  /** When set, the matching marker bounces/highlights (e.g. when hovering a list card). */
  highlightedDormId?: string | null;
  /**
   * Desktop embed: id of the dorm the user is hovering in the list. The map
   * emphasizes it (via highlightedDormId) and gently pans it into view ONLY if
   * it's currently off-screen - no movement when the pin is already visible.
   */
  hoverPeekDormId?: string | null;
  /** When true, hide sidebar overlay; use for split-screen embed. */
  embedMode?: boolean;
  /** When in embedMode, use these dorms for markers instead of internal filtering. */
  filteredDorms?: Dorm[];
  /** When in embedMode, control bus stops visibility from parent (e.g. MapMiniFilterBar). */
  embedShowBusStops?: boolean;
  /** When in embedMode, control Pogoh visibility from parent. */
  embedShowPogoh?: boolean;
  /** When in embedMode, control bus route lines visibility from parent. */
  embedShowBusLines?: boolean;
  /** When in embedMode, only show bus stops that serve at least one of these routes (e.g. from MapMiniFilterBar). Empty = show all. */
  embedSelectedRoutes?: string[];
  /** Called when bus stops load so parent can show route filter options (e.g. MapMiniFilterBar). */
  onBusRoutesLoaded?: (routes: string[]) => void;
  /** Called when bus stops load so parent can power a stop-name search (e.g. MapMiniFilterBar). */
  onBusStopsLoaded?: (stops: BusStop[]) => void;
  /** When set, fly to this stop's coordinates (e.g. picked from MapMiniFilterBar search). */
  embedFocusStop?: { lng: number; lat: number } | null;
  /** Increment to force re-run of the focus-stop fly-to (re-selecting the same stop re-centers). */
  focusStopNonce?: number;
  /** Mobile explore embed: vertical offset when focusing a dorm (negative = shift map up). Never uses map padding. */
  embedMobileFocusOffsetY?: number;
  /** Mobile explore embed: floating transit preview card instead of Mapbox popups. */
  onBusStopClick?: (stop: BusStop) => void;
  onPogohClick?: (station: PogohStation) => void;
  onMapBackgroundClick?: () => void;
  /** e.g. bus-123 or pogoh-456 - highlights the active transit pin on mobile explore. */
  selectedTransitKey?: string | null;
  onDormClick: (dorm: Dorm) => void;
}

function parseRate(rate: string | number | null | undefined): number {
  if (typeof rate === 'number') return Number.isFinite(rate) ? rate : 0;
  if (typeof rate === 'string') {
    const cleaned = rate.replace(/[^0-9.]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : Math.round(parsed);
  }
  return 0;
}

const formatDirection = (dir: string | null | undefined): string => {
  if (!dir || !String(dir).trim()) return '';
  const s = String(dir).toUpperCase();
  if (s.includes('IB')) return 'Inbound';
  if (s.includes('OB')) return 'Outbound';
  return String(dir);
};

const formatServiceDays = (days: string | null | undefined): string => {
  if (!days) return '';
  return String(days)
    .replace(/WD/g, 'Weekday')
    .replace(/WK/g, 'Weekday')
    .replace(/SA/g, 'Saturday')
    .replace(/SU/g, 'Sunday');
};

/** Resolve map dorm (e.g. "Bouquet Gardens A") to grouped dorm ("Bouquet Gardens") for detail view. */
function resolveToGroupedDorm(mapDorm: Dorm, groupedDorms: Dorm[]): Dorm {
  const name = mapDorm.name ?? '';
  if (name && name !== 'Bouquet Gardens' && name.startsWith('Bouquet Gardens')) {
    const bg = groupedDorms.find((d) => d.name === 'Bouquet Gardens');
    return bg ?? mapDorm;
  }
  return groupedDorms.find((d) => d.name === name) ?? mapDorm;
}

export function MapView({
  dorms,
  mapDorms,
  focusDormId,
  focusNonce = 0,
  highlightedDormId,
  hoverPeekDormId,
  embedMode,
  filteredDorms,
  embedShowBusStops,
  embedShowPogoh,
  embedShowBusLines,
  embedSelectedRoutes,
  onBusRoutesLoaded,
  onBusStopsLoaded,
  embedFocusStop,
  focusStopNonce = 0,
  embedMobileFocusOffsetY,
  onBusStopClick,
  onPogohClick,
  onMapBackgroundClick,
  selectedTransitKey,
  onDormClick,
}: MapViewProps) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { university } = useUniversity();
  const campusCenter = university.campusCenter;
  const campusCenterRef = useRef(campusCenter);
  campusCenterRef.current = campusCenter;
  const modalOverlay = useModalOverlay();
  const embedFocusOffsetYRef = useRef(0);
  embedFocusOffsetYRef.current = embedMobileFocusOffsetY ?? 0;
  const embedMobileCameraResetRef = useRef(false);
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const { styleUrl } = useMapboxTheme();
  const styleUrlRef = useRef(styleUrl);
  styleUrlRef.current = styleUrl;
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const hoverPopupRef = useRef<mapboxgl.Popup | null>(null);
  const hoverLeaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mouseInPopupRef = useRef(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (isMobile && modalOverlay) {
      modalOverlay.setHideBottomNav(filterOpen);
      return () => { modalOverlay.setHideBottomNav(false); };
    }
  }, [filterOpen, isMobile, modalOverlay]);
  const [suggestions, setSuggestions] = useState<Dorm[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchContainerRefDesktop = useRef<HTMLDivElement>(null);
  const [studentFilter, setStudentFilter] = useState<'all' | 'first-year' | 'upperclass'>('all');
  const [acOnly, setAcOnly] = useState(false);
  const [showBusStopsInternal, setShowBusStopsInternal] = useState(false);
  const [showBusLinesInternal, setShowBusLinesInternal] = useState(true);
  const [busRouteFilter, setBusRouteFilter] = useState('');
  const [maxRate, setMaxRate] = useState<number>(8000);
  const [mapReady, setMapReady] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
  const busStopPopupRef = useRef<mapboxgl.Popup | null>(null);
  const [showPogohInternal, setShowPogohInternal] = useState(false);
  const pogohPopupRef = useRef<mapboxgl.Popup | null>(null);
  const [showRouteSuggestions, setShowRouteSuggestions] = useState(false);
  const { busStops, pogohStations, availableBusRoutes } = useTransitData();

  const dismissDormHoverPopup = useCallback(() => {
    if (hoverLeaveTimeoutRef.current) {
      clearTimeout(hoverLeaveTimeoutRef.current);
      hoverLeaveTimeoutRef.current = null;
    }
    mouseInPopupRef.current = false;
    hoverPopupRef.current?.remove();
    hoverPopupRef.current = null;
  }, []);

  useEffect(() => {
    if (embedMode) dismissDormHoverPopup();
  }, [embedMode, dismissDormHoverPopup]);

  const showBusStops = embedMode && embedShowBusStops !== undefined ? embedShowBusStops : showBusStopsInternal;
  const showPogoh = embedMode && embedShowPogoh !== undefined ? embedShowPogoh : showPogohInternal;
  const showBusLines = embedMode && embedShowBusLines !== undefined ? embedShowBusLines : showBusLinesInternal;

  useEffect(() => {
    if (onBusRoutesLoaded && availableBusRoutes.length > 0) {
      onBusRoutesLoaded(availableBusRoutes);
    }
  }, [availableBusRoutes, onBusRoutesLoaded]);

  useEffect(() => {
    if (onBusStopsLoaded && busStops.length > 0) {
      onBusStopsLoaded(busStops);
    }
  }, [busStops, onBusStopsLoaded]);

  // Fly to a stop picked from the transit search. Nonce forces a re-run on re-select.
  useEffect(() => {
    if (!embedFocusStop || !map.current || !mapReady) return;
    const { lng, lat } = embedFocusStop;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    if (embedMode && isMobile) {
      panToCenter(lng, lat, 400);
      return;
    }
    map.current.flyTo({ center: [lng, lat], zoom: 16.5, duration: 600, essential: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedFocusStop?.lng, embedFocusStop?.lat, focusStopNonce, mapReady]);

  const dormSource = mapDorms ?? dorms;

  // When embedMode + filteredDorms is provided (including []): map pins must match the list - empty list => no pins.
  const filteredForMap = useMemo(() => {
    if (embedMode && filteredDorms !== undefined) {
      if (filteredDorms.length === 0) {
        return [];
      }
      const filteredIds = new Set(filteredDorms.map((d) => d.id));
      const filteredNames = new Set(filteredDorms.map((d) => (d.name ?? '').trim()).filter(Boolean));
      const source = mapDorms && mapDorms.length > 0 ? mapDorms : filteredDorms;
      return source.filter((d) => {
        if (typeof d.latitude !== 'number' || typeof d.longitude !== 'number' || !Number.isFinite(d.latitude) || !Number.isFinite(d.longitude)) return false;
        if (filteredIds.has(d.id)) return true;
        const grouped = mapDorms && mapDorms.length > 0 ? resolveToGroupedDorm(d, dorms) : d;
        return filteredIds.has(grouped.id) || (grouped.name && filteredNames.has((grouped.name ?? '').trim()));
      });
    }
    const query = searchQuery.trim().toLowerCase();
    return dormSource.filter((d) => {
      const lat = d.latitude;
      const lng = d.longitude;
      if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
      if (query && !(d.name ?? '').toLowerCase().includes(query)) return false;
      if (studentFilter === 'first-year' && d.audienceType !== 'Freshman') return false;
      if (studentFilter === 'upperclass' && d.audienceType !== 'Upperclassman') return false;
      if (acOnly && !d.heat_and_air_conditioning) return false;
      // Max Rate Filter (Handling 'semester' vs 'month' rent_period)
      if (maxRate != null && maxRate < 8000) {
        // Safely parse the rate into a number (returns 0 if invalid/empty)
        const baseRate = parseRate(d.semesterRate);

        // If the rate is 0 or missing, we should hide it because it doesn't match the user's strict budget filter
        if (baseRate <= 0) return false;

        let termEquivalentRate = baseRate;

        // If it's priced by the month, multiply by 4 to get the semester equivalent
        const period = String(d.rent_period ?? d.rentPeriod ?? '').trim().toLowerCase();
        if (period === 'month') {
          termEquivalentRate = baseRate * 4;
        }

        // If the semester-equivalent rate is too expensive, hide it
        if (termEquivalentRate > maxRate) {
          return false;
        }
      }
      return true;
    });
  }, [embedMode, filteredDorms, dormSource, dorms, mapDorms, searchQuery, studentFilter, acOnly, maxRate]);

  // Dedupe by coordinates so we show one pin per unique location (e.g. one for Bouquet Gardens J even if two rows share coords)
  const uniqueLocations = useMemo(() => {
    const seen = new Set<string>();
    return filteredForMap.filter((d) => {
      const lat = d.latitude!;
      const lng = d.longitude!;
      const key = `${lat}-${lng}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [filteredForMap]);

  // Resolve focusDormId to the dorm we'll fly to (match by id, URL slug from name, or grouped residence)
  const focusedDorm = useMemo(() => {
    if (!focusDormId?.trim()) return null;
    const focus = focusDormId.trim();
    const byId = dormSource.find((d) => d.id === focus) ?? dorms.find((d) => d.id === focus);
    if (byId) return byId;
    const bySlugOnMap = dormSource.find((d) => dormSlugFromName(d.name ?? '') === focus);
    if (bySlugOnMap) return bySlugOnMap;
    const groupedBySlug = findDormBySlugInList(dorms, focus);
    if (groupedBySlug) {
      const fromMap = dormSource.find((d) => resolveToGroupedDorm(d, dorms).id === groupedBySlug.id);
      if (fromMap && typeof fromMap.latitude === 'number' && typeof fromMap.longitude === 'number') {
        return fromMap;
      }
      if (typeof groupedBySlug.latitude === 'number' && typeof groupedBySlug.longitude === 'number') {
        return groupedBySlug;
      }
    }
    return null;
  }, [focusDormId, dormSource, dorms]);

  const getPinColor = useCallback((category: PinCategory) => PIN_COLORS[category], []);

  const flyToDorm = useCallback((dorm: Dorm) => {
    const lng = dorm.longitude;
    const lat = dorm.latitude;
    if (typeof lng === 'number' && typeof lat === 'number' && Number.isFinite(lng) && Number.isFinite(lat) && map.current) {
      map.current.flyTo({
        center: [lng, lat],
        zoom: 17,
        duration: 800,
      });
    }
  }, []);

  const mobileEmbedPreview = embedMode && isMobile;

  /** Pan-only recenter (no zoom, no padding). Used for mobile explore housing + transit taps. */
  const panToCenter = useCallback(
    (lng: number, lat: number, duration = 400) => {
      if (!map.current || !Number.isFinite(lng) || !Number.isFinite(lat)) return;
      const mapInstance = map.current;
      const offsetY = mobileEmbedPreview ? embedFocusOffsetYRef.current : 0;
      mapInstance.easeTo({
        center: [lng, lat],
        ...(offsetY !== 0 ? { offset: [0, offsetY] as [number, number] } : {}),
        duration,
      });
    },
    [mobileEmbedPreview],
  );

  // Hover popup: "View Details" button navigates to /campus/:slug (Explore dorm detail, same as campus list).
  const createDormMarker = useCallback(
    (dorm: Dorm) => {
      const isFocused =
        focusedDorm !== null &&
        (dorm.id === focusedDorm.id ||
          (dorm.latitude === focusedDorm.latitude && dorm.longitude === focusedDorm.longitude));
      const isHighlighted = !!highlightedDormId && (
        dorm.id === highlightedDormId ||
        (mapDorms && dorms.some((g) => g.id === highlightedDormId) && (dorm.name === dorms.find((g) => g.id === highlightedDormId)?.name || (dorm.name ?? '').startsWith((dorms.find((g) => g.id === highlightedDormId)?.name ?? '') + ' ')))
      );

      const color = getPinColor(getDormPinCategory(dorm));
      // Mobile explore: emphasize only explicit selection (highlightedDormId), not focus fly-to.
      const isActive = mobileEmbedPreview ? isHighlighted : isFocused || isHighlighted;
      const pinFill = isActive ? darkenPinColor(color) : color;
      const pinW = isActive ? 34 : 26;
      const pinH = isActive ? 44 : 34;

      // Outer container: Mapbox controls position; anchor bottom so pin tip sits on the coordinate.
      const el = document.createElement('div');
      el.className = 'building-marker';
      el.title = dorm.name ?? 'Residence Hall';
      el.style.width = `${pinW}px`;
      el.style.height = `${pinH}px`;
      el.style.display = 'flex';
      el.style.alignItems = 'flex-end';
      el.style.justifyContent = 'center';
      el.style.cursor = 'pointer';
      if (mobileEmbedPreview) applyMobileEmbedMarkerHitTarget(el);

      // Inner container: we animate this so we never overwrite Mapbox's transform on el.
      const iconWrapper = document.createElement('div');
      iconWrapper.style.width = '100%';
      iconWrapper.style.height = '100%';
      iconWrapper.style.display = 'flex';
      iconWrapper.style.alignItems = 'flex-end';
      iconWrapper.style.justifyContent = 'center';
      iconWrapper.style.transition = 'transform 0.2s ease-out';
      iconWrapper.style.transformOrigin = 'center bottom';
      iconWrapper.style.pointerEvents = 'none';
      if (isActive) iconWrapper.style.transform = 'scale(1.18) translateY(-3px)';

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', String(pinW));
      svg.setAttribute('height', String(pinH));
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('preserveAspectRatio', 'xMidYMax meet');
      svg.style.display = 'block';
      svg.style.filter = isActive
        ? 'drop-shadow(0 4px 10px rgba(15, 23, 42, 0.45)) drop-shadow(0 0 0 3px rgba(255, 255, 255, 0.95))'
        : 'drop-shadow(0 1px 3px rgba(15, 23, 42, 0.28))';
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z');
      path.setAttribute('fill', pinFill);
      path.setAttribute('stroke', '#ffffff');
      path.setAttribute('stroke-width', isActive ? '2.5' : '1.25');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
      // White house glyph in the pin head so housing is unmistakable at a glance
      // vs the transit circles (bus/POGOH). Silhouette with a slight roof overhang.
      const house = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      house.setAttribute(
        'd',
        'M12 6.6 L16 9.8 L14.6 9.8 L14.6 12.4 L9.4 12.4 L9.4 9.8 L8 9.8 Z',
      );
      house.setAttribute('fill', '#ffffff');
      house.setAttribute('opacity', '0.95');
      svg.appendChild(house);
      iconWrapper.appendChild(svg);
      el.appendChild(iconWrapper);

      // Desktop highlight (card hover / marker tap): a name pill above the pin
      // confirms which list card this pin belongs to. Mobile uses the carousel.
      if (isHighlighted && !mobileEmbedPreview) {
        const namePill = document.createElement('div');
        namePill.className = 'dorm-marker-namepill';
        namePill.textContent = dorm.name ?? 'Residence Hall';
        el.appendChild(namePill);
      }

      el.addEventListener('mouseenter', () => {
        iconWrapper.style.transform = 'scale(1.18) translateY(-3px)';
      });
      el.addEventListener('mouseleave', () => {
        if (!isHighlighted) {
          iconWrapper.style.transform = isActive ? 'scale(1.18) translateY(-3px)' : 'scale(1) translateY(0)';
        }
      });

      const handleViewDetails = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        hoverPopupRef.current?.remove();
        hoverPopupRef.current = null;
        const toPass = mapDorms ? resolveToGroupedDorm(dorm, dorms) : dorm;
        navigate(`/campus/${dormSlugFromName(toPass.name)}`);
      };

      const showHoverPopup = () => {
        if (embedMode) return;
        if (hoverLeaveTimeoutRef.current) {
          clearTimeout(hoverLeaveTimeoutRef.current);
          hoverLeaveTimeoutRef.current = null;
        }
        mouseInPopupRef.current = false;
        hoverPopupRef.current?.remove();
        const wrap = document.createElement('div');
        wrap.className = 'map-popup-wrap';
        wrap.style.minWidth = '220px';
        wrap.style.maxWidth = '280px';
        wrap.style.overflow = 'hidden';
        wrap.style.borderRadius = '12px';
        const img = document.createElement('img');
        img.alt = dorm.name ?? 'Dorm';
        img.src = safeImageSrc(dorm.image) ?? DORM_PLACEHOLDER_IMAGE;
        img.style.width = '100%';
        img.style.height = '120px';
        img.style.objectFit = 'cover';
        img.style.display = 'block';
        wrap.appendChild(img);
        const body = document.createElement('div');
        body.className = 'map-popup-body';
        const title = document.createElement('a');
        title.href = '#';
        title.className = 'map-popup-title-link';
        title.textContent = dorm.name ?? 'Residence Hall';
        title.addEventListener('click', handleViewDetails);
        body.appendChild(title);
        const rateEl = document.createElement('div');
        rateEl.className = 'map-popup-subtext';
        const periodStr = String(dorm.rent_period ?? dorm.rentPeriod ?? '').trim().toLowerCase();
        const periodLabel = periodStr === 'month' ? 'month' : 'term';
        rateEl.textContent = dorm.semesterRate
          ? `From $${dorm.semesterRate.toLocaleString()} / ${periodLabel}`
          : 'Rate not published';
        body.appendChild(rateEl);
        const btnWrap = document.createElement('div');
        btnWrap.className = 'map-popup-btn-wrap';
        const btn = document.createElement('a');
        btn.href = '#';
        btn.textContent = 'View Details';
        btn.className = 'map-popup-action-btn';
        btn.addEventListener('click', handleViewDetails);
        btnWrap.appendChild(btn);
        body.appendChild(btnWrap);
        wrap.appendChild(body);

        wrap.addEventListener('mouseenter', () => {
          mouseInPopupRef.current = true;
          if (hoverLeaveTimeoutRef.current) {
            clearTimeout(hoverLeaveTimeoutRef.current);
            hoverLeaveTimeoutRef.current = null;
          }
        });
        wrap.addEventListener('mouseleave', () => {
          mouseInPopupRef.current = false;
          hoverPopupRef.current?.remove();
          hoverPopupRef.current = null;
        });

        const popup = new mapboxgl.Popup({ offset: 12, closeButton: false, closeOnClick: true })
          .setLngLat([dorm.longitude!, dorm.latitude!])
          .setDOMContent(wrap)
          .addTo(map.current!);
        hoverPopupRef.current = popup;
      };

      const hideHoverPopup = () => {
        if (hoverLeaveTimeoutRef.current) return;
        hoverLeaveTimeoutRef.current = setTimeout(() => {
          hoverLeaveTimeoutRef.current = null;
          if (!mouseInPopupRef.current) {
            hoverPopupRef.current?.remove();
            hoverPopupRef.current = null;
          }
        }, 150);
      };

      el.addEventListener('mouseenter', () => {
        iconWrapper.style.transform = 'scale(1.18) translateY(-3px)';
      });
      el.addEventListener('mouseleave', () => {
        if (!isHighlighted) {
          iconWrapper.style.transform = isActive ? 'scale(1.18) translateY(-3px)' : 'scale(1) translateY(0)';
        }
      });
      if (!embedMode) {
        el.addEventListener('mouseenter', showHoverPopup);
        el.addEventListener('mouseleave', hideHoverPopup);
      }

      bindMarkerTap(
        el,
        () => {
          dismissDormHoverPopup();
          const forList =
            mapDorms && mapDorms.length > 0 ? resolveToGroupedDorm(dorm, dorms) : dorm;
          onDormClick(forList);
        },
        mobileEmbedPreview,
      );

      return el;
    },
    [
      getPinColor,
      navigate,
      mapDorms,
      dorms,
      focusedDorm,
      highlightedDormId,
      onDormClick,
      embedMode,
      mobileEmbedPreview,
      dismissDormHoverPopup,
    ]
  );

  const showBusStopPopup = useCallback((stop: BusStop, lon: number, lat: number) => {
    if (!map.current) return;
    busStopPopupRef.current?.remove();
    busStopPopupRef.current = null;

    const wrap = document.createElement('div');
    wrap.className = 'map-popup-wrap bus-stop-popup';
    wrap.style.minWidth = '200px';
    wrap.style.padding = '12px 14px';
    wrap.style.borderRadius = '12px';

    const title = document.createElement('div');
    title.className = 'map-popup-title-lg';
    title.textContent = stop.stop_name ?? 'Bus Stop';
    wrap.appendChild(title);

    const dirFormatted = formatDirection(stop.direction);
    if (dirFormatted) {
      const subHeader = document.createElement('div');
      subHeader.className = 'map-popup-subtext';
      subHeader.style.marginBottom = '6px';
      subHeader.textContent = dirFormatted;
      wrap.appendChild(subHeader);
    }

    const routesLabel = document.createElement('div');
    routesLabel.className = 'map-popup-muted-label';
    routesLabel.textContent = 'Routes:';
    wrap.appendChild(routesLabel);

    const routesContainer = document.createElement('div');
    routesContainer.style.display = 'flex';
    routesContainer.style.gap = '4px';
    routesContainer.style.flexWrap = 'wrap';
    routesContainer.style.marginBottom = '8px';

    const routeItems = stop.routes
      ? String(stop.routes).split(',').map((r) => r.trim()).filter(Boolean)
      : [];
    if (routeItems.length > 0) {
      routeItems.forEach((route) => {
        const badge = document.createElement('span');
        badge.style.backgroundColor = PITT_BLUE;
        badge.style.color = 'white';
        badge.style.padding = '2px 6px';
        badge.style.borderRadius = '4px';
        badge.style.fontSize = '11px';
        badge.style.fontWeight = 'bold';
        badge.textContent = route;
        routesContainer.appendChild(badge);
      });
    } else {
      const noRoutes = document.createElement('span');
      noRoutes.className = 'map-popup-subtext';
      noRoutes.textContent = 'No routes listed';
      routesContainer.appendChild(noRoutes);
    }
    wrap.appendChild(routesContainer);

    if (stop.svc_days) {
      const svcPill = document.createElement('div');
      svcPill.className = 'map-popup-muted-pill';
      svcPill.textContent = `Runs: ${formatServiceDays(stop.svc_days)}`;
      wrap.appendChild(svcPill);
    }

    const popup = new mapboxgl.Popup({ offset: 12, closeButton: true, closeOnClick: true })
      .setLngLat([lon, lat])
      .setDOMContent(wrap)
      .addTo(map.current);
    busStopPopupRef.current = popup;
    popup.on('close', () => {
      busStopPopupRef.current = null;
    });
  }, []);

  const showPogohPopup = useCallback((station: PogohStation, lon: number, lat: number) => {
    if (!map.current) return;
    pogohPopupRef.current?.remove();
    pogohPopupRef.current = null;

    const wrap = document.createElement('div');
    wrap.className = 'map-popup-wrap pogoh-station-popup';
    wrap.style.minWidth = '200px';
    wrap.style.padding = '12px 14px';
    wrap.style.borderRadius = '12px';

    const title = document.createElement('div');
    title.className = 'map-popup-title-lg';
    title.textContent = station.Name ?? 'Pogoh Station';
    wrap.appendChild(title);

    const svcPill = document.createElement('div');
    svcPill.className = 'map-popup-muted-pill';
    svcPill.textContent = `Total Docks: ${station['Total Docks']}`;
    wrap.appendChild(svcPill);

    const popup = new mapboxgl.Popup({ offset: 12, closeButton: true, closeOnClick: true })
      .setLngLat([lon, lat])
      .setDOMContent(wrap)
      .addTo(map.current);
    pogohPopupRef.current = popup;
    popup.on('close', () => {
      pogohPopupRef.current = null;
    });
  }, []);

  const dismissTransitPopups = useCallback(() => {
    busStopPopupRef.current?.remove();
    busStopPopupRef.current = null;
    pogohPopupRef.current?.remove();
    pogohPopupRef.current = null;
  }, []);

  const handleLayerBusStopClick = useCallback(
    (stop: BusStop, [lon, lat]: [number, number]) => {
      dismissTransitPopups();
      if (mobileEmbedPreview && onBusStopClick) {
        onBusStopClick(stop);
        panToCenter(lon, lat, 400);
        return;
      }
      showBusStopPopup(stop, lon, lat);
    },
    [dismissTransitPopups, mobileEmbedPreview, onBusStopClick, panToCenter, showBusStopPopup],
  );

  const handleLayerPogohClick = useCallback(
    (station: PogohStation, [lon, lat]: [number, number]) => {
      dismissTransitPopups();
      if (mobileEmbedPreview && onPogohClick) {
        onPogohClick(station);
        panToCenter(lon, lat, 400);
        return;
      }
      showPogohPopup(station, lon, lat);
    },
    [dismissTransitPopups, mobileEmbedPreview, onPogohClick, panToCenter, showPogohPopup],
  );

  const handleLayerRouteClick = useCallback(
    (route: RouteFeatureProps, [lon, lat]: [number, number]) => {
      if (!map.current || mobileEmbedPreview) return;
      dismissTransitPopups();
      const wrap = document.createElement('div');
      wrap.className = 'map-popup-wrap bus-route-popup';
      wrap.style.padding = '10px 12px';
      wrap.style.borderRadius = '12px';
      const title = document.createElement('div');
      title.className = 'map-popup-title-lg';
      title.style.display = 'flex';
      title.style.alignItems = 'center';
      title.style.gap = '6px';
      const swatch = document.createElement('span');
      swatch.style.cssText = `display:inline-block;width:14px;height:5px;border-radius:9999px;background:${route.color};`;
      title.appendChild(swatch);
      title.appendChild(document.createTextNode(route.route));
      wrap.appendChild(title);
      const sub = document.createElement('div');
      sub.className = 'map-popup-subtext';
      sub.textContent = route.long_name;
      wrap.appendChild(sub);
      const popup = new mapboxgl.Popup({ offset: 8, closeButton: true, closeOnClick: true })
        .setLngLat([lon, lat])
        .setDOMContent(wrap)
        .addTo(map.current);
      busStopPopupRef.current = popup;
      popup.on('close', () => {
        if (busStopPopupRef.current === popup) busStopPopupRef.current = null;
      });
    },
    [dismissTransitPopups, mobileEmbedPreview],
  );

  // Route filter feeding the shared layer: embed mode gets the multi-select
  // from MapMiniFilterBar; the standalone /map keeps its single-route text box.
  const layerSelectedRoutes = useMemo(() => {
    if (embedMode) return embedSelectedRoutes ?? [];
    const r = busRouteFilter.trim().toUpperCase();
    return r ? [r] : [];
  }, [embedMode, embedSelectedRoutes, busRouteFilter]);

  // Shared native transit layers (route lines + clustered stops + POGOH) -
  // replaces the old one-DOM-marker-per-stop overlays.
  useTransitLayers(map, mapReady, {
    busStops,
    pogohStations,
    showBusLines,
    showBusStops,
    showPogoh,
    selectedRoutes: layerSelectedRoutes,
    selectedTransitKey,
    onBusStopClick: handleLayerBusStopClick,
    onPogohClick: handleLayerPogohClick,
    onRouteClick: handleLayerRouteClick,
  });

  // Init map once
  useEffect(() => {
    if (!mapContainer.current || map.current) return;
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!token) return;

    mapboxgl.accessToken = token;

    const mapInstance = new mapboxgl.Map({
      container: mapContainer.current,
      style: styleUrlRef.current,
      center: campusCenterRef.current,
      zoom: DEFAULT_ZOOM,
      antialias: true,
    });

    map.current = mapInstance;

    mapInstance.on('load', () => {
      setMapReady(true);
      mapInstance.resize();
    });

    return () => {
      setMapReady(false);
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      hoverPopupRef.current?.remove();
      hoverPopupRef.current = null;
      busStopPopupRef.current?.remove();
      busStopPopupRef.current = null;
      pogohPopupRef.current?.remove();
      pogohPopupRef.current = null;
      if (hoverLeaveTimeoutRef.current) {
        clearTimeout(hoverLeaveTimeoutRef.current);
        hoverLeaveTimeoutRef.current = null;
      }
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Swap base style on theme change (DOM markers/popups survive; the native
  // transit layers are re-added by useTransitLayers on style.load). Skip the
  // initial run - the map is created with the current style, and a redundant
  // setStyle mid-load churns the style and wipes freshly added layers.
  const mountedStyleRef = useRef(styleUrl);
  useEffect(() => {
    if (!map.current || styleUrl === mountedStyleRef.current) return;
    mountedStyleRef.current = styleUrl;
    map.current.setStyle(styleUrl);
  }, [styleUrl]);

  // Recenter when the resolved university changes after init - the profile
  // (and thus campusCenter) can resolve after the map mounts with the default.
  useEffect(() => {
    if (!map.current || !mapReady || focusDormId?.trim()) return;
    map.current.jumpTo({ center: campusCenter, zoom: DEFAULT_ZOOM });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campusCenter[0], campusCenter[1], mapReady]);

  // Mobile explore embed: pinch to zoom; standalone /map and desktop embed keep +/- controls.
  useEffect(() => {
    if (!map.current || !mapReady || (embedMode && isMobile)) return;

    const control = new mapboxgl.NavigationControl({ showCompass: false });
    map.current.addControl(control, 'bottom-right');
    return () => {
      map.current?.removeControl(control);
    };
  }, [embedMode, isMobile, mapReady]);

  // Mobile explore embed: block scroll-wheel zoom drift; pinch via touchZoomRotate stays enabled.
  useEffect(() => {
    if (!map.current || !mapReady || !embedMode || !isMobile) return;
    const mapInstance = map.current;
    mapInstance.scrollZoom.disable();
    mapInstance.doubleClickZoom.disable();
    mapInstance.setMinZoom(MOBILE_EMBED_MIN_ZOOM);
    return () => {
      mapInstance.scrollZoom.enable();
      mapInstance.doubleClickZoom.enable();
      mapInstance.setMinZoom(0);
    };
  }, [embedMode, isMobile, mapReady]);

  // Mobile explore embed: clear any sticky global padding and restore campus zoom once layout is real.
  // Prior flyTo({ padding }) calls left retainPadding=true padding on the instance; without focus set
  // that padding never cleared, making the default peek view look metro-wide.
  useEffect(() => {
    if (!map.current || !mapReady || !embedMode || !isMobile) return;
    const mapInstance = map.current;
    const container = mapContainer.current;
    if (!container) return;

    const applyDefaultCampusCamera = () => {
      if (focusDormId?.trim()) return;
      if (container.clientHeight < 80) return;
      mapInstance.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
      mapInstance.jumpTo({ center: campusCenterRef.current, zoom: DEFAULT_ZOOM });
      embedMobileCameraResetRef.current = true;
    };

    if (!embedMobileCameraResetRef.current) {
      applyDefaultCampusCamera();
    }

    const ro = new ResizeObserver(() => {
      mapInstance.resize();
      if (!embedMobileCameraResetRef.current) {
        applyDefaultCampusCamera();
      }
    });
    ro.observe(container);
    return () => {
      ro.disconnect();
      embedMobileCameraResetRef.current = false;
    };
  }, [embedMode, isMobile, mapReady, focusDormId]);

  // Mobile explore embed: tap empty map to dismiss floating transit preview.
  useEffect(() => {
    if (!map.current || !mapReady || !mobileEmbedPreview || !onMapBackgroundClick) return;
    const mapInstance = map.current;
    const handleMapClick = () => {
      onMapBackgroundClick();
    };
    mapInstance.on('click', handleMapClick);
    return () => {
      mapInstance.off('click', handleMapClick);
    };
  }, [mapReady, mobileEmbedPreview, onMapBackgroundClick]);

  // Sync markers with data
  useEffect(() => {
    if (!map.current || !mapReady) return;

    const mapInstance = map.current;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    uniqueLocations.forEach((dorm) => {
      if (typeof dorm.longitude !== 'number' || typeof dorm.latitude !== 'number') return;

      const el = createDormMarker(dorm);

      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([dorm.longitude, dorm.latitude])
        .addTo(mapInstance);

      markersRef.current.push(marker);
    });
  }, [uniqueLocations, mapReady, createDormMarker]);

  // Desktop embed: "smart pan" on list-card hover. The highlight already pops the
  // pin; here we only MOVE the map when the hovered pin is off-screen, so scanning
  // a list of visible pins never jerks the map. Debounced to avoid thrash while the
  // cursor sweeps down the list.
  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !mapReady || !embedMode || isMobile) return;
    const id = hoverPeekDormId?.trim();
    if (!id) return;
    // Don't fight an in-progress "Show on map" fly-to.
    if (focusDormId?.trim()) return;
    const dorm =
      dormSource.find((d) => d.id === id) ??
      dorms.find((d) => d.id === id) ??
      dormSource.find((d) => dormSlugFromName(d.name ?? '') === id);
    const lng = dorm?.longitude;
    const lat = dorm?.latitude;
    if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat)) return;

    const timer = window.setTimeout(() => {
      if (!map.current) return;
      // Already visible -> the pin emphasis is enough; leave the map still.
      if (map.current.getBounds().contains([lng, lat])) return;
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      map.current.easeTo({ center: [lng, lat], duration: reduce ? 0 : 500 });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [hoverPeekDormId, mapReady, embedMode, isMobile, focusDormId, dormSource, dorms]);

  // Focus param: fly to dorm, show popup. Runs every time focusDormId or focusNonce changes (ensures re-click works).
  useEffect(() => {
    if (!focusDormId?.trim() || !focusedDorm || !map.current || !mapReady) return;

    const d = focusedDorm;
    const lng = d.longitude;
    const lat = d.latitude;
    if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat)) return;

    dismissDormHoverPopup();

    // Mobile explore: pan-only recenter (marker tap + carousel swipe). Never change zoom.
    if (embedMode && isMobile) {
      panToCenter(lng, lat, 400);
      return;
    }

    const flyToFocusedDorm = (zoom: number, duration: number, _phase: string) => {
      map.current!.flyTo({
        center: [lng, lat],
        zoom,
        duration,
        essential: true,
      });
    };

    flyToFocusedDorm(17.2, 300, 'phase1-bounce');
    const t = window.setTimeout(() => {
      flyToFocusedDorm(17, 400, 'phase2-settle');
    }, 320);

    if (embedMode) {
      return () => {
        window.clearTimeout(t);
      };
    }

    const handleViewDetails = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      hoverPopupRef.current?.remove();
      hoverPopupRef.current = null;
      navigate(`/campus/${dormSlugFromName(d.name)}`);
    };

    const wrap = document.createElement('div');
    wrap.className = 'map-popup-wrap';
    wrap.style.minWidth = '220px';
    wrap.style.maxWidth = '280px';
    wrap.style.overflow = 'hidden';
    wrap.style.borderRadius = '12px';
    const img = document.createElement('img');
    img.alt = d.name ?? 'Dorm';
    img.src = safeImageSrc(d.image) ?? DORM_PLACEHOLDER_IMAGE;
    img.style.width = '100%';
    img.style.height = '120px';
    img.style.objectFit = 'cover';
    img.style.display = 'block';
    wrap.appendChild(img);
    const body = document.createElement('div');
    body.className = 'map-popup-body';
    const title = document.createElement('div');
    title.className = 'map-popup-title';
    title.textContent = d.name ?? 'Residence Hall';
    body.appendChild(title);
    const rateEl = document.createElement('div');
    rateEl.className = 'map-popup-subtext';
    const periodStr = String(d.rent_period ?? d.rentPeriod ?? '').trim().toLowerCase();
    const periodLabel = periodStr === 'month' ? 'month' : 'term';
    rateEl.textContent = d.semesterRate ? `From $${d.semesterRate} / ${periodLabel}` : ' - ';
    body.appendChild(rateEl);
    const btnWrap = document.createElement('div');
    btnWrap.className = 'map-popup-btn-wrap';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'View Details';
    btn.className = 'map-popup-action-btn';
    btn.addEventListener('click', handleViewDetails);
    btnWrap.appendChild(btn);
    body.appendChild(btnWrap);
    wrap.appendChild(body);

    const popup = new mapboxgl.Popup({ offset: 12, closeButton: false, closeOnClick: true })
      .setLngLat([lng, lat])
      .setDOMContent(wrap)
      .addTo(map.current);
    hoverPopupRef.current = popup;

    return () => {
      window.clearTimeout(t);
    };
  }, [
    focusDormId,
    focusNonce,
    focusedDorm,
    mapReady,
    mapDorms,
    dorms,
    navigate,
    embedMode,
    isMobile,
    dismissDormHoverPopup,
    panToCenter,
  ]);

  // Auto-zoom when search matches exactly one building
  useEffect(() => {
    if (!map.current || !mapReady) return;
    if (!searchQuery.trim()) return;
    if (uniqueLocations.length === 1) {
      const d = uniqueLocations[0];
      if (typeof d.longitude === 'number' && typeof d.latitude === 'number') {
        map.current.flyTo({
          center: [d.longitude, d.latitude],
          zoom: 17,
          duration: 800,
        });
      }
    }
  }, [searchQuery, uniqueLocations, mapReady]);

  // Click outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const inside = searchContainerRef.current?.contains(target) || searchContainerRefDesktop.current?.contains(target);
      if (!inside) setShowSuggestions(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const hasValidToken = !!MAPBOX_PUBLIC_TOKEN;

  if (!hasValidToken) {
    return (
      <div className="h-full w-full overflow-hidden flex items-center justify-center bg-muted overscroll-none">
        <div className="text-center p-8 bg-card/90 backdrop-blur-md rounded-2xl shadow-overlay">
          <MapPin className="w-10 h-10 mx-auto mb-3 text-secondary" />
          <p className="font-semibold text-foreground">Mapbox Token Required</p>
          <p className="text-sm text-muted-foreground mt-1">Add VITE_MAPBOX_TOKEN to .env</p>
        </div>
      </div>
    );
  }

  const filterPanelContent = (idSuffix: string, brandSlate = false) => {
    const labelCls = 'text-sm font-medium text-foreground';
    const segmentActive = 'bg-card text-malachite-800 shadow-raised rounded-full dark:text-malachite-300';
    const segmentInactive = 'text-muted-foreground hover:text-foreground rounded-full';
    const accentColor = brandSlate ? 'accent-malachite-600' : 'accent-[#1e3a5f]';
    const sliderBg = 'bg-muted';
    const switchCls = brandSlate ? 'data-[state=checked]:bg-malachite-600' : '';
    return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className={labelCls}>Student Type</Label>
        <div className="flex w-full rounded-full bg-muted p-1 gap-0">
          <button
            type="button"
            onClick={() => setStudentFilter('all')}
            className={cn(
              'flex-1 rounded-full py-1.5 text-xs font-medium transition-colors',
              studentFilter === 'all' ? segmentActive : segmentInactive
            )}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setStudentFilter('first-year')}
            className={cn(
              'flex-1 rounded-full py-1.5 text-xs font-medium transition-colors',
              studentFilter === 'first-year' ? segmentActive : segmentInactive
            )}
          >
            First-Year
          </button>
          <button
            type="button"
            onClick={() => setStudentFilter('upperclass')}
            className={cn(
              'flex-1 rounded-full py-1.5 text-xs font-medium transition-colors',
              studentFilter === 'upperclass' ? segmentActive : segmentInactive
            )}
          >
            Upperclass
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor={`filter-ac-${idSuffix}`} className={cn(labelCls, 'cursor-pointer')}>
          Only buildings with AC
        </Label>
        <Switch id={`filter-ac-${idSuffix}`} checked={acOnly} onCheckedChange={setAcOnly} className={switchCls} />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor={`filter-buslines-${idSuffix}`} className={cn(labelCls, 'cursor-pointer')}>
          Show Bus Routes
        </Label>
        <Switch id={`filter-buslines-${idSuffix}`} checked={showBusLines} onCheckedChange={setShowBusLinesInternal} className={switchCls} />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor={`filter-bus-${idSuffix}`} className={cn(labelCls, 'cursor-pointer')}>
          Show Bus Stops
        </Label>
        <Switch id={`filter-bus-${idSuffix}`} checked={showBusStops} onCheckedChange={setShowBusStopsInternal} className={switchCls} />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor={`filter-pogoh-${idSuffix}`} className={cn(labelCls, 'cursor-pointer')}>
          Show Pogoh Stations
        </Label>
        <Switch id={`filter-pogoh-${idSuffix}`} checked={showPogoh} onCheckedChange={setShowPogohInternal} className={switchCls} />
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor={`filter-rate-${idSuffix}`} className={labelCls}>
            Max Rate: ${maxRate} / term (approx)
          </Label>
        </div>
        <input
          id={`filter-rate-${idSuffix}`}
          type="range"
          min="3000"
          max="8000"
          step="100"
          value={maxRate}
          onChange={(e) => setMaxRate(Number(e.target.value))}
          className={cn('w-full h-2 rounded-lg appearance-none cursor-pointer', sliderBg, accentColor)}
        />
        <div className={cn('flex justify-between text-[10px] font-medium px-1 text-muted-foreground')}>
          <span>$3,000</span>
          <span>$8,000+</span>
        </div>
      </div>
      {showBusStops && (
        <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-200">
          <Label htmlFor={`filter-bus-route-${idSuffix}`} className={labelCls}>
            Bus Route
          </Label>
          <div className="relative">
            <Input
              id={`filter-bus-route-${idSuffix}`}
              type="text"
              placeholder="Type a route (e.g. 61C)"
              value={busRouteFilter}
              onChange={(e) => {
                setBusRouteFilter(e.target.value.toUpperCase());
                setShowRouteSuggestions(true);
              }}
              onFocus={() => setShowRouteSuggestions(true)}
              onBlur={() => setTimeout(() => setShowRouteSuggestions(false), 200)}
              className="h-9 bg-card text-foreground placeholder:text-muted-foreground uppercase pr-8 border-border"
            />
            {busRouteFilter.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setBusRouteFilter('');
                  setShowRouteSuggestions(false);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                aria-label="Clear route filter"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            {showRouteSuggestions && (
              <ul className="absolute top-full left-0 w-full mt-1 bg-popover rounded-md shadow-overlay max-h-48 overflow-y-auto z-50 border border-border">
                {availableBusRoutes
                  .filter((r) => r.includes(busRouteFilter.toUpperCase()))
                  .map((route) => (
                    <li
                      key={route}
                      className="px-4 py-2 text-sm cursor-pointer text-foreground hover:bg-accent"
                      onClick={() => {
                        setBusRouteFilter(route);
                        setShowRouteSuggestions(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setBusRouteFilter(route);
                          setShowRouteSuggestions(false);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      {route}
                    </li>
                  ))}
                {availableBusRoutes.filter((r) => r.includes(busRouteFilter.toUpperCase())).length === 0 && (
                  <li className="px-4 py-2 text-sm cursor-default text-muted-foreground">No routes found</li>
                )}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
  };

  const campusMapCardContent = (filterIdSuffix: string) => (
    <>
      {/* List / Map View toggle */}
      <div className="flex justify-center sm:justify-start shrink-0 mb-3">
        <div className="flex h-9 w-full sm:w-auto rounded-full bg-muted p-1">
          <button
            type="button"
            onClick={() => navigate('/campus')}
            className={cn(
              'h-full flex-1 sm:flex-initial px-3 rounded-full text-sm font-medium transition-colors',
              'text-muted-foreground hover:text-foreground'
            )}
          >
            List View
          </button>
          <button
            type="button"
            onClick={() => {}}
            className={cn(
              'h-full flex-1 sm:flex-initial px-3 rounded-full text-sm font-medium transition-colors',
              'bg-card text-malachite-800 shadow-raised dark:text-malachite-300'
            )}
          >
            Map View
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold text-sm text-foreground">Campus Map</h2>
        <button
          type="button"
          onClick={() => setShowDetails((prev) => !prev)}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          aria-label={showDetails ? 'Hide details' : 'Show details'}
        >
          {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>
      <div
        className={cn(
          'grid transition-all duration-300 ease-in-out',
          showDetails ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="relative mt-2">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />
        <Input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => {
            const value = e.target.value;
            setSearchQuery(value);
            const q = value.trim().toLowerCase();
            if (q) {
              const matches = dormSource.filter((d) => (d.name ?? '').toLowerCase().includes(q));
              const seenNames = new Set<string>();
              const uniqueSuggestions = matches.filter((d) => {
                const name = d.name ?? '';
                if (seenNames.has(name)) return false;
                seenNames.add(name);
                return true;
              });
              setSuggestions(uniqueSuggestions);
              setShowSuggestions(true);
            } else {
              setSuggestions([]);
              setShowSuggestions(false);
            }
          }}
          className={cn('h-9 text-sm border-border rounded-md w-full pl-9 bg-card', searchQuery.length > 0 && 'pr-9')}
        />
        {searchQuery.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setSuggestions([]);
              setShowSuggestions(false);
              hoverPopupRef.current?.remove();
              hoverPopupRef.current = null;
              if (hoverLeaveTimeoutRef.current) {
                clearTimeout(hoverLeaveTimeoutRef.current);
                hoverLeaveTimeoutRef.current = null;
              }
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        {showSuggestions && suggestions.length > 0 && (
          <ul
            className="absolute top-full left-0 w-full mt-1 bg-popover rounded-md shadow-overlay border border-border max-h-60 overflow-y-auto z-50"
            role="listbox"
          >
            {suggestions.map((dorm) => (
              <li
                key={dorm.id}
                role="option"
                aria-selected={false}
                className="px-4 py-2 text-sm cursor-pointer text-foreground hover:bg-accent"
                onClick={() => {
                  const selectedDorm = dorm;
                  setSearchQuery(selectedDorm.name ?? '');
                  flyToDorm(selectedDorm);
                  setShowSuggestions(false);
                  setTimeout(() => {
                    const lng = selectedDorm.longitude;
                    const lat = selectedDorm.latitude;
                    if (typeof lng !== 'number' || typeof lat !== 'number') return;
                    const marker = markersRef.current.find((m) => {
                      const pos = m.getLngLat();
                      return pos.lng === lng && pos.lat === lat;
                    });
                    if (marker) {
                      const markerEl = marker.getElement();
                      if (markerEl) {
                        markerEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                      }
                    }
                  }, 900);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    const selectedDorm = dorm;
                    setSearchQuery(selectedDorm.name ?? '');
                    flyToDorm(selectedDorm);
                    setShowSuggestions(false);
                    setTimeout(() => {
                      const lng = selectedDorm.longitude;
                      const lat = selectedDorm.latitude;
                      if (typeof lng !== 'number' || typeof lat !== 'number') return;
                      const marker = markersRef.current.find((m) => {
                        const pos = m.getLngLat();
                        return pos.lng === lng && pos.lat === lat;
                      });
                      if (marker) {
                        const markerEl = marker.getElement();
                        if (markerEl) {
                          markerEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                        }
                      }
                    }, 900);
                  }
                }}
              >
                {dorm.name ?? 'Residence Hall'}
              </li>
            ))}
          </ul>
        )}
      </div>
          {filterIdSuffix === 'mobile' ? (
            <AdaptiveOverlay open={filterOpen} onOpenChange={setFilterOpen} mobileVariant="drawer" shouldScaleBackground={false}>
              <AdaptiveOverlayTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-malachite-600 bg-card px-4 py-2 text-sm font-medium text-malachite-800 shadow-none dark:text-malachite-300 hover:bg-malachite-50 dark:hover:bg-muted sm:justify-start [&_svg]:text-malachite-800'
                  )}
                >
                  <Filter className="w-4 h-4 shrink-0" />
                  Filters
                  {filterOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
              </AdaptiveOverlayTrigger>
              <AdaptiveOverlayContent priority className="max-h-[85vh] h-auto w-full rounded-t-xl">
                <div className="flex flex-col max-h-[85vh]">
                  <AdaptiveOverlayHeader className="p-4 pb-0 shrink-0">
                    <AdaptiveOverlayTitle>Map Filters</AdaptiveOverlayTitle>
                  </AdaptiveOverlayHeader>
                  <div className="p-4 overflow-y-auto overscroll-contain flex-1 min-h-0 space-y-4">
                    {filterPanelContent('mobile-drawer', true)}
                  </div>
                </div>
              </AdaptiveOverlayContent>
            </AdaptiveOverlay>
          ) : (
            /* Desktop: inline expanding panel, no Popover/Drawer */
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setFilterOpen((prev) => !prev)}
                className={cn(
                  'flex w-full items-center justify-center gap-2 rounded-full border border-malachite-600 bg-card px-4 py-2 text-sm font-medium text-malachite-800 shadow-none dark:text-malachite-300 transition-colors duration-300 ease-in-out hover:bg-malachite-50 dark:hover:bg-muted sm:justify-start [&_svg]:text-malachite-800'
                )}
              >
                <Filter className="w-4 h-4 shrink-0" />
                Filters
                {filterOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
              <div
                className={cn(
                  'grid transition-all duration-300 ease-in-out',
                  filterOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                )}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="pt-4 mt-3 space-y-4 border-t border-border">
                    {filterPanelContent('desktop-inline', true)}
                  </div>
                </div>
              </div>
            </div>
          )}
      <div className="flex flex-wrap gap-3 mt-3 text-[10px]">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-malachite-600" /> First-year
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PIN_COLORS.upperclass }} /> Upperclass
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1 w-3.5 rounded-full" style={{ backgroundColor: '#1D4ED8' }} /> Bus route
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full border border-white/80" style={{ backgroundColor: BUS_STOP_COLOR }} /> Bus stop
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full border border-white/80" style={{ backgroundColor: POGOH_TEAL }} /> Pogoh station
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-2">Hover dorm markers for details · Click bus stops for routes</p>
        </div>
      </div>
    </>
  );

  return (
    <div className="h-full w-full overflow-hidden relative bg-background overscroll-none">
      {/* Map: fills entire container */}
      <div ref={mapContainer} className="absolute inset-0 w-full h-full bg-background" />
      {/* Mobile only (< 768px): bottom filter drawer + overlay card - unmounted on desktop. Hidden in embedMode. */}
      {isMobile && !embedMode && (
        <div
          ref={searchContainerRef}
          className="absolute top-4 left-1/2 -translate-x-1/2 w-[92%] z-10 bg-card rounded-lg shadow-raised p-4 border border-border transition-all duration-300"
        >
          {campusMapCardContent('mobile')}
        </div>
      )}
      {/* Desktop only (>= 768px): flush sidebar with inline expanding filters, no drawer. Hidden in embedMode. */}
      {!isMobile && !embedMode && (
        <div
          ref={searchContainerRefDesktop}
          className="absolute top-4 left-4 z-10 w-72 max-h-[calc(100vh-5rem)] flex flex-col bg-card rounded-lg shadow-raised border border-border overflow-hidden"
          style={{ transition: 'all 0.3s ease-in-out' }}
        >
          <div className="p-4 overflow-y-auto overscroll-contain min-h-0 flex-1">
            {campusMapCardContent('desktop')}
          </div>
        </div>
      )}
    </div>
  );
}
