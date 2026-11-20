import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

const SIZE_CLASSES = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-6 w-6',
} as const;

type StarSize = keyof typeof SIZE_CLASSES;

function StarRow({ value, size }: { value: number; size: StarSize }) {
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((position) => {
        // Fractional fill: overlay a width-clipped filled star on an empty one.
        const fillRatio = Math.max(0, Math.min(1, value - (position - 1)));
        return (
          <span key={position} className={cn('relative inline-block', SIZE_CLASSES[size])}>
            <Star className={cn(SIZE_CLASSES[size], 'text-muted-foreground/40')} strokeWidth={1.5} />
            {fillRatio > 0 && (
              <span
                className="absolute inset-0 overflow-hidden"
                style={{ width: `${fillRatio * 100}%` }}
              >
                <Star
                  className={cn(SIZE_CLASSES[size], 'fill-amber-500 text-amber-500')}
                  strokeWidth={1.5}
                />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

export type StarRatingDisplayProps = {
  value: number;
  count?: number;
  size?: StarSize;
  showValue?: boolean;
  className?: string;
};

/** Read-only star row, e.g. "4.8 ***** (12)". */
export function StarRatingDisplay({
  value,
  count,
  size = 'md',
  showValue = true,
  className,
}: StarRatingDisplayProps) {
  const { t } = useTranslation();
  const rounded = Math.round(value * 10) / 10;
  const label =
    count != null
      ? t('marketplace:rating.ariaWithCount', { value: rounded, count })
      : t('marketplace:rating.aria', { value: rounded });

  return (
    <span
      role="img"
      aria-label={label}
      className={cn('inline-flex items-center gap-1.5', className)}
    >
      {showValue && (
        <span aria-hidden="true" className="text-sm font-semibold text-foreground">
          {rounded.toFixed(1)}
        </span>
      )}
      <StarRow value={rounded} size={size} />
      {count != null && (
        <span aria-hidden="true" className="text-sm text-muted-foreground">
          ({count})
        </span>
      )}
    </span>
  );
}

export type StarRatingInputProps = {
  value: number;
  onChange: (stars: number) => void;
  disabled?: boolean;
  className?: string;
};

/** Interactive 1 to 5 star picker with radiogroup semantics. */
export function StarRatingInput({ value, onChange, disabled, className }: StarRatingInputProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(0);
  const shown = hovered || value;

  return (
    <div
      role="radiogroup"
      aria-label={t('marketplace:rating.inputLabel')}
      tabIndex={-1}
      className={cn('inline-flex items-center gap-1', className)}
      onMouseLeave={() => setHovered(0)}
    >
      {[1, 2, 3, 4, 5].map((stars) => (
        <button
          key={stars}
          type="button"
          role="radio"
          aria-checked={value === stars}
          aria-label={t('marketplace:rating.starsCount', { count: stars })}
          disabled={disabled}
          onClick={() => onChange(stars)}
          onMouseEnter={() => setHovered(stars)}
          onFocus={() => setHovered(stars)}
          onBlur={() => setHovered(0)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
              e.preventDefault();
              onChange(Math.min(5, (value || 0) + 1));
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
              e.preventDefault();
              onChange(Math.max(1, (value || 1) - 1));
            }
          }}
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-lg transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-2',
            disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-muted'
          )}
        >
          <Star
            className={cn(
              'h-7 w-7 transition-colors',
              stars <= shown ? 'fill-amber-500 text-amber-500' : 'text-muted-foreground/50'
            )}
            strokeWidth={1.5}
          />
        </button>
      ))}
    </div>
  );
}
