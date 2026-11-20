import { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { Search, X, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PAGE_SEARCH_ATTR } from '@/lib/pageSearch';
import { Dorm } from '@/types';
import { getDormTab, formatWhoLivesHere } from '@/lib/dormUtils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import {
  AdaptiveOverlay,
  AdaptiveOverlayContent,
  AdaptiveOverlayTrigger,
} from '@/components/ui/adaptive-overlay';
import { Switch } from '@/components/ui/switch';
import { useIsMobile } from '@/hooks/use-mobile';
import { useModalOverlay } from '@/contexts/ModalOverlayContext';
import { ExploreHousingAdvancedFiltersDrawer } from '@/components/explore/ExploreHousingAdvancedFiltersDrawer';

// Room Capacity: how many students per unit (ids for filter logic, labels use standard dorm terms)
const ROOM_CAPACITY_OPTIONS = [
  { id: '1-person', label: 'Single' },
  { id: '2-person', label: 'Double' },
  { id: '3-person', label: 'Triple' },
  { id: '4-person', label: 'Quad' },
  { id: '5-plus-person', label: 'Quintuple' },
] as const;

export interface AdvancedFilters {
  roomCapacities: Set<string>;
  priceRange: [number, number];
  hasAC: boolean;
  hasPrivateBath: boolean;
  hasKitchen: boolean;
}

export type HousingTab = 'freshman' | 'upperclass';

export type CampusScopeTab = 'on-campus' | 'off-campus';
export type AudienceFilterTab = 'all' | 'freshman' | 'upperclass';

