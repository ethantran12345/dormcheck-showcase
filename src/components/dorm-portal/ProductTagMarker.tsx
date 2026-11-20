import { cn } from '@/lib/utils';

interface ProductTagMarkerProps {
  xPct: number;
  yPct: number;
  label: string;
  onClick?: (e: React.MouseEvent) => void;
  ariaLabel?: string;
  /** Extra classes on the positioned wrapper (e.g. opacity-50 for sold items). */
  className?: string;
}

export function ProductTagMarker({ xPct, yPct, label, onClick, ariaLabel, className }: ProductTagMarkerProps) {
  const pillAbove = yPct >= 15;
  const alignLeft = xPct < 20;
  const alignRight = xPct > 80;

  const pillAlign = alignLeft ? 'items-start' : alignRight ? 'items-end' : 'items-center';
  const caretAlign = alignLeft
    ? 'left-3'
    : alignRight
      ? 'right-3'
      : 'left-1/2 -translate-x-1/2';

  const TagWrapper = onClick ? 'button' : 'div';

  const defaultAriaLabel = ariaLabel ?? (onClick ? label : undefined);

  return (
    <TagWrapper
      type={onClick ? 'button' : undefined}
      className={cn(
        'absolute z-10 -translate-x-1/2 -translate-y-1/2',
        onClick && 'pointer-events-auto cursor-pointer focus:outline-none',
        className,
      )}
      style={{ left: `${xPct}%`, top: `${yPct}%` }}
      onClick={onClick}
      aria-label={defaultAriaLabel}
    >
      <div className={cn('relative flex flex-col', pillAlign)}>
        {pillAbove && (
          <div className="relative mb-1.5">
            <span className="block max-w-[140px] truncate whitespace-nowrap rounded-md bg-black/80 px-2.5 py-1 text-xs font-semibold text-white shadow-raised">
              {label}
            </span>
            <span
              className={cn(
                'absolute -bottom-1 h-0 w-0 border-x-[5px] border-t-[5px] border-x-transparent border-t-black/80',
                caretAlign,
              )}
              aria-hidden
            />
          </div>
        )}

        <span
          className="h-3.5 w-3.5 shrink-0 rounded-full bg-card ring-2 ring-black/20 shadow-raised"
          aria-hidden
        />

        {!pillAbove && (
          <div className="relative mt-1.5">
            <span
              className={cn(
                'absolute -top-1 h-0 w-0 border-x-[5px] border-b-[5px] border-x-transparent border-b-black/80',
                caretAlign,
              )}
              aria-hidden
            />
            <span className="block max-w-[140px] truncate whitespace-nowrap rounded-md bg-black/80 px-2.5 py-1 text-xs font-semibold text-white shadow-raised">
              {label}
            </span>
          </div>
        )}
      </div>
    </TagWrapper>
  );
}
