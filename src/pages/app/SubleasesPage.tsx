import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, MapPin, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RouteSkeleton } from '@/components/skeletons/RouteSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { useUniversity } from '@/contexts/UniversityContext';
import { SubleaseListSkeleton } from '@/components/skeletons/ContentSkeletons';
import { KeyLanyardIllustration } from '@/components/illustrations/DormIllustrations';
import {
  EXPLORE_SHEET_SNAP_HALF,
  EXPLORE_SHEET_SNAP_PEEK,
  EXPLORE_SHEET_SNAP_FULL,
  MapBottomSheet,
} from '@/components/explore/MapBottomSheet';
import { SubleaseListCard } from '@/components/subleases/SubleaseListCard';
import { useAuth } from '@/hooks/useAuth';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import {
  useSubleaseMapListings,
  type SubleaseMapListing,
} from '@/hooks/useSubleaseMapListings';
import { formatRent } from '@/lib/subleases';
import { marketplaceCreatePath } from '@/lib/postTypes';
import { useModalOverlay } from '@/contexts/ModalOverlayContext';
import { useIsMobile } from '@/hooks/use-mobile';

/**
 * `/subleases` — the map of every live sublease at the viewer's school.
 *
 * A pin is a BUILDING, not a listing: Phase 1 (migration 20260928000000) made the
 * building a picked registry entity precisely so three rooms in one house collapse
 * to one pin with a count instead of three pins fighting for the same coordinate.
 *
 * Auth-gated and flag-gated on `showBrowseSublease`. Since 2026-08-18 that flag is
 * true on native as well (Ethan's override of the 2026-08-05 clamp), so this map
 * ships inside the binary; what does not is the composer, and `showPostSublease`
 * is the one place that says so. There is deliberately no second native check
 * here — the post CTA below rides the posting flag and nothing else.
 *
 * ON THE EMPTY STATE BEING BUILT FIRST. Production has one marketplace listing and
 * zero subleases, so an empty map IS the launch experience for every student who
 * opens this page on day one. It is treated as a real screen with real copy, not
 * as the branch nobody looked at.
 */

const SubleaseMapView = lazy(() =>
  import('@/components/subleases/SubleaseMapView').then((m) => ({ default: m.SubleaseMapView })),
);