interface DormSearchProps {
  /** Entire grouped list (by residence_hall). Suggestions use this with name-only filter; tab/other filters are not applied when searching. */
  allDorms: Dorm[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onDormSelect: (dorm: Dorm) => void;
  filters: AdvancedFilters;
  onFiltersChange: (filters: AdvancedFilters) => void;
  /** Explore housing: On-Campus vs Off-Campus (replaces freshman/upperclass pill when set). */
  campusScope?: CampusScopeTab;
  onCampusScopeChange?: (scope: CampusScopeTab) => void;
  audienceFilter?: AudienceFilterTab;
  onAudienceFilterChange?: (filter: AudienceFilterTab) => void;
  /** When provided, shows Freshman Housing vs Upperclass pill (legacy; ignored if campusScope is set). */
  housingTab?: HousingTab;
  onHousingTabChange?: (tab: HousingTab) => void;
  /** When true, the main scope / housing toggle is visually disabled (e.g. during global search). */
  disableHousingToggle?: boolean;
  /** When true, only show the search bar (no toggle or filters). Use when filters are in a separate floating panel. */
  searchOnly?: boolean;
  /** When true and on mobile, use stacked layout: Row 1 = full-width search, Row 2 = toggle | savedButton | filters */
  mobileStackedLayout?: boolean;
  /** Mobile explore: single row - search (flex-1) + Filters; use with title above in parent. */
  mobileExploreInlineRow?: boolean;
  /** Slot for Saved/Heart button when using mobileStackedLayout (placed between toggle and filters) */
  savedButton?: React.ReactNode;
  /** Fires when the mobile filters drawer opens or closes (explore / stacked layouts). */
  onFiltersOpenChange?: (open: boolean) => void;
}

// Default price [0, 8000] per term to match typical campus housing range; no filter applied
export const PRICE_MAX = 8000;

export const defaultFilters: AdvancedFilters = {
  roomCapacities: new Set(),
  priceRange: [0, PRICE_MAX],
  hasAC: false,
  hasPrivateBath: false,
  hasKitchen: false,
};

const STUDENT_YEAR_KEYS = ['all', 'freshman', 'upperclass'] as const;

/** All / Freshman / Upperclass pills for the Filters panel (matches Room Type pill styling). */
export function StudentYearFilterSection({
  audienceFilter,
  onAudienceFilterChange,
  labelClassName = 'text-sm font-medium',
  unselectedVariant = 'muted',
}: {
  audienceFilter: AudienceFilterTab;
  onAudienceFilterChange: (filter: AudienceFilterTab) => void;
  labelClassName?: string;
  /** `muted` matches Explore popover room pills; `border` matches mobile drawer room pills. */
  unselectedVariant?: 'muted' | 'border';
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <Label className={labelClassName}>{t('housing:explore.filterBar.studentYear')}</Label>
      <div className="flex flex-wrap gap-2">
        {STUDENT_YEAR_KEYS.map((key) => {
          const active = audienceFilter === key;
          return (
            <Button
              key={key}
              type="button"
              variant="ghost"
              onClick={() => onAudienceFilterChange(key)}
              // Toggle chip: keep the exact per-state pill visuals and pin hover to the
              // resting look so Button's ghost hover (bg-muted/text-foreground) can't wash
              // the active green chip gray. h-auto drops the default size's fixed height.
              className={cn(
                'h-auto rounded-full border px-3 py-2 text-sm font-medium transition-all',
                active
                  ? 'border-primary bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
                  : unselectedVariant === 'muted'
                    ? 'border-transparent bg-muted/50 text-foreground hover:border-border hover:bg-muted/50 hover:text-foreground'
                    : 'border-border bg-card text-foreground hover:border-border hover:bg-card hover:text-foreground',
              )}
            >
              {key === 'all' ? t('housing:explore.filterBar.all') : key === 'freshman' ? t('housing:explore.filterBar.freshman') : t('housing:explore.filterBar.upperclass')}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

export function DormSearch({
  allDorms,
  searchQuery,
  onSearchChange,
  onDormSelect,
  filters,
  onFiltersChange,
  campusScope,
  onCampusScopeChange,
  audienceFilter,
  onAudienceFilterChange,
  searchOnly = false,
  mobileStackedLayout = false,
  mobileExploreInlineRow = false,
  savedButton,
  onFiltersOpenChange,
}: DormSearchProps) {
  const { t } = useTranslation();
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [suggestionDropdownTop, setSuggestionDropdownTop] = useState<number | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  /** Desktop Filters trigger — Esc closes the popover and hands focus back here (P8.1). */
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  /**
   * P8.1 — Esc closes the DESKTOP Filters popover. That popover is hand-rolled
   * rather than Radix (the mobile branch is an AdaptiveOverlay, which gets Esc for
   * free), so it had outside-click dismissal but no Escape: the one dialog-like
   * surface in the app where Escape did nothing. Bound to the trigger and to the
   * panel (not to a wrapper div, which would make a plain div interactive), and it
   * hands focus back to the trigger instead of dropping it on <body>.
   */
  const closeFilterOnEscape = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || !filterOpen) return;
    e.stopPropagation();
    setFilterOpen(false);
    filterTriggerRef.current?.focus();
  };
  const isMobile = useIsMobile();
  const modalOverlay = useModalOverlay();

  useEffect(() => {
    if (isMobile && modalOverlay) {
      modalOverlay.setHideBottomNav(filterOpen);
      return () => {
        modalOverlay.setHideBottomNav(false);
      };
    }
  }, [filterOpen, isMobile, modalOverlay]);

  useEffect(() => {
    onFiltersOpenChange?.(filterOpen);
  }, [filterOpen, onFiltersOpenChange]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Suggestions = entire grouped list filtered by name only (no tab or other filters). First 6. Stays in sync with grid when search is active.
  const suggestions = useMemo(() => {
    const q = (searchQuery || '').trim();
    if (!q) return [];
    const lower = q.toLowerCase();
    return (allDorms || []).filter((d) => (d.name || '').toLowerCase().includes(lower)).slice(0, 6);
  }, [allDorms, searchQuery]);

  const suggestionsVisible =
    showSuggestions && Boolean(searchQuery.trim()) && suggestions.length > 0;

  useLayoutEffect(() => {
    if (!suggestionsVisible) {
      setSuggestionDropdownTop(null);
      return;
    }
    const updateTop = () => {
      const el = searchRef.current;
      if (!el) return;
      if (typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches) {
        setSuggestionDropdownTop(null);
        return;
      }
      const rect = el.getBoundingClientRect();
      setSuggestionDropdownTop(rect.bottom + 8);
    };
    updateTop();
    window.addEventListener('resize', updateTop);
    window.addEventListener('scroll', updateTop, true);
    return () => {
      window.removeEventListener('resize', updateTop);
      window.removeEventListener('scroll', updateTop, true);
    };
  }, [suggestionsVisible, searchQuery, suggestions.length]);

  const useCampusScope = campusScope != null && onCampusScopeChange != null;
  const exploreToolsOffCampus = useCampusScope && campusScope === 'off-campus';

  useEffect(() => {
    if (exploreToolsOffCampus) setFilterOpen(false);
  }, [exploreToolsOffCampus]);

  // Count active filters (price is "active" when narrower than default [0, PRICE_MAX])
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.roomCapacities.size > 0) count += filters.roomCapacities.size;
    if (filters.priceRange[0] > 0 || filters.priceRange[1] < PRICE_MAX) count += 1;
    if (filters.hasAC) count += 1;
    if (filters.hasPrivateBath) count += 1;
    if (filters.hasKitchen) count += 1;
    if (useCampusScope && audienceFilter != null && audienceFilter !== 'all') count += 1;
    return count;
  }, [filters, useCampusScope, audienceFilter]);

  const handleCapacityToggle = (id: string) => {
    const next = new Set(filters.roomCapacities);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onFiltersChange({ ...filters, roomCapacities: next });
  };

  const handleClearAll = () => {
    onFiltersChange(defaultFilters);
    if (useCampusScope && onAudienceFilterChange) {
      onAudienceFilterChange('all');
    }
  };

  const handleDormClick = (dorm: Dorm) => {
    onSearchChange(dorm.name || '');
    setShowSuggestions(false);
    onDormSelect(dorm);
  };

  const handleClearSearch = () => {
    onSearchChange('');
    setShowSuggestions(false);
  };

  const AMENITY_ITEMS = [
    { id: 'ac' as const, label: t('housing:explore.filterBar.airConditioning'), get: () => filters.hasAC, set: (v: boolean) => onFiltersChange({ ...filters, hasAC: v }) },
    { id: 'bath' as const, label: t('housing:explore.filterBar.privateBathroom'), get: () => filters.hasPrivateBath, set: (v: boolean) => onFiltersChange({ ...filters, hasPrivateBath: v }) },
    { id: 'kitchen' as const, label: t('housing:explore.filterBar.kitchen'), get: () => filters.hasKitchen, set: (v: boolean) => onFiltersChange({ ...filters, hasKitchen: v }) },
  ];

  const useExploreInlineRow = mobileExploreInlineRow && isMobile && !searchOnly;
  const useStackedMobile = mobileStackedLayout && isMobile && !searchOnly;

  // Scope pill + legacy freshman/upperclass toggle removed 2026-07-17: both were dead
  // (campusScopeToggleVisible=false made scopePillControl `false`, and `false ?? legacy` never
  // falls through). Restore from git history if the toggle row comes back.
  const showStudentYearInFilters =
    useCampusScope &&
    campusScope === 'on-campus' &&
    audienceFilter != null &&
    onAudienceFilterChange != null;

  const studentYearSectionDrawer = showStudentYearInFilters ? (
    <StudentYearFilterSection
      audienceFilter={audienceFilter}
      onAudienceFilterChange={onAudienceFilterChange}
      labelClassName="text-sm font-semibold text-foreground"
      unselectedVariant="border"
    />
  ) : null;

  const studentYearSectionPopover = showStudentYearInFilters ? (
    <StudentYearFilterSection
      audienceFilter={audienceFilter}
      onAudienceFilterChange={onAudienceFilterChange}
      labelClassName="text-sm font-medium"
      unselectedVariant="muted"
    />
  ) : null;

  const searchInput = (
    <div
      className={cn(
        'relative flex-1 min-w-0 w-full',
        !useExploreInlineRow && 'max-w-xl sm:mx-auto',
        exploreToolsOffCampus && 'pointer-events-none opacity-40',
      )}
      ref={searchRef}
    >
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />
      <Input
        type="text"
        // P8.3: "/" focuses this, the scoped search for Explore. See lib/pageSearch.ts.
        {...{ [PAGE_SEARCH_ATTR]: '' }}
        placeholder={t('housing:explore.search.placeholder')}
        aria-label={t('housing:explore.search.ariaLabel')}
        value={searchQuery}
        onChange={(e) => { onSearchChange(e.target.value); setShowSuggestions(true); }}
        onFocus={() => {
          setShowSuggestions(true);
          if (!Capacitor.isNativePlatform()) {
            window.scrollTo({ top: 0, behavior: 'instant' });
          }
        }}
        className="h-11 w-full text-base pl-11 pr-9 rounded-xl border-0 bg-muted focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-0"
      />
      {searchQuery && (
        <Button
          type="button"
          variant="ghost"
          onClick={handleClearSearch}
          // Compact icon affordance: h-auto/w-auto + p-1 keeps the original 24px hit area
          // (Button's size="icon" would force a 40px circle), and text-muted-foreground
          // pins the X's color through Button's [&_svg]:text-current.
          className="absolute right-2.5 top-1/2 h-auto w-auto -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-muted-foreground"
          aria-label={t('common:actions.clearSearch')}
        >
          <X className="w-4 h-4" />
        </Button>
      )}
      {suggestionsVisible && (
        <div
          className={cn(
            'bg-card shadow-overlay overflow-hidden z-[10055]',
            'max-md:fixed max-md:left-0 max-md:right-0 max-md:border-t max-md:border-border max-md:max-h-[60vh] max-md:overflow-y-auto',
            'md:absolute md:top-full md:left-0 md:right-0 md:mt-2 md:w-auto md:translate-x-0 md:border md:border-border md:rounded-xl',
          )}
          style={
            suggestionDropdownTop != null ? { top: suggestionDropdownTop } : undefined
          }
        >
          <div className="py-2">
            <p className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('housing:explore.search.suggestions')}</p>
            {suggestions.map((dorm) => (
              <Button
                key={dorm.id}
                type="button"
                variant="ghost"
                onClick={() => handleDormClick(dorm)}
                // Flush full-width list row: reset Button's centered/nowrap/rounded/height
                // defaults so it lays out like the original list item (multi-line, left-aligned).
                className="h-auto w-full justify-between gap-2 whitespace-normal rounded-none px-4 py-3 text-left font-normal transition-colors hover:bg-accent"
              >
                <div>
                  <p className="font-medium text-foreground">{dorm.name ?? t('housing:explore.search.building')}</p>
                  <p className="text-xs text-muted-foreground">{formatWhoLivesHere(dorm.whoLivesHere, getDormTab(dorm) === 'freshman' ? 'Freshman' : 'Upperclassman').mainLabel}</p>
                </div>
                <span className="text-sm font-semibold text-primary">{t('housing:explore.search.from')} ${(dorm.semesterRate ?? 0).toLocaleString()}</span>
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const exploreMobileFilterDrawer =
    !searchOnly && isMobile ? (
      <ExploreHousingAdvancedFiltersDrawer
        filters={filters}
        onFiltersChange={onFiltersChange}
        audienceFilter={audienceFilter ?? 'all'}
        onAudienceFilterChange={onAudienceFilterChange ?? (() => {})}
        open={filterOpen}
        onOpenChange={setFilterOpen}
        disabled={exploreToolsOffCampus}
        showAudienceFilter={Boolean(showStudentYearInFilters)}
      />
    ) : null;

  if (useExploreInlineRow) {
    return (
      <div className="flex w-full items-center gap-2 px-4">
        {searchInput}
        <div className={cn('shrink-0', exploreToolsOffCampus && 'pointer-events-none opacity-40')}>
          {savedButton}
        </div>
        <div className={cn('shrink-0', exploreToolsOffCampus && 'pointer-events-none opacity-40')}>
          {exploreMobileFilterDrawer}
        </div>
      </div>
    );
  }

  if (useStackedMobile) {
    return (
      <div className="flex w-full flex-col gap-2">
        <div className="w-full">{searchInput}</div>
        <div
          className={cn(
            'flex w-full items-center gap-2 justify-end',
          )}
        >
          <div className={cn(exploreToolsOffCampus && 'pointer-events-none opacity-40')}>{savedButton}</div>
          {exploreMobileFilterDrawer}
        </div>
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex w-full max-w-7xl flex-col items-stretch gap-3 sm:flex-row sm:flex-nowrap sm:gap-2">
      <div className="flex flex-1 min-w-0 gap-2 sm:contents">
      {searchInput}
      {!searchOnly && (isMobile ? (
        <AdaptiveOverlay open={filterOpen} onOpenChange={setFilterOpen} shouldScaleBackground={false} mobileVariant="drawer">
          <AdaptiveOverlayTrigger asChild>
            <Button
              variant="outline"
              disabled={exploreToolsOffCampus}
              className="relative h-11 w-11 shrink-0 gap-2 rounded-full border border-malachite-600 bg-card px-0 text-sm font-medium text-malachite-800 shadow-none hover:bg-malachite-50 hover:text-malachite-800 dark:text-malachite-300 dark:hover:bg-muted dark:hover:text-malachite-300 dark:[&_svg]:text-malachite-300 sm:h-11 sm:w-auto sm:px-4 [&_svg]:text-malachite-800 disabled:pointer-events-none disabled:opacity-40"
            >
              <SlidersHorizontal className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">Filters</span>
              {activeFilterCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 sm:relative sm:top-0 sm:right-0 sm:inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium px-1.5">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </AdaptiveOverlayTrigger>
          <AdaptiveOverlayContent
            priority
            hideDefaultHandle
            className="h-auto max-h-[85vh] w-full rounded-t-2xl pb-0"
          >
            <div className="mx-auto mt-4 h-2 w-[100px] shrink-0 rounded-full bg-muted" />
            <div className="flex shrink-0 items-center justify-between p-4 pb-0">
              <span className="text-lg font-semibold">Filters</span>
              <Button
                type="button"
                variant="link"
                onClick={handleClearAll}
                // Inline text link: strip the default size's padding/height so it sits inline
                // in the header; link variant already gives hover:underline.
                className="h-auto p-0 text-sm font-medium text-malachite-800 hover:text-malachite-800"
              >
                Clear all
              </Button>
            </div>
            <div className="space-y-6 overflow-y-auto overscroll-contain p-4 pt-0 max-h-[min(56vh,calc(85vh-10rem))]">
              {studentYearSectionDrawer}
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-foreground">Room Capacity</Label>
                <p className="text-xs text-muted-foreground">How many students live in the unit</p>
                <div className="flex flex-wrap gap-2">
                  {ROOM_CAPACITY_OPTIONS.map((opt) => {
                    const isSelected = filters.roomCapacities.has(opt.id);
                    return (
                      <Button
                        key={opt.id}
                        type="button"
                        variant="ghost"
                        onClick={() => handleCapacityToggle(opt.id)}
                        // Toggle chip (see StudentYearSection): preserve per-state pill visuals
                        // and pin hover so the active green chip can't wash gray on hover.
                        className={cn(
                          'h-auto rounded-full border px-3 py-2 text-sm font-medium transition-all',
                          isSelected
                            ? 'border-primary bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
                            : 'border-border bg-card text-foreground hover:border-border hover:bg-card hover:text-foreground'
                        )}
                      >
                        {opt.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold text-foreground">Price Range</Label>
                  <span className="text-sm font-medium text-primary">
                    ${filters.priceRange[0].toLocaleString()} – ${filters.priceRange[1].toLocaleString()}
                  </span>
                </div>
                <Slider
                  value={filters.priceRange}
                  min={0}
                  max={PRICE_MAX}
                  step={100}
                  onValueChange={(value) =>
                    onFiltersChange({ ...filters, priceRange: value as [number, number] })
                  }
                  className="py-2"
                />
                <div className="flex justify-between text-xs text-muted-foreground ">
                  <span>$0</span>
                  <span>$8,000</span>
                </div>
              </div>
              <div className="space-y-3">
                <Label className="text-sm font-semibold text-foreground">Amenities</Label>
                <div className="space-y-3">
                  {AMENITY_ITEMS.map((item) => (
                    <div key={item.id} className="flex items-center justify-between">
                      <Label htmlFor={`filter-drawer-${item.id}`} className="text-sm cursor-pointer font-normal">
                        {item.label}
                      </Label>
                      <Switch
                        id={`filter-drawer-${item.id}`}
                        checked={item.get()}
                        onCheckedChange={(checked) => item.set(checked)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="shrink-0 border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <Button
                type="button"
                className="w-full bg-malachite-800 hover:bg-malachite-900 text-white"
                onClick={() => setFilterOpen(false)}
              >
                Show results
              </Button>
            </div>
          </AdaptiveOverlayContent>
        </AdaptiveOverlay>
      ) : (
        <div className="relative shrink-0">
          {filterOpen && (
            <div
              className="fixed inset-0 z-40 bg-transparent"
              aria-hidden
              onClick={() => setFilterOpen(false)}
            />
          )}
          <Button
            ref={filterTriggerRef}
            variant="outline"
            disabled={exploreToolsOffCampus}
            className="relative h-11 w-11 shrink-0 gap-2 rounded-full border border-malachite-600 bg-card px-0 text-sm font-medium text-malachite-800 shadow-none hover:bg-malachite-50 hover:text-malachite-800 dark:text-malachite-300 dark:hover:bg-muted dark:hover:text-malachite-300 dark:[&_svg]:text-malachite-300 sm:h-11 sm:w-auto sm:px-4 [&_svg]:text-malachite-800 disabled:pointer-events-none disabled:opacity-40"
            onClick={() => setFilterOpen((prev) => !prev)}
            onKeyDown={closeFilterOnEscape}
          >
            <SlidersHorizontal className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Filters</span>
            {activeFilterCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 sm:relative sm:top-0 sm:right-0 sm:inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium px-1.5">
                {activeFilterCount}
              </span>
            )}
          </Button>
          {filterOpen && (
            <div
              className="absolute right-0 top-full z-50 mt-2 flex w-[400px] max-h-[70vh] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-overlay"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={closeFilterOnEscape}
              role="presentation"
            >
              <div className="flex shrink-0 items-center justify-between p-4 pb-3">
                <h3 className="text-lg font-semibold text-foreground">Filters</h3>
                <Button
                  type="button"
                  variant="link"
                  onClick={handleClearAll}
                  // Desktop popover twin of the mobile drawer's Clear all (inline text link).
                  className="h-auto p-0 text-sm font-normal text-malachite-800 hover:text-malachite-800"
                >
                  Clear all
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 scrollbar-thin">
                <div className="space-y-6">
                  {studentYearSectionPopover}
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-foreground">Room Capacity</Label>
                    <p className="text-xs text-muted-foreground">How many students live in the unit</p>
                    <div className="flex flex-wrap gap-2">
                      {ROOM_CAPACITY_OPTIONS.map((opt) => {
                        const isSelected = filters.roomCapacities.has(opt.id);
                        return (
                          <Button
                            key={opt.id}
                            type="button"
                            variant="ghost"
                            onClick={() => handleCapacityToggle(opt.id)}
                            // Desktop popover twin of the mobile drawer capacity chip.
                            className={cn(
                              'h-auto rounded-full border px-3 py-2 text-sm font-medium transition-all',
                              isSelected
                                ? 'border-primary bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
                                : 'border-border bg-card text-foreground hover:border-border hover:bg-card hover:text-foreground'
                            )}
                          >
                            {opt.label}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-semibold text-foreground">Price Range</Label>
                      <span className="text-sm font-medium text-primary">
                        ${filters.priceRange[0].toLocaleString()} – ${filters.priceRange[1].toLocaleString()}
                      </span>
                    </div>
                    <Slider
                      value={filters.priceRange}
                      min={0}
                      max={PRICE_MAX}
                      step={100}
                      onValueChange={(value) =>
                        onFiltersChange({ ...filters, priceRange: value as [number, number] })
                      }
                      className="py-2"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground ">
                      <span>$0</span>
                      <span>$8,000</span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-foreground">Amenities</Label>
                    <div className="space-y-3">
                      {AMENITY_ITEMS.map((item) => (
                        <div key={item.id} className="flex items-center justify-between">
                          <Label htmlFor={`filter-${item.id}`} className="text-sm cursor-pointer font-normal">
                            {item.label}
                          </Label>
                          <Switch
                            id={`filter-${item.id}`}
                            checked={item.get()}
                            onCheckedChange={(checked) => item.set(checked)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
      </div>
    </div>
  );
}
