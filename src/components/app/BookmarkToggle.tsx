import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Bookmark } from 'lucide-react';
import { useBookmarks } from '@/contexts/BookmarksContext';
import { useUniversity } from '@/contexts/UniversityContext';
import { resolveBookmarkMeta } from '@/lib/bookmarks';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Mercury-style bookmark toggle placed inline next to a page's title. Adds or
 * removes the current page from the sidebar "Bookmarks" section. Desktop web
 * only (`hidden md:inline-flex`) - the bookmarks feature lives in the desktop
 * sidebar, so this stays out of mobile/native title rows even when shared.
 *
 * `title` overrides the generic page label (e.g. a specific dorm name).
 */
export function BookmarkToggle({
  title,
  className,
}: {
  title?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { university } = useUniversity();
  const { isBookmarked, toggle } = useBookmarks();

  const entry = resolveBookmarkMeta(pathname, {
    titleOverride: title,
    universityShortName: university.shortName,
  });
  if (!entry) return null;

  const active = isBookmarked(entry.path);
  const label = active ? t('misc:bookmark.remove') : t('misc:bookmark.add');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => toggle(entry)}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            'hidden h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1 md:inline-flex',
            active
              ? 'text-foreground hover:bg-accent'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            className,
          )}
        >
          <Bookmark className={cn('h-[18px] w-[18px]', active && 'fill-current')} aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
