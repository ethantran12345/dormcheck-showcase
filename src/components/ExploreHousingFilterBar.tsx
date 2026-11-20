import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dorm } from '@/types';
import { getDormTab, formatWhoLivesHere } from '@/lib/dormUtils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import type {
  AdvancedFilters,
  AudienceFilterTab,
  CampusScopeTab,
} from '@/components/DormSearch';
import { defaultFilters, PRICE_MAX, StudentYearFilterSection } from '@/components/DormSearch';

const ROOM_CAPACITY_OPTIONS = [
  { id: '1-person', label: 'Single' },
  { id: '2-person', label: 'Double' },
  { id: '3-person', label: 'Triple' },
  { id: '4-person', label: 'Quad' },
  { id: '5-plus-person', label: 'Quintuple' },
] as const;

interface ExploreHousingFilterBarProps {
  allDorms: Dorm[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onDormSelect: (dorm: Dorm) => void;
  campusScope: CampusScopeTab;
  onCampusScopeChange: (scope: CampusScopeTab) => void;
  audienceFilter: AudienceFilterTab;
  onAudienceFilterChange: (filter: AudienceFilterTab) => void;
  filters: AdvancedFilters;
  onFiltersChange: (filters: AdvancedFilters) => void;
  disableHousingToggle?: boolean;
}

export function ExploreHousingFilterBar({
  allDorms,
  searchQuery,
  onSearchChange,
  onDormSelect,
  campusScope,
  onCampusScopeChange,
  audienceFilter,
  onAudienceFilterChange,
  filters,
  onFiltersChange,
  disableHousingToggle = false,
}: ExploreHousingFilterBarProps) {
  const { t } = useTranslation();
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    const q = (searchQuery || '').trim();
    if (!q) return [];
    const lower = q.toLowerCase();
    return (allDorms || []).filter((d) => (d.name ?? '').toLowerCase().includes(lower)).slice(0, 6);
  }, [allDorms, searchQuery]);

  const activeFilterCount =
    filters.roomCapacities.size +
    (filters.priceRange[0] > 0 || filters.priceRange[1] < PRICE_MAX ? 1 : 0) +
    (filters.hasAC ? 1 : 0) +
    (filters.hasPrivateBath ? 1 : 0) +
    (filters.hasKitchen ? 1 : 0) +
    (audienceFilter !== 'all' ? 1 : 0);

  const exploreToolsOffCampus = campusScope === 'off-campus';

  // Off-campus tab hidden from UI; set to true to restore the scope toggle row.
  const campusScopeToggleVisible = false;

  useEffect(() => {
    if (exploreToolsOffCampus) setFilterOpen(false);
  }, [exploreToolsOffCampus]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCapacityToggle = (id: string) => {
    const next = new Set(filters.roomCapacities);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onFiltersChange({ ...filters, roomCapacities: next });
  };

  const handleClearAll = useCallback(() => {
    onFiltersChange(defaultFilters);
    onAudienceFilterChange('all');
  }, [onFiltersChange, onAudienceFilterChange]);

  const handleDormClick = (dorm: Dorm) => {
    onSearchChange(dorm.name ?? '');
    setShowSuggestions(false);
    onDormSelect(dorm);
  };

  const handleClearSearch = () => {
    onSearchChange('');
    setShowSuggestions(false);
  };

  return (
    <div className="sticky top-0 z-50 flex w-full shrink-0 flex-col border-b border-border bg-card">
      <div className="flex shrink-0 items-center gap-4 px-6 py-5">
      {/* Search - grows to fill available space */}
      <div
        className={cn(
          'flex min-w-0 flex-1 items-center',
          exploreToolsOffCampus && 'pointer-events-none opacity-40',
        )}
      >
        <div className="relative w-full" ref={searchRef}>
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder={t('housing:explore.search.placeholder')}
            aria-label={t('housing:explore.search.ariaLabel')}
            value={searchQuery}
            onChange={(e) => {
              onSearchChange(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            className="h-11 w-full pl-11 pr-9 rounded-full border border-border bg-card focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-0"
          />
          {searchQuery && (
            <button
              onClick={handleClearSearch}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-accent transition-colors"
              aria-label={t('common:actions.clearSearch')}
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
          {showSuggestions && searchQuery.trim() && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-xl shadow-overlay z-[100] overflow-hidden">
              <div className="py-2">
                <p className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t('housing:explore.search.suggestions')}
                </p>
                {suggestions.map((dorm) => (
                  <button
                    key={dorm.id}
                    onClick={() => handleDormClick(dorm)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent transition-colors text-left"
                  >
                    <div>
                      <p className="font-medium text-foreground">{dorm.name ?? t('housing:explore.search.building')}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatWhoLivesHere(
                          dorm.whoLivesHere,
                          // fallbackAudience expects the literal audience type (used via
                          // === 'Freshman'); passing a translated label never matched.
                          getDormTab(dorm) === 'freshman' ? 'Freshman' : 'Upperclassman'
                        ).mainLabel}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-primary">
                      {t('housing:explore.search.from')} ${(dorm.semesterRate ?? 0).toLocaleString()}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {campusScopeToggleVisible && (
        <div
          className={cn(
            'flex min-w-0 shrink-0 items-center',
            disableHousingToggle && 'pointer-events-none opacity-50',
          )}
        >
          <div className="flex h-11 w-full min-w-[240px] rounded-full bg-muted p-1">
            <button
              type="button"
              onClick={() => onCampusScopeChange('on-campus')}
              className={cn(
                'h-full flex-1 rounded-full px-4 text-sm font-medium transition-colors',
                campusScope === 'on-campus'
                  ? 'bg-card text-malachite-800 shadow-raised'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t('housing:explore.filterBar.onCampus')}
            </button>
            {/* Off-Campus tab - hidden until re-enabled
            <button
              type="button"
              onClick={() => onCampusScopeChange('off-campus')}
              className={cn(
                'h-full flex-1 rounded-full px-4 text-sm font-medium transition-colors',
                campusScope === 'off-campus'
                  ? 'bg-card text-malachite-800 shadow-raised'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Off-Campus
            </button>
            */}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex shrink-0 items-center gap-2">
      <Popover open={filterOpen} onOpenChange={setFilterOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            disabled={exploreToolsOffCampus}
            className="relative h-11 shrink-0 rounded-full border border-malachite-600 bg-card px-4 text-sm font-medium text-malachite-800 shadow-none hover:bg-malachite-50 dark:hover:bg-muted hover:text-malachite-800 flex items-center gap-2 [&_svg]:text-malachite-800 disabled:pointer-events-none disabled:opacity-40 dark:text-malachite-300 dark:[&_svg]:text-malachite-300 dark:hover:text-malachite-300"
          >
            <SlidersHorizontal className="w-4 h-4 shrink-0" />
            {t('common:actions.filters')}
            {activeFilterCount > 0 && (
              <span className="ml-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium px-1.5">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="end" sideOffset={8}>
          <div className="p-4 border-b flex items-center justify-between">
            <h3 className="font-semibold">{t('common:actions.filters')}</h3>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                className="text-sm font-medium text-primary hover:underline"
              >
                {t('common:actions.clearAll')}
              </button>
            )}
          </div>
          <div className="p-4 space-y-6 max-h-[60vh] overflow-y-auto">
            {campusScope === 'on-campus' && (
              <StudentYearFilterSection
                audienceFilter={audienceFilter}
                onAudienceFilterChange={onAudienceFilterChange}
                labelClassName="text-sm font-medium"
                unselectedVariant="muted"
              />
            )}
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t('housing:explore.filterBar.roomType')}</Label>
              <div className="flex flex-wrap gap-2">
                {ROOM_CAPACITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleCapacityToggle(opt.id)}
                    className={cn(
                      'px-3 py-2 rounded-full text-sm font-medium border transition-all',
                      filters.roomCapacities.has(opt.id)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted/50 border-transparent hover:border-border'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-sm font-medium">{t('housing:explore.filterBar.price')}</Label>
                <span className="text-sm font-medium">
                  ${filters.priceRange[0].toLocaleString()} – ${filters.priceRange[1].toLocaleString()}
                </span>
              </div>
              <Slider
                value={filters.priceRange}
                min={0}
                max={PRICE_MAX}
                step={100}
                onValueChange={(v) =>
                  onFiltersChange({ ...filters, priceRange: v as [number, number] })
                }
                className="py-1"
              />
            </div>
            <div className="space-y-3">
              <Label className="text-sm font-medium">{t('housing:explore.filterBar.amenities')}</Label>
              <div className="space-y-3">
                {[
                  { id: 'ac', label: t('housing:explore.filterBar.airConditioning'), get: () => filters.hasAC, set: (v: boolean) => onFiltersChange({ ...filters, hasAC: v }) },
                  { id: 'bath', label: t('housing:explore.filterBar.privateBathroom'), get: () => filters.hasPrivateBath, set: (v: boolean) => onFiltersChange({ ...filters, hasPrivateBath: v }) },
                  { id: 'kitchen', label: t('housing:explore.filterBar.kitchen'), get: () => filters.hasKitchen, set: (v: boolean) => onFiltersChange({ ...filters, hasKitchen: v }) },
                ].map((item) => (
                  <div key={item.id} className="flex items-center justify-between">
                    <Label htmlFor={`explore-${item.id}`} className="text-sm font-normal cursor-pointer">
                      {item.label}
                    </Label>
                    <Switch
                      id={`explore-${item.id}`}
                      checked={item.get()}
                      onCheckedChange={item.set}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      </div>
      </div>
    </div>
  );
}
