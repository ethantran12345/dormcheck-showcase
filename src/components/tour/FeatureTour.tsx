import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router';
import { stepDescription, useTourSteps } from './tourSteps';
import { TourTooltip, type TooltipPlacement } from './TourTooltip';
import { useTour } from './useTour';

const ALLOWED_ROUTES = new Set(['/', '/campus', '/my-home', '/roommates', '/checklist', '/marketplace']);
const RESIZE_DEBOUNCE_MS = 80;
const POLL_INTERVAL_MS = 120;
const POLL_TIMEOUT_MS = 3000;
const SPOTLIGHT_PADDING = 8;

function routeAllowsTour(pathname: string): boolean {
  if (ALLOWED_ROUTES.has(pathname)) return true;
  return pathname.startsWith('/campus/');
}

/** Pick the currently visible target with `data-tour-id="X"` (TopNav vs BottomNav both tag identically). */
function findVisibleTarget(targetId: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour-id="${targetId}"]`);
  for (const node of Array.from(nodes)) {
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return node;
  }
  return null;
}

/**
 * Post-onboarding feature tour (steps filtered by feature flags in tourSteps.ts).
 *
 * Lifecycle:
 *  - `useTour()` reads `dormcheck_tour_pending` on mount and activates the tour once.
 *  - Tour only renders while the user is on `/` or `/campus(/*)`.
 *  - Target elements are found via `data-tour-id` attributes; a short poll handles
 *    the case where the nav mounts a tick later than this component.
 *  - Skip / Escape / outside click → `finish()` writes `dormcheck_tour_completed`.
 */
export function FeatureTour() {
  const { isActive, stepIndex, totalSteps, next, prev, finish } = useTour();
  const tourSteps = useTourSteps();
  const { pathname } = useLocation();

  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const currentStep = tourSteps[stepIndex];
  const routeOk = routeAllowsTour(pathname);
  const shouldRender = isActive && routeOk && currentStep != null;

  const measureTarget = useCallback(() => {
    if (!currentStep) return null;
    const el = findVisibleTarget(currentStep.targetId);
    if (!el) return null;
    return el.getBoundingClientRect();
  }, [currentStep]);

  useEffect(() => {
    if (!shouldRender) {
      setTargetRect(null);
      return;
    }

    let cancelled = false;
    const start = performance.now();

    const tick = () => {
      if (cancelled) return;
      const rect = measureTarget();
      if (rect) {
        setTargetRect(rect);
        return;
      }
      if (performance.now() - start > POLL_TIMEOUT_MS) {
        // Target not present on this platform/route; advance rather than freeze the tour.
        next();
        return;
      }
      window.setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();

    return () => {
      cancelled = true;
    };
  }, [shouldRender, measureTarget, next]);

  useEffect(() => {
    if (!shouldRender || !targetRect) return;

    let raf = 0;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const rect = measureTarget();
          if (rect) setTargetRect(rect);
        });
      }, RESIZE_DEBOUNCE_MS);
    };

    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, { passive: true });
    return () => {
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule);
      if (resizeTimer) clearTimeout(resizeTimer);
      cancelAnimationFrame(raf);
    };
  }, [shouldRender, targetRect, measureTarget]);

  useEffect(() => {
    if (!shouldRender) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shouldRender, finish]);

  if (!shouldRender || !targetRect || typeof document === 'undefined') return null;

  const viewportHeight = window.innerHeight;
  const targetCenterY = targetRect.top + targetRect.height / 2;
  const placement: TooltipPlacement = targetCenterY < viewportHeight / 2 ? 'below' : 'above';

  const spotlightTop = Math.max(0, targetRect.top - SPOTLIGHT_PADDING);
  const spotlightLeft = Math.max(0, targetRect.left - SPOTLIGHT_PADDING);
  const spotlightWidth = targetRect.width + SPOTLIGHT_PADDING * 2;
  const spotlightHeight = targetRect.height + SPOTLIGHT_PADDING * 2;
  const spotlightRight = spotlightLeft + spotlightWidth;
  const spotlightBottom = spotlightTop + spotlightHeight;

  const backdropStyle: React.CSSProperties = {
    position: 'fixed',
    background: 'rgba(0, 0, 0, 0.5)',
    zIndex: 10900,
  };

  return createPortal(
    <>
      {/* Four-rectangle backdrop with a hole around the target. Clicking any rect = skip. */}
      <div
        aria-hidden
        style={{ ...backdropStyle, top: 0, left: 0, right: 0, height: spotlightTop }}
        onClick={finish}
      />
      <div
        aria-hidden
        style={{ ...backdropStyle, top: spotlightBottom, left: 0, right: 0, bottom: 0 }}
        onClick={finish}
      />
      <div
        aria-hidden
        style={{
          ...backdropStyle,
          top: spotlightTop,
          left: 0,
          width: spotlightLeft,
          height: spotlightHeight,
        }}
        onClick={finish}
      />
      <div
        aria-hidden
        style={{
          ...backdropStyle,
          top: spotlightTop,
          left: spotlightRight,
          right: 0,
          height: spotlightHeight,
        }}
        onClick={finish}
      />

      {/* Highlight ring around the target (pointer-events: none so the target stays interactable visually). */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          top: spotlightTop,
          left: spotlightLeft,
          width: spotlightWidth,
          height: spotlightHeight,
          borderRadius: 12,
          /* Token, not a literal. Both values were the same color written twice
             (#34A853 and its rgba equivalent), which was `--dormcheck-brand-light`
             — Google brand green to the byte, retired 2026-08-02 in favour of
             malachite-500 (#0CDB4A). The real Google literals live in Auth.tsx's
             Sign-in-with-Google mark and are brand data that must not be tokenized.

             The ring is now two-tone, and that is not decoration. malachite-500
             is much lighter than the value it replaced (relative luminance .51 vs
             .29), so against the un-dimmed target inside the spotlight it drops
             to 1.87:1 where the old green sat at 3.06:1. A single-tone ring in
             the new token would be a real visibility regression. The added
             brand-dark outer edge gives the indicator a boundary that holds on
             the light side (4.6:1) while the brand-light band carries it against
             the dimmed backdrop outside (2.1:1, up from 1.29:1). */
          boxShadow:
            '0 0 0 3px hsl(var(--dormcheck-brand-light)), 0 0 0 5px hsl(var(--dormcheck-brand-dark)), 0 0 0 8px hsl(var(--dormcheck-brand-light) / 0.25)',
          pointerEvents: 'none',
          zIndex: 10950,
        }}
      />

      <TourTooltip
        targetRect={targetRect}
        placement={placement}
        title={currentStep.title}
        description={stepDescription(currentStep)}
        icon={currentStep.icon}
        stepIndex={stepIndex}
        totalSteps={totalSteps}
        onSkip={finish}
        onNext={next}
        onPrev={prev}
      />
    </>,
    document.body,
  );
}
