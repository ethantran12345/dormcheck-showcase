import { useEffect, useMemo, useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  AdaptiveOverlay,
  AdaptiveOverlayContent,
  AdaptiveOverlayTrigger,
} from '@/components/ui/adaptive-overlay';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useIsMobile } from '@/hooks/use-mobile';
import { useModalOverlay } from '@/contexts/ModalOverlayContext';
import {
  defaultFilters,
  PRICE_MAX,
  StudentYearFilterSection,
  type AdvancedFilters,
  type AudienceFilterTab,
} from '@/components/DormSearch';

const ROOM_CAPACITY_OPTIONS = [
  { id: '1-person', label: 'Single' },
  { id: '2-person', label: 'Double' },
  { id: '3-person', label: 'Triple' },
  { id: '4-person', label: 'Quad' },
  { id: '5-plus-person', label: 'Quintuple' },
] as const;

function getExploreHousingActiveFilterCount(
  filters: AdvancedFilters,
  audienceFilter?: AudienceFilterTab,
): number {
  let count = 0;
  if (filters.roomCapacities.size > 0) count += filters.roomCapacities.size;
  if (filters.priceRange[0] > 0 || filters.priceRange[1] < PRICE_MAX) count += 1;
  if (filters.hasAC) count += 1;
  if (filters.hasPrivateBath) count += 1;
  if (filters.hasKitchen) count += 1;
  if (audienceFilter != null && audienceFilter !== 'all') count += 1;
  return count;
}

interface ExploreHousingAdvancedFiltersDrawerProps {
  filters: AdvancedFilters;
  onFiltersChange: (filters: AdvancedFilters) => void;
  audienceFilter: AudienceFilterTab;
  onAudienceFilterChange: (filter: AudienceFilterTab) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  /** When false, hides Student Year pills (e.g. off-campus explore). */
  showAudienceFilter?: boolean;
  /** Custom trigger; default is full-size pill (DormSearch). Use `triggerVariant="compact"` (outline) or `"compact-filled"` (solid brand) for the sheet header. */
  trigger?: ReactNode;
  triggerVariant?: 'default' | 'compact' | 'compact-filled';
}

