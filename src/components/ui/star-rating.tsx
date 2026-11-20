import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Half-step star ENTRY control.
 *
 * Display is deliberately not duplicated here: `StarRatingDisplay` in
 * `@/components/marketplace/StarRating` already renders fractional fill and is
 * the app's established read-only star row. This file adds only the thing that
 * did not exist - a picker with half-star granularity. The marketplace input is
 * whole-star radiogroup semantics for seller ratings and is left alone.
 *
 * Colour matches that component (`amber-500`), so stars read the same
 * everywhere in the app.
 */

const MAX = 5;

const SIZE_CLASSES = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-7 w-7',
} as const;

export type StarSize = keyof typeof SIZE_CLASSES;

/** Snap to the nearest 0.5 and clamp into [0.5, 5]. */
function snapToHalf(value: number): number {
  const snapped = Math.round(value * 2) / 2;
  return Math.min(MAX, Math.max(0.5, snapped));
}

export type StarRatingInputProps = {
  /** null = not yet rated. */
  value: number | null;
  onChange: (value: number) => void;
  /** Names the control for screen readers. Required: an unlabelled rating row
   *  is meaningless when there are four of them on one screen. */
  label: string;
  size?: StarSize;
  disabled?: boolean;
  className?: string;
};

/**
 * Exposed as role="slider" rather than a ten-way radiogroup: arrow keys then
 * give half-step increments for free, and one focus stop per category keeps a
 * four-row form from costing forty tab stops.
 */
export function StarRatingInput({
  value,
  onChange,
  label,
  size = 'lg',
  disabled = false,
  className,
}: StarRatingInputProps) {
  const shown = value ?? 0;
  const starClass = SIZE_CLASSES[size];

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const current = value ?? 0;
    let next: number;

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = snapToHalf(current + 0.5);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = snapToHalf(current - 0.5);
        break;
      case 'Home':
        next = 0.5;
        break;
      case 'End':
        next = MAX;
        break;
      default:
        return;
    }

    e.preventDefault();
    onChange(next);
  };

  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0.5}
      aria-valuemax={MAX}
      aria-valuenow={value ?? undefined}
      aria-valuetext={value === null ? 'Not rated' : `${value} out of ${MAX} stars`}
      aria-disabled={disabled || undefined}
      onKeyDown={handleKeyDown}
      className={cn(
        'inline-flex items-center gap-1 rounded-control',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-2',
        disabled && 'opacity-50',
        className,
      )}
    >
      {[1, 2, 3, 4, 5].map((position) => {
        // Same fractional-fill technique as marketplace/StarRating's StarRow:
        // overlay a width-clipped filled star on an empty one.
        const fillRatio = Math.max(0, Math.min(1, shown - (position - 1)));
        const half = position - 0.5;
        return (
          // Outer box is 44px tall so each HALF target is 22x44 - at or above the
          // WCAG touch-target floor, and matching the h-11 w-11 the marketplace
          // star picker already uses. The star itself stays visually smaller.
          <span
            key={position}
            className={cn('relative inline-flex h-11 items-center justify-center', size === 'lg' ? 'w-11' : 'w-6')}
          >
            <span className={cn('relative inline-block', starClass)}>
              <Star className={cn(starClass, 'text-muted-foreground/40')} strokeWidth={1.5} />
              {fillRatio > 0 && (
                <span
                  className="pointer-events-none absolute inset-0 overflow-hidden"
                  style={{ width: `${fillRatio * 100}%` }}
                  aria-hidden="true"
                >
                  <Star className={cn(starClass, 'fill-amber-500 text-amber-500')} strokeWidth={1.5} />
                </span>
              )}
            </span>

            {/* Two hit targets per star: left half sets N.5, right half sets N.
                They are pointer affordances only - keyboard users drive the
                slider above, so these stay out of the tab order. */}
            <button
              type="button"
              disabled={disabled}
              tabIndex={-1}
              onClick={() => onChange(half)}
              className="absolute inset-y-0 left-0 w-1/2 disabled:cursor-default"
              aria-label={`${label}: ${half} stars`}
            />
            <button
              type="button"
              disabled={disabled}
              tabIndex={-1}
              onClick={() => onChange(position)}
              className="absolute inset-y-0 right-0 w-1/2 disabled:cursor-default"
              aria-label={`${label}: ${position} stars`}
            />
          </span>
        );
      })}
    </div>
  );
}
