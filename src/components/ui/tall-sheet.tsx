import { type ReactNode, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { cn } from '@/lib/utils';

interface TallSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name for the sheet (the active section's label). */
  title: string;
  /**
   * Context-aware handler for the pinned top-left X. When provided, the X is a
   * plain button that calls this (e.g. back-to-root on a detail view) instead of
   * dismissing the sheet — dragging the sheet down still fully closes it via
   * `onOpenChange`. When omitted, the X dismisses (root behavior).
   */
  onCloseClick?: () => void;
  /**
   * Visible headline rendered in the pinned grab header, centered between the X
   * and `headerAction`. Omit for a chromeless top edge (Settings): the sheet's
   * body supplies its own heading there.
   */
  headerTitle?: ReactNode;
  /** Right-aligned control in the grab header (e.g. "Save draft"). */
  headerAction?: ReactNode;
  /** Adds a hairline under the grab header — use when a visible title needs separating from the body. */
  headerBordered?: boolean;
  /**
   * Pinned below the scroll body, outside it, so a form's actions stay reachable
   * at any scroll position. Pass `null` to drop the bar entirely (e.g. while the
   * software keyboard is up).
   */
  footer?: ReactNode;
  /** Extra classes for the scrollable body (e.g. px-0 when children pad themselves). */
  bodyClassName?: string;
  /**
   * When this value changes the scroll body jumps back to the top. Pass the
   * active view identity (e.g. the settings section / doc) so drilling into a
   * new page always lands at its top instead of inheriting the prior scroll.
   */
  scrollResetKey?: string | number;
  children: ReactNode;
}

/**
 * Minimum clearance between the sheet's top edge and the top of the viewport
 * (below the status bar / Dynamic Island), so the grab header is always easy
 * to reach and never hides under the bevel.
 */
const MIN_TOP_GAP_PX = 12;
/** Tiny margin below the device's safe-area inset (notch / Dynamic Island). Kept
 *  small on purpose: the sheet top should tuck just under the island — high
 *  enough to cover the main page's top nav pills, but never above the island. */
const SAFE_AREA_MARGIN_PX = 4;

/** SSR / no-window fallback: slightly shy of full height. */
const FALLBACK_SNAP_POINTS: (number | string)[] = [0.92];

/** Measures env(safe-area-inset-top) in px (0 where unsupported/none). */
function measureSafeAreaTop(): number {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none;';
  document.body.appendChild(probe);
  const value = probe.getBoundingClientRect().height;
  probe.remove();
  return value;
}

/**
 * Near-full-height, but device-aware: the sheet's height is the viewport minus
 * the device's top safe area (notch / Dynamic Island) plus a margin, and never
 * less than MIN_TOP_GAP_PX of clearance — so the draggable top edge always sits
 * clearly below the bevel on every device.
 */
function computeSnapPoints(): (number | string)[] {
  if (typeof window === 'undefined') return FALLBACK_SNAP_POINTS;
  const viewport = Math.round(window.visualViewport?.height ?? window.innerHeight);
  const topGap = Math.max(measureSafeAreaTop() + SAFE_AREA_MARGIN_PX, MIN_TOP_GAP_PX);
  return [`${viewport - topGap}px`];
}

function useSheetSnapPoints(): (number | string)[] {
  // Compute synchronously on the first render (lazy initializer) so the drawer
  // opens straight to its resting height — no full-height white first frame
  // while an effect measures and re-snaps.
  const [snapPoints, setSnapPoints] = useState<(number | string)[]>(computeSnapPoints);

  useEffect(() => {
    const compute = () => setSnapPoints(computeSnapPoints());
    compute();
    window.addEventListener('resize', compute);
    window.visualViewport?.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('resize', compute);
      window.visualViewport?.removeEventListener('resize', compute);
    };
  }, []);

  return snapPoints;
}

