import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { selectableServiceCategories, type ServiceCategory } from '@/lib/postTypes';

/**
 * Category filter for the service half of the one feed.
 *
 * NOT a Services tab. PostTypeFilterChips says why: a Subleases tab and a
 * Services tab are the funneling the PRD exists to prevent, so services filter
 * INSIDE the feed. What was actually missing was a level below that — with nine
 * categories in one undifferentiated list, a student looking for a ride reads
 * nine tutoring posts to find one. This is that level, and it renders only when
 * a service post type is selected.
 *
 * The option list follows the legal gate via `selectableServiceCategories`, so
 * it cannot offer a filter for a category nobody in reach can post.
 */
export function ServiceCategoryChips({
  value,
  onChange,
  remoteOpen,
  className,
}: {
  /** null = no category filter, the default. */
  value: ServiceCategory | null;
  onChange: (next: ServiceCategory | null) => void;
  remoteOpen: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const options = selectableServiceCategories(remoteOpen);

  return (
    <div
      className={cn('flex flex-wrap gap-1.5', className)}
      role="group"
      aria-label={t('marketplace:service.filterLabel')}
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        haptic="selection"
        onClick={() => onChange(null)}
        aria-pressed={value === null}
        className={cn(
          'h-7 shrink-0 rounded-pill px-3 text-xs font-medium',
          value === null
            ? 'border-foreground bg-muted text-foreground'
            : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        {t('marketplace:service.allCategories')}
      </Button>
      {options.map((c) => (
        <Button
          key={c}
          type="button"
          variant="outline"
          size="sm"
          haptic="selection"
          onClick={() => onChange(value === c ? null : c)}
          aria-pressed={value === c}
          className={cn(
            'h-7 shrink-0 rounded-pill px-3 text-xs font-medium',
            value === c
              ? 'border-foreground bg-muted text-foreground'
              : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {t(`marketplace:service.categories.${c}`)}
        </Button>
      ))}
    </div>
  );
}