/** A titled block inside the sheet — one per building in view, plus the unmapped one. */
function SheetSection({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <section className="px-4 pb-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="truncate text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        {meta ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">{meta}</span>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

/** A full-width explanatory panel inside the sheet (empty / unavailable states). */
function SheetNotice({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
      <MapPin
        className="h-8 w-8 shrink-0 text-malachite-600 dark:text-malachite-400"
        strokeWidth={1.5}
        aria-hidden
      />
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

export default function SubleasesPage() {
  const { t } = useTranslation();
  const { university } = useUniversity();
  const school = university.shortName;
  const navigate = useNavigate();
  const { universityId } = useAuth();
  const { showPostSublease } = useFeatureFlags();
  const isMobile = useIsMobile();
  const modalOverlay = useModalOverlay();

  const { listings, groups, unmapped, isLoading, error } = useSubleaseMapListings(universityId);
  // NO REGISTRY READ HERE ANY MORE. This page used to also fetch
  // `useSubleaseBuildings` so it could say "your school has no building list yet"
  // and hide the post CTA behind it. That notice described a real gap in our
  // seeding as though it were a fact about the student's school, and the gap no
  // longer stops anything: an address geocodes and pins whether or not a registry
  // row exists. The registry survives only as autocomplete inside the composer.

  const [selectedGroupKey, setSelectedBuildingId] = useState<string | null>(null);
  // Peek, not half. This is a map surface: arriving with the sheet already over
  // half the canvas hides pins behind it — measured, not assumed, on 2026-08-17 at
  // 390×844, where the cheaper of two buildings sat under the sheet and could not
  // be tapped at all. The list is one drag away and the header still carries the
  // count. Same default as the housing explore sheet for the same reason.
  const [snapIndex, setSnapIndex] = useState(EXPLORE_SHEET_SNAP_PEEK);
  const [fitAllNonce, setFitAllNonce] = useState(0);
  // `null` until the map has reported once. Distinguishing "not measured yet"
  // from "measured, nothing in frame" is what stops the zoom-out prompt flashing
  // on first paint before the camera has settled.
  const [visibleGroupKeys, setVisibleGroupKeys] = useState<string[] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Match /housing exactly: while the mobile map remains visible, tell the app
  // shell not to reserve its safe-area + top-bar padding above the route. The
  // viewport lock stays active so sheet dragging cannot turn into page scroll.
  const setFullBleedTop = modalOverlay?.setFullBleedTop;
  useEffect(() => {
    if (isMobile) {
      setFullBleedTop?.(snapIndex !== EXPLORE_SHEET_SNAP_FULL);
    } else {
      setFullBleedTop?.(false);
    }
  }, [isMobile, snapIndex, setFullBleedTop]);
  useEffect(() => () => setFullBleedTop?.(false), [setFullBleedTop]);

  const handleVisibleChange = useCallback((ids: string[]) => {
    setVisibleGroupKeys(ids);
  }, []);

  const handleSelectGroup = useCallback((buildingId: string) => {
    setSelectedBuildingId(buildingId);
    // Raise the sheet so the filtered result is visible without a second gesture;
    // half rather than full so the pin that was just tapped stays on screen.
    setSnapIndex(EXPLORE_SHEET_SNAP_HALF);
  }, []);

  const handleClearGroup = useCallback(() => {
    setSelectedBuildingId(null);
  }, []);

  const handleOpenListing = useCallback(
    (listing: SubleaseMapListing) => {
      // The existing listing-detail surface. There is no /marketplace/:id route —
      // detail opens as a modal over the feed via `?listing=<id>` (see the
      // deep-link effect in MarketplaceTab), which is the same URL a shared link
      // and a marketplace notification use.
      navigate(`/marketplace?listing=${listing.id}`);
    },
    [navigate],
  );

  const selectedGroup = useMemo(
    () => groups.find((g) => g.key === selectedGroupKey) ?? null,
    [groups, selectedGroupKey],
  );

  const groupsInView = useMemo(() => {
    if (visibleGroupKeys === null) return groups;
    const visible = new Set(visibleGroupKeys);
    return groups.filter((g) => visible.has(g.key));
  }, [groups, visibleGroupKeys]);

  const totalInView =
    groupsInView.reduce((sum, g) => sum + g.listings.length, 0) + unmapped.length;

  const nothingAtAll = !isLoading && listings.length === 0;
  const nothingInView =
    !isLoading && !selectedGroup && groups.length > 0 && groupsInView.length === 0;

  const headerLabel = selectedGroup
    ? selectedGroup.label
    : isLoading
      ? t('marketplace:subleaseMap.loading')
      : t('marketplace:subleaseMap.sheetTitle', { count: totalInView });

  // Preselect the type the student just came from — arriving at a post-type
  // picker off an empty SUBLEASE map and being asked to pick "sublease" is the
  // question already answered. The param is a hint the composer re-checks
  // against `showPostSublease`, so this is not the gate (that is the condition
  // on this very CTA).
  const postCta =
    showPostSublease ? (
      <Button type="button" onClick={() => navigate(marketplaceCreatePath('sublease'))}>
        {t('marketplace:subleaseMap.empty.cta')}
      </Button>
    ) : undefined;

  /**
   * Unmapped rows are LISTED, never dropped. Two things land here, and they are the
   * same shape in the data — a `building_name` with no `building_id`:
   *
   *   1. A sublease posted before the registry landed. Migration 20260928000000
   *      deliberately does not fuzzy-match a building onto it, because a wrong pin
   *      is worse than no pin.
   *   2. A sublease posted under the Phase 1 typed-building fallback (2026-08-17),
   *      which deliberately stored a name and never geocoded it.
   *
   * Both are LEGACY. Every sublease written since 2026-08-18 geocodes at submit or
   * is refused, so this section shrinks to empty rather than growing. Hiding these
   * rows would make a live listing invisible to fix a cosmetic gap on the map; they
   * are also the re-geocode worklist — see docs/sublease-phase1-prod-rollout.md § 3c.
   */
  const renderUnmappedSection = () => (
    <SheetSection
      title={t('marketplace:subleaseMap.unmapped.title')}
      meta={t('marketplace:subleaseMap.unmapped.meta', { count: unmapped.length })}
    >
      <p className="pb-1 text-xs text-muted-foreground">
        {t('marketplace:subleaseMap.unmapped.body', { count: unmapped.length })}
      </p>
      {unmapped.map((listing) => (
        <SubleaseListCard
          key={listing.id}
          listing={listing}
          buildingName={listing.building_name ?? listing.title}
          onOpen={handleOpenListing}
        />
      ))}
    </SheetSection>
  );

  const renderSheetBody = () => {
    if (isLoading) {
      return (
        <div className="px-4 py-6">
          <SubleaseListSkeleton />
        </div>
      );
    }

    if (error) {
      return (
        <SheetNotice
          title={t('marketplace:subleaseMap.loadError.title')}
          body={t('marketplace:subleaseMap.loadError.body', { school })}
        />
      );
    }

    if (selectedGroup) {
      return (
        <>
          <div className="px-4 pb-3 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClearGroup}
              className="[&_svg]:text-current"
            >
              <ArrowLeft aria-hidden />
              {t('marketplace:subleaseMap.backToAll')}
            </Button>
          </div>
          <SheetSection
            title={selectedGroup.label}
            meta={t('marketplace:subleaseMap.fromRent', {
              rent: formatRent(selectedGroup.minPrice),
            })}
          >
            {selectedGroup.listings.map((listing) => (
              <SubleaseListCard
                key={listing.id}
                listing={listing}
                buildingName={selectedGroup.label}
                onOpen={handleOpenListing}
              />
            ))}
          </SheetSection>
        </>
      );
    }

    if (nothingAtAll) {
      return (
        <EmptyState
          className="mx-4 my-4 rounded-card border border-border bg-card px-5 py-8"
          illustration={<KeyLanyardIllustration />}
          title={t('marketplace:subleaseMap.empty.title', { school })}
          description={t('marketplace:subleaseMap.empty.body', { school })}
          action={postCta}
        />
      );
    }

    return (
      <>
        {nothingInView ? (
          <SheetNotice
            title={t('marketplace:subleaseMap.noneInView.title')}
            body={t('marketplace:subleaseMap.noneInView.body', { count: listings.length, school })}
            action={
              <Button
                type="button"
                variant="outline"
                onClick={() => setFitAllNonce((n) => n + 1)}
                className="[&_svg]:text-current"
              >
                <Maximize2 aria-hidden />
                {t('marketplace:subleaseMap.noneInView.cta')}
              </Button>
            }
          />
        ) : null}

        <div className="pt-3">
          {groupsInView.map((group) => (
            <SheetSection
              key={group.key}
              title={group.label}
              meta={
                group.listings.length > 1
                  ? t('marketplace:subleaseMap.countFromRent', {
                      count: group.listings.length,
                      rent: formatRent(group.minPrice),
                    })
                  : t('marketplace:subleaseMap.fromRent', { rent: formatRent(group.minPrice) })
              }
            >
              {group.listings.map((listing) => (
                <SubleaseListCard
                  key={listing.id}
                  listing={listing}
                  buildingName={group.label}
                  onOpen={handleOpenListing}
                />
              ))}
            </SheetSection>
          ))}

          {unmapped.length > 0 ? renderUnmappedSection() : null}
        </div>
      </>
    );
  };

  /**
   * BREAKPOINT FORK, not a replacement. Under `md` this is a phone surface: a
   * full-bleed map with the drag-to-expand sheet over it. At `md` and up it is
   * the same split `/housing` explore uses — map pinned left, the list scrolling
   * in its own right-hand column — because the sheet stretched to 1900px put the
   * count, the listings AND the empty state below the fold of a screen with room
   * for all three.
   *
   * ONE map instance, not one per breakpoint. `/housing` renders a MapView in
   * each branch and hides one with CSS; mapbox-gl is the heaviest thing we mount,
   * so here the map column stays a single element that only changes how it is
   * positioned (`absolute inset-0` → `md:relative md:w-1/2`). The list body is
   * the cheap half and is rendered twice, which is what keeps the sheet's drag
   * mechanics and the desktop column from having to be the same component.
   *
   * NOT factored into a shared shell with `/housing`. The two look alike at this
   * zoom and are not alike underneath: Index.tsx's split carries a rankings
   * overlay, a transit layer, a filter bar, a sort control and the compare tray,
   * none of which exist here. A common shell would be a parameter for each of
   * them — see docs/DECISIONS.md 2026-08-18.
   */
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="relative flex min-h-0 w-full flex-1">
        {/* mapbox-gl is the heaviest chunk in the app; the map skeleton holds the
            canvas shape so the wait does not read as a stall. */}
        <div className="absolute inset-0 md:relative md:inset-auto md:h-full md:w-1/2 md:min-w-0 md:shrink-0 md:overflow-hidden">
          <Suspense fallback={<RouteSkeleton pathname="/map" />}>
            <SubleaseMapView
              groups={groups}
              selectedGroupKey={selectedGroupKey}
              onSelectGroup={handleSelectGroup}
              onBackgroundClick={handleClearGroup}
              onVisibleGroupsChange={handleVisibleChange}
              fitAllNonce={fitAllNonce}
            />
          </Suspense>
        </div>

        <MapBottomSheet
          className="md:hidden"
          snapIndex={snapIndex}
          onSnapIndexChange={setSnapIndex}
          headerLabel={headerLabel}
          listRef={listRef}
        >
          {renderSheetBody()}
        </MapBottomSheet>

        <aside className="hidden min-w-0 shrink-0 border-l border-border bg-card md:flex md:h-full md:w-1/2 md:flex-col md:overflow-hidden">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 className="min-w-0 truncate text-lg font-bold text-foreground">{headerLabel}</h2>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin">
            {renderSheetBody()}
          </div>
        </aside>
      </div>
    </div>
  );
}
