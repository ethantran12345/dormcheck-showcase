import type { ReactNode } from 'react';
import { Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { PAGE_SEARCH_ATTR } from '@/lib/pageSearch';
import { useIsMobile } from '@/hooks/use-mobile';

/**
 * The one page-toolbar used across every collection page (Marketplace,
 * Roommates browse, Housing/Dorms, Student Setups). Row 2 of <AppPageHeader>.
 *
 *   desktop  [ 🔍 scoped search (this page only) ]   [ ⚙ Filters ]  {trailing}
 *   mobile   [ 🔍 scoped search                 ⚙ ]                {trailing}
 *
 * Scoped search filters the CURRENT page - it is deliberately distinct from the
 * sidebar's global "Search for anything" palette. There is ONE filter control:
 * the pill Filters button (never "Sort & Filter" / "Map Filters" as a second
 * variant - map overlays stay on the map).
 *
 * On mobile the Filters trigger collapses INTO the search bar as a sliders icon
 * (one control surface, less header chrome - matches the Marketplace pattern);
 * on desktop it stays the labelled pill beside the search. Drive it with
 * `onFilterClick` (+ `filterActive`/`filterCount`) so the inline icon can own
 * the trigger; pass a `filter` node only for a bespoke *desktop* control (e.g. a
 * Popover). When both are given, keep the mobile overlay controlled so it still
 * mounts from `filter` while the inline icon toggles it via `onFilterClick`.
 */
type PageToolbarProps = {
  /** Controlled scoped-search value. Omit both search props to hide the input. */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  /** Standard Filters button. Ignored when `filter` is provided. */
  onFilterClick?: () => void;
  /** Show the active dot / count badge on the Filters button. */
  filterActive?: boolean;
  filterCount?: number;
  filterLabel?: string;
  /** Accessible name for the mobile inline sliders icon (falls back to filterLabel). */
  filterAriaLabel?: string;
  /**
   * Bespoke DESKTOP filter control (e.g. a Popover trigger) instead of the
   * default pill. On mobile it still renders so a controlled overlay (Drawer)
   * mounts, while the inline search-bar icon owns the visible trigger.
   */
  filter?: ReactNode;
  /**
   * Mobile-only primary post CTA rendered as a round ⊕ button on the right of
   * the search row (e.g. "Post your setup"). Desktop keeps its labeled header
   * button, so the ⊕ only shows below `md` to avoid duplication.
   */
  onPostClick?: () => void;
  postAriaLabel?: string;
  /** Extra controls right of Filters (e.g. a Sort dropdown). */
  trailing?: ReactNode;
  className?: string;
};

export function PageToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchAriaLabel,
  onFilterClick,
  filterActive,
  filterCount,
  filterLabel,
  filterAriaLabel,
  filter,
  onPostClick,
  postAriaLabel,
  trailing,
  className,
}: PageToolbarProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const hasSearch = onSearchChange !== undefined;
  // Mobile: the Filters trigger collapses into the search bar as a sliders icon.
  // Needs a search field to sit inside and an onFilterClick to fire.
  const inlineFilter = isMobile && hasSearch && onFilterClick !== undefined;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {hasSearch && (
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            // P8.3: the "/" shortcut looks for this attribute to focus the CURRENT
            // page's scoped search. It is the marker, not a style hook - see
            // PAGE_SEARCH_ATTR in src/lib/pageSearch.ts (single source of truth).
            {...{ [PAGE_SEARCH_ATTR]: '' }}
            value={searchValue ?? ''}
            onChange={(e) => onSearchChange?.(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchAriaLabel ?? searchPlaceholder}
            // P8.5 desktop density: 44px finger target on touch, 40px for a pointer.
            className={cn('h-11 rounded-full pl-9 lg:h-10', inlineFilter && 'pr-12')}
          />
          {inlineFilter && (
            <button
              type="button"
              onClick={onFilterClick}
              aria-label={
                filterActive && filterCount
                  ? `${filterAriaLabel ?? filterLabel ?? t('common:labels.filters')} (${filterCount})`
                  : filterAriaLabel ?? filterLabel ?? t('common:labels.filters')
              }
              className={cn(
                'absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full transition-colors',
                filterActive
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden />
            </button>
          )}
        </div>
      )}
      {/* Mobile-only ⊕ post CTA — desktop uses its labeled header button, so
          this is hidden at md+ to avoid a duplicate control. */}
      {onPostClick && (
        <button
          type="button"
          onClick={onPostClick}
          aria-label={postAriaLabel ?? t('common:labels.post')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border/70 bg-card text-muted-foreground shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-colors hover:bg-muted/60 hover:text-foreground md:hidden"
        >
          <Plus className="h-5 w-5 shrink-0" aria-hidden />
        </button>
      )}
      {/* Custom `filter` node always renders (mounts a controlled Drawer on
          mobile); the default pill renders only when the icon isn't inlined. */}
      {filter ??
        (!inlineFilter && onFilterClick && (
          <button
            type="button"
            onClick={onFilterClick}
            // P8.5 desktop density: matches the search field's lg:h-10.
            className="relative flex h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground shadow-none transition-colors hover:bg-accent lg:h-10 [&_svg]:text-muted-foreground"
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden />
            <span>{filterLabel ?? t('common:labels.filters')}</span>
            {filterActive &&
              (filterCount ? (
                <span className="ml-0.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-foreground px-1 text-xs font-semibold text-background">
                  {filterCount}
                </span>
              ) : (
                <span className="ml-0.5 h-2 w-2 rounded-full bg-foreground" aria-hidden />
              ))}
          </button>
        ))}
      {trailing}
    </div>
  );
}
