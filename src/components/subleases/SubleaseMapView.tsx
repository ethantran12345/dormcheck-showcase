import { useCallback, useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { PIN_COLORS } from '@/lib/dormPins';
import { formatRent } from '@/lib/subleases';
import { useMapboxTheme } from '@/hooks/useMapboxTheme';
import { useUniversity } from '@/contexts/UniversityContext';
import { cn } from '@/lib/utils';
import type { SubleaseLocationGroup } from '@/hooks/useSubleaseMapListings';

/**
 * The sublease map: one marker per LOCATION, never one per listing.
 *
 * WHY THIS IS NOT `src/components/MapView.tsx` WITH A SECOND ENTITY THREADED
 * THROUGH IT. MapView is 1617 lines typed end to end on `Dorm` — pin category,
 * hover popup, transit layers, the desktop "smart pan", the mobile explore embed
 * and its carousel offsets all read dorm fields. Threading subleases through it
 * would put a live, shipped housing surface at risk for zero benefit, and the
 * genuinely shared part is not yet known: both surfaces have to exist before the
 * real overlap is visible. Duplicating ~100 lines of Mapbox init is the cheaper
 * mistake, and extracting a shared shell later is a refactor with two working
 * references instead of one working reference and a guess.
 *
 * NO SOURCE CLUSTERING (`cluster: true`), deliberately. Same-address collapse is
 * an exact bucket on the rounded geocoded coordinate in the hook
 * (`subleaseLocationGroupKey`, ~1.1 m). Mapbox clustering merges NEARBY pins at a
 * pixel radius,
 * which is a different (and lossy) operation, and at the density this launches
 * with there is nothing to cluster.
 *
 * The two Mapbox rules that silently break a map like this:
 *
 *   · `map.setStyle()` wipes every source, layer and image on the map, so it must
 *     never be called on mount — only when the style URL actually changes.
 *     `mountedStyleRef` below is what makes the first render a no-op.
 *   · `map.isStyleLoaded()` never returns true on the imported Standard styles
 *     this app uses, so gating `addLayer`/`addImage` on it deadlocks. This
 *     component adds NO native sources or layers — HTML markers are DOM and
 *     survive a style swap untouched — so it does not need the apply-then-retry-
 *     on-'idle' dance. If a native layer is ever added here, copy the pattern
 *     from src/lib/transitLayers.ts and src/hooks/useTransitLayers.ts rather than
 *     inventing a second one.
 */

const DEFAULT_ZOOM = 14.2;
/** Zoom used when fitting to a single location — bounds of one point are a point. */
const SINGLE_PIN_ZOOM = 16;

/**
 * Camera insets, in CSS px, for the chrome that floats OVER the canvas.
 *
 * The map container is the whole section, but the visible map is not: the bottom
 * sheet's peek header and the floating BottomNav both sit on top of it. Framing
 * against the raw container put a pin behind the sheet — visible in the DOM,
 * unreachable by a finger — so the bottom inset is the sheet header plus the nav
 * plus a margin, not a token value.
 *
 * Clamped against the real container in `fitToGroups`: Mapbox rejects padding
 * that exceeds the canvas, and a short embed would otherwise fail to fit at all.
 */
const FIT_INSET_TOP = 64;
const FIT_INSET_BOTTOM = 180;
const FIT_INSET_SIDE = 48;
/**
 * Where a selected location should land vertically, as a fraction of the map
 * height measured from the top. 0.3 puts the pin in the upper third — clear of
 * the half-detent sheet, which starts at 0.5.
 */
const SELECTED_PIN_Y_FRACTION = 0.3;

const BRAND_GREEN = PIN_COLORS['first-year'];

/** `$850`, or `$1.2k` once the label would crowd the pin next to it. */
function markerLabel(price: number): string {
  if (price >= 10_000) return `${formatRent(Math.round(price / 1000))}k`;
  return formatRent(price);
}

/**
 * One location's marker: a price pill showing the cheapest rent, plus a count
 * badge when the address holds more than one listing.
 *
 * Built with DOM APIs rather than JSX because Mapbox owns the element's transform
 * and re-parents it; this mirrors `createDormMarker` in MapView. Colours are set
 * as inline styles from the shared `PIN_COLORS` token — never a literal green, so
 * a brand change is one edit in src/lib/dormPins.ts.
 */
function createLocationMarker(
  group: SubleaseLocationGroup,
  isSelected: boolean,
  onSelect: () => void,
): HTMLElement {
  const count = group.listings.length;

  const el = document.createElement('div');
  el.className = 'sublease-location-marker';
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute(
    'aria-label',
    count > 1
      ? `${group.label}, ${count} subleases from ${markerLabel(group.minPrice)} a month`
      : `${group.label}, ${markerLabel(group.minPrice)} a month`,
  );
  el.title = group.label;
  // NOTHING about `position` is set here, deliberately. Mapbox positions its own
  // marker element through `.mapboxgl-marker { position: absolute; top: 0; left: 0 }`
  // plus a transform, and an inline `position` on this element BEATS that class —
  // which detaches the marker from the coordinate system Mapbox is driving. The
  // count badge therefore anchors to the inner `stack` below, never to this node.
  el.style.display = 'flex';
  el.style.flexDirection = 'column';
  el.style.alignItems = 'center';
  el.style.cursor = 'pointer';
  // Invisible slop so the tap target clears the 44px floor without moving the
  // pill off the coordinate (same trick as MapView's mobile embed markers).
  el.style.padding = '10px';
  el.style.margin = '-10px';
  el.style.boxSizing = 'content-box';
  el.style.touchAction = 'manipulation';
  el.style.zIndex = isSelected ? '3' : '2';

  // The positioned box the badge hangs off. Owned by us, so nothing Mapbox does
  // to `el` can move the badge away from the pill it belongs to.
  const stack = document.createElement('div');
  stack.style.position = 'relative';
  stack.style.display = 'flex';
  stack.style.flexDirection = 'column';
  stack.style.alignItems = 'center';
  stack.style.pointerEvents = 'none';

  const pill = document.createElement('div');
  pill.textContent = markerLabel(group.minPrice);
  pill.style.display = 'flex';
  pill.style.alignItems = 'center';
  pill.style.height = isSelected ? '30px' : '26px';
  pill.style.padding = isSelected ? '0 12px' : '0 10px';
  pill.style.borderRadius = '999px';
  pill.style.fontSize = isSelected ? '13px' : '12px';
  pill.style.fontWeight = '700';
  pill.style.lineHeight = '1';
  pill.style.whiteSpace = 'nowrap';
  // Selected inverts to a white pill with a green ring rather than darkening the
  // green: at 12px the difference between two greens is not readable outdoors,
  // and an inversion is legible in both map themes without a second token.
  pill.style.background = isSelected ? 'white' : BRAND_GREEN;
  pill.style.color = isSelected ? BRAND_GREEN : 'white';
  pill.style.border = `2px solid ${isSelected ? BRAND_GREEN : 'white'}`;
  pill.style.boxShadow = isSelected
    ? '0 4px 12px rgba(15, 23, 42, 0.38)'
    : '0 1px 4px rgba(15, 23, 42, 0.30)';
  pill.style.transition = 'transform 0.15s ease-out';
  pill.style.transformOrigin = 'center bottom';
  pill.style.pointerEvents = 'none';

  // Tail: a small square rotated 45° under the pill so the marker points at the
  // coordinate. Drawn from the pill's own colours so the two never disagree.
  const tail = document.createElement('div');
  tail.style.width = '8px';
  tail.style.height = '8px';
  tail.style.marginTop = '-5px';
  tail.style.transform = 'rotate(45deg)';
  tail.style.background = isSelected ? 'white' : BRAND_GREEN;
  tail.style.border = `2px solid ${isSelected ? BRAND_GREEN : 'white'}`;
  tail.style.borderTop = 'none';
  tail.style.borderLeft = 'none';
  tail.style.pointerEvents = 'none';

  stack.appendChild(pill);
  stack.appendChild(tail);
  el.appendChild(stack);

  // The count badge only exists above one listing. A "1" badge on every pin is
  // noise that makes the real multi-listing addresses harder to spot, which is
  // the single thing this badge is for.
  if (count > 1) {
    const badge = document.createElement('div');
    badge.textContent = String(count);
    badge.style.position = 'absolute';
    // Sits on the pill's top-right shoulder, half off the edge, so it reads as
    // attached to this pin and not as a marker of its own.
    badge.style.top = '-8px';
    badge.style.right = '-8px';
    badge.style.minWidth = '18px';
    badge.style.height = '18px';
    badge.style.padding = '0 4px';
    badge.style.display = 'flex';
    badge.style.alignItems = 'center';
    badge.style.justifyContent = 'center';
    badge.style.borderRadius = '999px';
    badge.style.background = 'white';
    badge.style.color = BRAND_GREEN;
    badge.style.border = `2px solid ${BRAND_GREEN}`;
    badge.style.fontSize = '11px';
    badge.style.fontWeight = '700';
    badge.style.lineHeight = '1';
    badge.style.pointerEvents = 'none';
    stack.appendChild(badge);
  }

  const select = (e: Event) => {
    // Stop the map's own click handler from immediately clearing the selection
    // this tap just made.
    e.preventDefault();
    e.stopPropagation();
    onSelect();
  };
  el.addEventListener('click', select);
  el.addEventListener('keydown', (e) => {
    const key = (e as KeyboardEvent).key;
    if (key === 'Enter' || key === ' ') select(e);
  });
  el.addEventListener('mouseenter', () => {
    pill.style.transform = 'scale(1.08)';
  });
  el.addEventListener('mouseleave', () => {
    pill.style.transform = 'scale(1)';
  });

  return el;
}

export interface SubleaseMapViewProps {
  groups: SubleaseLocationGroup[];
  selectedGroupKey: string | null;
  onSelectGroup: (groupKey: string) => void;
  /** Tap on empty map — clears the location filter. */
  onBackgroundClick: () => void;
  /**
   * Group keys inside the current viewport, emitted on every settled camera
   * move. The page uses it for the "subleases exist, none in view" state, which
   * cannot be computed anywhere else — only the map knows where it is looking.
   */
  onVisibleGroupsChange?: (groupKeys: string[]) => void;
  /** Bumping this refits the camera to every marker (the "zoom out" affordance). */
  fitAllNonce?: number;
  className?: string;
}

export function SubleaseMapView({
  groups,
  selectedGroupKey,
  onSelectGroup,
  onBackgroundClick,
  onVisibleGroupsChange,
  fitAllNonce = 0,
  className,
}: SubleaseMapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);

  const { university } = useUniversity();
  const campusCenterRef = useRef<[number, number]>(university.campusCenter);
  campusCenterRef.current = university.campusCenter;

  const { styleUrl } = useMapboxTheme();
  const styleUrlRef = useRef(styleUrl);
  styleUrlRef.current = styleUrl;

  // Callbacks live in refs so the marker-sync effect does not tear down and
  // rebuild every marker each time the parent re-renders with a new closure.
  const onSelectRef = useRef(onSelectGroup);
  onSelectRef.current = onSelectGroup;
  const onBackgroundClickRef = useRef(onBackgroundClick);
  onBackgroundClickRef.current = onBackgroundClick;
  const onVisibleRef = useRef(onVisibleGroupsChange);
  onVisibleRef.current = onVisibleGroupsChange;

  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  const reportVisible = useCallback(() => {
    const mapInstance = map.current;
    const notify = onVisibleRef.current;
    if (!mapInstance || !notify) return;
    const bounds = mapInstance.getBounds();
    if (!bounds) return;
    notify(
      groupsRef.current
        .filter((g) => bounds.contains([g.lng, g.lat]))
        .map((g) => g.key),
    );
  }, []);

  /** Pixels to lift a centred point by so it clears the bottom sheet. */
  const centerLiftPx = useCallback((mapInstance: mapboxgl.Map) => {
    const h = mapInstance.getContainer().clientHeight || 0;
    return Math.round(h * (0.5 - SELECTED_PIN_Y_FRACTION));
  }, []);

  const fitToGroups = useCallback(
    (next: SubleaseLocationGroup[], animate: boolean) => {
      const mapInstance = map.current;
      if (!mapInstance || next.length === 0) return;
      if (next.length === 1) {
        const only = next[0];
        mapInstance.easeTo({
          center: [only.lng, only.lat],
          zoom: SINGLE_PIN_ZOOM,
          offset: [0, -centerLiftPx(mapInstance)],
          duration: animate ? 400 : 0,
        });
        return;
      }
      const el = mapInstance.getContainer();
      const h = el.clientHeight || 0;
      const w = el.clientWidth || 0;
      const bounds = new mapboxgl.LngLatBounds();
      for (const g of next) bounds.extend([g.lng, g.lat]);
      mapInstance.fitBounds(bounds, {
        padding: {
          top: Math.min(FIT_INSET_TOP, Math.max(16, Math.round(h * 0.15))),
          bottom: Math.min(FIT_INSET_BOTTOM, Math.max(24, Math.round(h * 0.3))),
          left: Math.min(FIT_INSET_SIDE, Math.max(16, Math.round(w * 0.15))),
          right: Math.min(FIT_INSET_SIDE, Math.max(16, Math.round(w * 0.15))),
        },
        maxZoom: SINGLE_PIN_ZOOM,
        duration: animate ? 500 : 0,
      });
    },
    [centerLiftPx],
  );

  // Init once.
  useEffect(() => {
    if (!mapContainer.current || map.current) return;
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!token) {
      console.warn(
        '[SubleaseMapView] VITE_MAPBOX_TOKEN is missing. Add it to .env or .env.local so the map works locally.',
      );
      return;
    }
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
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Theme swap. Skipped on the first run: the map was CREATED with this style,
  // and a redundant setStyle mid-load churns the style for nothing. DOM markers
  // survive the swap, so there is nothing to re-add afterwards.
  const mountedStyleRef = useRef(styleUrl);
  useEffect(() => {
    if (!map.current || styleUrl === mountedStyleRef.current) return;
    mountedStyleRef.current = styleUrl;
    map.current.setStyle(styleUrl);
  }, [styleUrl]);

  // Tap empty map to clear the location filter.
  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !mapReady) return;
    const handle = () => onBackgroundClickRef.current();
    mapInstance.on('click', handle);
    return () => {
      mapInstance.off('click', handle);
    };
  }, [mapReady]);

  // Viewport reporting.
  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !mapReady) return;
    mapInstance.on('moveend', reportVisible);
    reportVisible();
    return () => {
      mapInstance.off('moveend', reportVisible);
    };
  }, [mapReady, reportVisible]);

  // Sync markers with the grouped data. Rebuilt wholesale rather than diffed:
  // the set is one marker per address in range, and a marker's appearance
  // depends on the selection anyway.
  useEffect(() => {
    if (!map.current || !mapReady) return;
    const mapInstance = map.current;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    for (const group of groups) {
      const el = createLocationMarker(group, group.key === selectedGroupKey, () =>
        onSelectRef.current(group.key),
      );
      markersRef.current.push(
        new mapboxgl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([group.lng, group.lat])
          .addTo(mapInstance),
      );
    }
    reportVisible();
  }, [groups, selectedGroupKey, mapReady, reportVisible]);

  // First frame with data: frame every pin. Once only — refitting on each data
  // change would yank the camera out from under someone who had panned.
  const didInitialFitRef = useRef(false);
  useEffect(() => {
    if (!mapReady || didInitialFitRef.current || groups.length === 0) return;
    didInitialFitRef.current = true;
    fitToGroups(groups, false);
    reportVisible();
  }, [groups, mapReady, fitToGroups, reportVisible]);

  // Explicit "show me everything" from the empty-in-view prompt.
  useEffect(() => {
    if (!mapReady || fitAllNonce === 0) return;
    fitToGroups(groupsRef.current, true);
  }, [fitAllNonce, mapReady, fitToGroups]);

  // Centre the selected location so the sheet is not covering its own pin.
  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !mapReady || !selectedGroupKey) return;
    const group = groupsRef.current.find((g) => g.key === selectedGroupKey);
    if (!group) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    mapInstance.easeTo({
      center: [group.lng, group.lat],
      // Negative Y pulls the pin into the upper third, clear of the half-detent
      // sheet the tap raises. Proportional rather than a fixed 80px: the sheet's
      // detents are fractions of the container, so a constant is right at exactly
      // one viewport height and wrong at every other.
      offset: [0, -centerLiftPx(mapInstance)],
      duration: reduce ? 0 : 400,
    });
  }, [selectedGroupKey, mapReady, centerLiftPx]);

  return <div ref={mapContainer} className={cn('h-full w-full', className)} />;
}