/**
 * Mercury/Bevel-style near-full-height bottom sheet. Opens near full height over
 * a strongly dimmed backdrop; the header (X close + rounded top edge) is pinned
 * OUTSIDE the scroll container, so the sheet can always be dragged down from the
 * top no matter how far the body is scrolled, and the rounded edges never scroll
 * away. Vaul's underlying Radix dialog supplies the focus trap, aria-modal, and
 * Escape-to-close.
 *
 * This is the app's canonical "tall sheet" chrome — used for Settings and any
 * other surface that should present as a near-full-height iOS modal sheet rather
 * than a centered dialog.
 */
export function TallSheet({
  open,
  onOpenChange,
  title,
  onCloseClick,
  headerTitle,
  headerAction,
  headerBordered,
  footer,
  bodyClassName,
  scrollResetKey,
  children,
}: TallSheetProps) {
  const { t } = useTranslation();
  const snapPoints = useSheetSnapPoints();
  const bodyRef = useRef<HTMLDivElement>(null);

  // Drilling into a new view (section / doc) must land at the top: the scroll
  // body persists across content swaps, so without this it keeps the previous
  // page's scroll offset and opens mid-page.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [scrollResetKey]);

  // The X: a plain button when a context handler is supplied (back-to-root),
  // otherwise a DrawerClose that dismisses the whole sheet (root behavior).
  const xButton = (
    <button
      type="button"
      aria-label={t('common:actions.close')}
      onClick={onCloseClick}
      className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground/[0.06] text-foreground transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600"
    >
      <X className="h-5 w-5" aria-hidden />
    </button>
  );

  return (
    <Drawer open={open} onOpenChange={onOpenChange} snapPoints={snapPoints}>
      <DrawerContent
        hideDefaultHandle
        // Dims the real page mounted behind the sheet (RoutedApp's background
        // <Routes>) — iOS modal-sheet style. Kept light (/30) so the app reads
        // clearly through it, never a heavy black wash.
        overlayClassName="bg-black/30"
        className="h-full overflow-y-hidden rounded-t-3xl border-0 bg-background"
      >
        {/* Pinned grab header: sits outside the scroll container, so a drag
            starting here moves the SHEET at any body scroll position.
            touch-none keeps the browser from claiming the gesture as a scroll
            (taps on the X still fire). No drag pill — Bevel-style clean top.
            The X is top-left and consistent across every view: it dismisses at the
            root and steps back one level on a detail; dragging the sheet down
            always fully closes it regardless of depth. */}
        <div
          className={cn(
            'shrink-0 cursor-grab touch-none px-4 pb-1 pt-4 active:cursor-grabbing',
            headerBordered && 'border-b border-border pb-3',
          )}
        >
          {headerTitle || headerAction ? (
            // 1fr / auto / 1fr keeps the headline optically centered whatever the
            // action's width, and the whole row stays draggable (taps still fire).
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <div className="justify-self-start">
                {onCloseClick ? xButton : <DrawerClose asChild>{xButton}</DrawerClose>}
              </div>
              {/* The visible headline IS the dialog title when there is one, so
                  assistive tech hears it once rather than twice (once from a
                  sr-only title, once from the text beside it). */}
              {headerTitle ? (
                <DrawerTitle className="min-w-0 truncate text-center font-display text-lg font-semibold text-foreground">
                  {headerTitle}
                </DrawerTitle>
              ) : (
                <span />
              )}
              <div className="justify-self-end">{headerAction}</div>
            </div>
          ) : onCloseClick ? (
            xButton
          ) : (
            <DrawerClose asChild>{xButton}</DrawerClose>
          )}
        </div>
        {headerTitle ? null : <DrawerTitle className="sr-only">{title}</DrawerTitle>}
        {/* data-vaul-no-drag: a drag that STARTS in the scroll body only scrolls,
            never dismisses the sheet. Pulling up past the top no longer exits
            Settings - the sheet is dismissed only by the pinned grab header above
            (outside this container) or the X. */}
        <div
          ref={bodyRef}
          data-vaul-no-drag
          className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-10 pt-1', bodyClassName)}
        >
          {children}
        </div>
        {/* Pinned actions. Outside the scroll body on purpose: a long form must
            never bury its own Post button below the fold. */}
        {footer ? (
          <div className="shrink-0 border-t border-border bg-background px-4 pt-3">{footer}</div>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
