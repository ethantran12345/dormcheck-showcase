import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { MarketplaceScope } from '@/components/dorm-portal/MarketplaceTab';

/**
 * How far the marketplace feed reaches: your own school, or every school
 * sharing your `universities.marketplace_group` (Pitt / CMU / Carlow sit within
 * about a mile of each other, so a listing next door is a real listing).
 *
 * Deliberately a visible two-state control rather than an invisible default:
 * students are being told their school is its own space everywhere else in the
 * app, so the one surface that crosses schools has to SAY it is crossing, and
 * has to start narrow. The caller only renders this when the school actually
 * belongs to a group — a toggle whose other side is empty is worse than none.
 *
 * Mirrors PostTypeFilterChips' shape on purpose: same row, same chip language,
 * so reach reads as one more filter rather than a mode switch.
 */
export function MarketplaceScopeChips({
  value,
  onChange,
  schoolShortName,
  className,
}: {
  value: MarketplaceScope;
  onChange: (next: MarketplaceScope) => void;
  /** The viewer's school, e.g. "Pitt" — named, never "My school". */
  schoolShortName: string;
  className?: string;
}) {
  const { t } = useTranslation();

  const options: Array<{ id: MarketplaceScope; label: string }> = [
    { id: 'school', label: schoolShortName },
    // Group-specific copy: the only group today is Pittsburgh. A second group
    // makes this a per-group label rather than one string.
    { id: 'group', label: t('marketplace:scope.group') },
  ];

  return (
    <div
      className={cn('flex flex-wrap gap-1.5', className)}
      role="group"
      aria-label={t('marketplace:scope.filterLabel')}
    >
      {options.map((option) => (
        <Button
          key={option.id}
          type="button"
          variant="outline"
          size="sm"
          haptic="selection"
          onClick={() => onChange(option.id)}
          aria-pressed={value === option.id}
          className={cn(
            'h-7 shrink-0 rounded-pill px-3 text-xs font-medium',
            value === option.id
              ? 'border-foreground bg-muted text-foreground'
              : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