export function ExploreHousingAdvancedFiltersDrawer({
  filters,
  onFiltersChange,
  audienceFilter,
  onAudienceFilterChange,
  open,
  onOpenChange,
  disabled = false,
  showAudienceFilter = true,
  trigger,
  triggerVariant = 'default',
}: ExploreHousingAdvancedFiltersDrawerProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const modalOverlay = useModalOverlay();

  const activeFilterCount = useMemo(
    () =>
      getExploreHousingActiveFilterCount(
        filters,
        showAudienceFilter ? audienceFilter : undefined,
      ),
    [filters, audienceFilter, showAudienceFilter],
  );

  useEffect(() => {
    if (isMobile && modalOverlay) {
      modalOverlay.setHideBottomNav(open);
      return () => {
        modalOverlay.setHideBottomNav(false);
      };
    }
  }, [open, isMobile, modalOverlay]);

  const handleCapacityToggle = useCallback(
    (id: string) => {
      const next = new Set(filters.roomCapacities);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onFiltersChange({ ...filters, roomCapacities: next });
    },
    [filters, onFiltersChange],
  );

  const handleClearAll = useCallback(() => {
    onFiltersChange(defaultFilters);
    if (showAudienceFilter) onAudienceFilterChange('all');
  }, [onFiltersChange, onAudienceFilterChange, showAudienceFilter]);

  const amenityItems = useMemo(
    () => [
      {
        id: 'ac' as const,
        label: t('housing:explore.advancedFilters.airConditioning'),
        get: () => filters.hasAC,
        set: (v: boolean) => onFiltersChange({ ...filters, hasAC: v }),
      },
      {
        id: 'bath' as const,
        label: t('housing:explore.advancedFilters.privateBathroom'),
        get: () => filters.hasPrivateBath,
        set: (v: boolean) => onFiltersChange({ ...filters, hasPrivateBath: v }),
      },
      {
        id: 'kitchen' as const,
        label: t('housing:explore.advancedFilters.kitchen'),
        get: () => filters.hasKitchen,
        set: (v: boolean) => onFiltersChange({ ...filters, hasKitchen: v }),
      },
    ],
    [filters, onFiltersChange, t],
  );

  const isCompact = triggerVariant === 'compact' || triggerVariant === 'compact-filled';
  const isFilledTrigger = triggerVariant === 'compact-filled';
  const defaultTrigger =
    isCompact ? (
      <button
        type="button"
        disabled={disabled}
        onPointerDown={(e) => e.stopPropagation()}
        className={cn(
          'inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-full border px-3 text-xs font-medium shadow-none transition-colors disabled:pointer-events-none disabled:opacity-40',
          isFilledTrigger
            ? 'border-malachite-600 bg-malachite-800 text-white hover:bg-malachite-900 [&_svg]:text-white'
            : 'border-malachite-600 bg-card text-malachite-600 hover:bg-muted [&_svg]:text-malachite-600 dark:text-malachite-300 dark:[&_svg]:text-malachite-300',
        )}
        aria-label={t('common:actions.filters')}
      >
        <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
        {t('common:actions.filters')}
        {activeFilterCount > 0 && (
          <span
            className={cn(
              'inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold',
              isFilledTrigger ? 'bg-white text-malachite-800' : 'bg-malachite-800 text-white',
            )}
          >
            {activeFilterCount}
          </span>
        )}
      </button>
    ) : (
      <Button
        variant="outline"
        disabled={disabled}
        className="relative h-11 shrink-0 gap-2 rounded-full border border-malachite-600 bg-card px-4 text-sm font-medium text-malachite-800 shadow-none hover:bg-muted hover:text-malachite-800 [&_svg]:text-malachite-800 disabled:pointer-events-none disabled:opacity-40 dark:text-malachite-300 dark:[&_svg]:text-malachite-300 dark:hover:text-malachite-300"
      >
        <SlidersHorizontal className="h-4 w-4 shrink-0" />
        {t('common:actions.filters')}
        {activeFilterCount > 0 && (
          <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
            {activeFilterCount}
          </span>
        )}
      </Button>
    );

  // Shared filter controls — identical on mobile (bottom Drawer) and desktop
  // (anchored Popover), so the two branches never drift.
  const clearAllButton = activeFilterCount > 0 && (
    <button
      type="button"
      onClick={handleClearAll}
      className="text-sm font-medium text-malachite-800 hover:underline"
    >
      {t('common:actions.clearAll')}
    </button>
  );

  const filterSections = (
    <>
      {showAudienceFilter ? (
        <StudentYearFilterSection
          audienceFilter={audienceFilter}
          onAudienceFilterChange={onAudienceFilterChange}
          labelClassName="text-sm font-semibold text-foreground"
          unselectedVariant="border"
        />
      ) : null}
      <div className="space-y-2">
        <Label className="text-sm font-semibold text-foreground">{t('housing:explore.advancedFilters.roomCapacity')}</Label>
        <p className="text-xs text-muted-foreground">{t('housing:explore.advancedFilters.roomCapacityHint')}</p>
        <div className="flex flex-wrap gap-2">
          {ROOM_CAPACITY_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleCapacityToggle(opt.id)}
              className={cn(
                'inline-flex items-center rounded-full border px-3 py-2 text-sm font-medium transition-all',
                filters.roomCapacities.has(opt.id)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-foreground hover:border-border',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between">
          <Label className="text-sm font-semibold text-foreground">{t('housing:explore.advancedFilters.priceRange')}</Label>
          <span className="text-sm font-medium text-primary">
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
          className="py-2"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>$0</span>
          <span>$8,000</span>
        </div>
      </div>
      <div className="space-y-3">
        <Label className="text-sm font-semibold text-foreground">{t('housing:explore.advancedFilters.amenities')}</Label>
        <div className="space-y-3">
          {amenityItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between">
              <Label
                htmlFor={`explore-housing-filter-${item.id}`}
                className="cursor-pointer text-sm font-normal"
              >
                {item.label}
              </Label>
              <Switch
                id={`explore-housing-filter-${item.id}`}
                checked={item.get()}
                onCheckedChange={(c) => item.set(c)}
              />
            </div>
          ))}
        </div>
      </div>
    </>
  );

  const showResultsButton = (
    <Button
      type="button"
      className="w-full bg-malachite-800 hover:bg-malachite-900 text-white"
      onClick={() => onOpenChange(false)}
    >
      {t('housing:explore.advancedFilters.showResults')}
    </Button>
  );

  // Desktop: anchored Popover (matches every other filter panel in the app).
  if (!isMobile) {
    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>{trigger ?? defaultTrigger}</PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          className="flex max-h-[min(70vh,560px)] w-[min(92vw,360px)] flex-col gap-0 p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border p-4">
            <span className="text-base font-semibold">{t('common:actions.filters')}</span>
            {clearAllButton}
          </div>
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-4">
            {filterSections}
          </div>
          <div className="shrink-0 border-t border-border p-4">{showResultsButton}</div>
        </PopoverContent>
      </Popover>
    );
  }

  // Mobile: byte-identical to the previous vaul Drawer (drag pill, safe-area footer).
  return (
    <AdaptiveOverlay open={open} onOpenChange={onOpenChange} mobileVariant="drawer" shouldScaleBackground={false}>
      <AdaptiveOverlayTrigger asChild>{trigger ?? defaultTrigger}</AdaptiveOverlayTrigger>
      <AdaptiveOverlayContent
        priority
        hideDefaultHandle
        className="h-auto max-h-[85vh] w-full rounded-t-2xl pb-0"
      >
        <div className="mx-auto mt-4 h-2 w-[100px] shrink-0 rounded-full bg-muted" />
        <div className="flex shrink-0 items-center justify-between p-4 pb-0">
          <span className="text-lg font-semibold">{t('common:actions.filters')}</span>
          {clearAllButton}
        </div>
        <div className="space-y-6 overflow-y-auto overscroll-contain p-4 pt-0 max-h-[min(56vh,calc(85vh-10rem))]">
          {filterSections}
        </div>
        <div className="shrink-0 border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {showResultsButton}
        </div>
      </AdaptiveOverlayContent>
    </AdaptiveOverlay>
  );
}
