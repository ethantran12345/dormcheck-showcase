import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const TOOLTIP_WIDTH = 296;
const ARROW_HALF = 8;
const VIEWPORT_MARGIN = 12;
const TARGET_GAP = 14;

export type TooltipPlacement = 'above' | 'below';

interface TourTooltipProps {
  targetRect: DOMRect;
  placement: TooltipPlacement;
  title: string;
  description: string;
  stepIndex: number;
  totalSteps: number;
  icon?: LucideIcon;
  onSkip: () => void;
  onNext: () => void;
  onPrev?: () => void;
}

/**
 * Floating tooltip with an arrow that points at the spotlight target. Positioned
 * via `position: fixed` coordinates derived from the target's `DOMRect`.
 */
export function TourTooltip({
  targetRect,
  placement,
  title,
  description,
  stepIndex,
  totalSteps,
  icon: Icon,
  onSkip,
  onNext,
  onPrev,
}: TourTooltipProps) {
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const nextButtonRef = useRef<HTMLButtonElement | null>(null);
  const [measuredHeight, setMeasuredHeight] = useState(180);

  useEffect(() => {
    const node = tooltipRef.current;
    if (!node) return;
    setMeasuredHeight(node.offsetHeight);
  }, [title, description, stepIndex]);

  useEffect(() => {
    nextButtonRef.current?.focus();
  }, [stepIndex]);

  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;

  const targetCenterX = targetRect.left + targetRect.width / 2;

  const rawLeft = targetCenterX - TOOLTIP_WIDTH / 2;
  const maxLeft = viewportWidth - TOOLTIP_WIDTH - VIEWPORT_MARGIN;
  const clampedLeft = Math.max(VIEWPORT_MARGIN, Math.min(rawLeft, maxLeft));

  const topForBelow = targetRect.bottom + TARGET_GAP;
  const topForAbove = targetRect.top - TARGET_GAP - measuredHeight;
  const tooltipTop = placement === 'below' ? topForBelow : topForAbove;

  const clampedTop = Math.max(
    VIEWPORT_MARGIN,
    Math.min(tooltipTop, viewportHeight - measuredHeight - VIEWPORT_MARGIN),
  );

  const rawArrowLeft = targetCenterX - clampedLeft - ARROW_HALF;
  const arrowLeft = Math.max(
    14,
    Math.min(rawArrowLeft, TOOLTIP_WIDTH - 14 - ARROW_HALF * 2),
  );

  const isLast = stepIndex >= totalSteps - 1;

  return (
    <div
      ref={tooltipRef}
      role="dialog"
      aria-label={`Feature tour step ${stepIndex + 1} of ${totalSteps}`}
      className="fixed z-[11000] w-[296px] animate-scale-in rounded-xl border border-border bg-card p-4 shadow-overlay"
      style={{ top: clampedTop, left: clampedLeft }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Arrow */}
      <span
        aria-hidden
        className={cn(
          'absolute h-4 w-4 rotate-45 border border-border bg-card',
          placement === 'below'
            ? '-top-2 border-b-0 border-r-0'
            : '-bottom-2 border-l-0 border-t-0',
        )}
        style={{ left: arrowLeft }}
      />

      {/* Progress dots */}
      <div className="mb-3 flex items-center justify-center gap-1.5">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <span
            key={i}
            aria-hidden
            className={cn(
              'h-1.5 rounded-full transition-all',
              i === stepIndex ? 'w-5 bg-malachite-600' : 'w-1.5 bg-muted-foreground/30',
            )}
          />
        ))}
      </div>

      <div className="flex items-start gap-3">
        {Icon && (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-malachite-600/12">
            <Icon className="h-5 w-5 text-malachite-600" aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {stepIndex + 1} of {totalSteps}
          </p>
          <h3 className="mt-0.5 text-base font-semibold text-foreground">{title}</h3>
        </div>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>

      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          onClick={onSkip}
          className="text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Skip tour
        </button>
        <div className="flex items-center gap-2">
          {onPrev && stepIndex > 0 && (
            <button
              type="button"
              onClick={onPrev}
              className="rounded-full border border-border px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              Back
            </button>
          )}
          <button
            ref={nextButtonRef}
            type="button"
            onClick={onNext}
            className="rounded-full bg-malachite-800 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-malachite-900"
          >
            {isLast ? 'Got it' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}
