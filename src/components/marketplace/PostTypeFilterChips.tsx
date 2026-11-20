import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { feedPostTypes, type FeedPostTypeFlags, type PostType } from '@/lib/postTypes';

/**
 * The one feed's post-type chips (PRD §5 Phase 2). A Subleases tab and a
 * Services tab are exactly the funneling the spec exists to prevent, so every
 * type is filtered inside the existing feed rather than routed out of it.
 *
 * Renders nothing when the school has fewer than two queryable types enabled —
 * a chip row that can only say "Items" is chrome with no decision behind it,
 * and today that is every school. This is the switch that turns the row on as
 * types land, not a second place to enable them.
 *
 * Keyed on `feedPostTypes`, which reads the BROWSE gate — not `enabledPostTypes`,
 * which reads the posting one. Those were the same call until 2026-08-17; since
 * the feed filters one `post_type` at a time and defaults to `item`, this row is
 * the only route to any other type, so reading the posting gate here made closing
 * a school's composer close its reading too. See `browseFlag` in src/lib/postTypes.ts.
 */
export function PostTypeFilterChips({
  value,
  onChange,
  flags,
  className,
}: {
  value: PostType;
  onChange: (next: PostType) => void;
  flags: FeedPostTypeFlags;
  className?: string;
}) {
  const { t } = useTranslation();
  const options = feedPostTypes(flags);
  if (options.length < 2) return null;

  return (
    <div
      className={cn('flex flex-wrap gap-1.5', className)}
      role="group"
      aria-label={t('marketplace:postType.filterLabel')}
    >
      {options.map((def) => (
        <Button
          key={def.id}
          type="button"
          variant="outline"
          size="sm"
          haptic="selection"
          onClick={() => onChange(def.id)}
          aria-pressed={value === def.id}
          className={cn(
            'h-7 shrink-0 rounded-pill px-3 text-xs font-medium',
            value === def.id
              ? 'border-foreground bg-muted text-foreground'
              : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {t(def.labelKey)}
        </Button>
      ))}
    </div>
  );
}
