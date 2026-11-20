import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { cn } from '@/lib/utils';

/** Snap indices: peek, half, full */
export const EXPLORE_SHEET_SNAP_PEEK = 0;
export const EXPLORE_SHEET_SNAP_HALF = 1;
export const EXPLORE_SHEET_SNAP_FULL = 2;

/** Fallback before header is measured; peek snap uses measured header height. */
export const PEEK_VISIBLE_PX = 72;
const FLICK_VELOCITY_PX_S = 300;
const LIST_HANDOFF_THRESHOLD_PX = 6;
/** Under this much travel a header press is a tap (detent step), not a drag. */
const TAP_SLOP_PX = 4;
/** Matches NativeTopBar h-12 row below safe-area. */
const NATIVE_TOP_BAR_ROW_PX = 48;

type PullSession = {
  pointerId: number;
  startY: number;
  startTranslateY: number;
  lastY: number;
  lastT: number;
  source: 'header' | 'list';
  sheetDragActive: boolean;
  /** Detent the gesture began at - a flick resolves relative to it. */
  startIndex: number;
  /** Total movement so far; a gesture under the slop is a tap, not a drag. */
  maxDelta: number;
};

function measureFullTopInset(parentTop: number): number {
  if (typeof window === 'undefined') return 0;
  const bodySafe = Number.parseFloat(getComputedStyle(document.body).paddingTop) || 0;
  const navBottom = bodySafe + NATIVE_TOP_BAR_ROW_PX;
  return Math.max(0, Math.round(navBottom - parentTop));
}

function computeSnapOffsets(
  sectionHeight: number,
  fullTopInset: number,
  peekVisiblePx: number,
): [number, number, number] {
  if (sectionHeight <= 0) return [fullTopInset, fullTopInset, fullTopInset];
  const fullY = fullTopInset;
  const peekY = Math.max(fullY, sectionHeight - peekVisiblePx);
  const halfY = sectionHeight * 0.5;
  return [peekY, halfY, fullY];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

interface MapBottomSheetProps {
  snapIndex: number;
  onSnapIndexChange: (index: number) => void;
  headerLabel: string;
  /** e.g. Filters drawer trigger; must stop pointer propagation so sheet drag is not affected */
  headerAccessory?: ReactNode;
  /** Always-visible row under the header label (all snap points) - e.g. the
   *  Housing cluster sub-tab chips, so cluster navigation isn't buried behind
   *  the drag-to-expand gesture. */
  peekAccessory?: ReactNode;
  listRef: RefObject<HTMLDivElement | null>;
  /** Fired when measured peek header height changes (carousel dock). */
  onPeekVisibleHeightChange?: (px: number) => void;
  children: ReactNode;
  className?: string;
}

export function MapBottomSheet({
  snapIndex,
  onSnapIndexChange,
  headerLabel,
  headerAccessory,
  peekAccessory,
  listRef,
  onPeekVisibleHeightChange,
  children,
  className,
}: MapBottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const pullRef = useRef<PullSession | null>(null);
  const dragRafRef = useRef<number | null>(null);
  const pendingDragYRef = useRef(0);

  const [sectionHeight, setSectionHeight] = useState(0);
  const [fullTopInset, setFullTopInset] = useState(0);
  const [peekVisiblePx, setPeekVisiblePx] = useState(PEEK_VISIBLE_PX);
  const [isDragging, setIsDragging] = useState(false);
  const [listHandoffActive, setListHandoffActive] = useState(false);
  const [dragTranslateY, setDragTranslateY] = useState(0);

  const snapOffsets = useMemo(
    () => computeSnapOffsets(sectionHeight, fullTopInset, peekVisiblePx),
    [sectionHeight, fullTopInset, peekVisiblePx],
  );

  const measurePeekHeader = useCallback(() => {
    // Full detent header omits the drag handle; don't shrink peek snap from that layout.
    if (snapIndex === EXPLORE_SHEET_SNAP_FULL) return;
    const h = headerRef.current?.offsetHeight ?? 0;
    if (h <= 0) return;
    setPeekVisiblePx(h);
    onPeekVisibleHeightChange?.(h);
  }, [snapIndex, onPeekVisibleHeightChange]);

  useLayoutEffect(() => {
    if (snapIndex !== EXPLORE_SHEET_SNAP_FULL) measurePeekHeader();
  }, [snapIndex, measurePeekHeader]);

  const minTranslateY = snapOffsets[EXPLORE_SHEET_SNAP_FULL];
  const maxTranslateY = snapOffsets[EXPLORE_SHEET_SNAP_PEEK];

  const restingTranslateY = snapOffsets[snapIndex] ?? maxTranslateY;
  const translateY = isDragging ? dragTranslateY : restingTranslateY;

  /**
   * Below the full detent the list does not scroll on its own: every vertical
   * gesture drives the sheet instead. That removes the ambiguity that made the
   * old sheet feel wonky - the list could scroll a few pixels and swallow a
   * gesture that was meant to raise the sheet. Reach the top detent and the
   * list becomes a normal scroller.
   */
  const listScrollLocked = snapIndex !== EXPLORE_SHEET_SNAP_FULL;

  const measureLayout = useCallback(() => {
    const el = sheetRef.current;
    if (!el) return;

    const parent = el.offsetParent as HTMLElement | null;
    const next = parent?.clientHeight ?? el.parentElement?.clientHeight ?? 0;
    if (next > 0) setSectionHeight(next);

    const parentTop = parent?.getBoundingClientRect().top ?? 0;
    setFullTopInset(measureFullTopInset(parentTop));
  }, []);

  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!el) return;

    measureLayout();
    measurePeekHeader();
    const ro = new ResizeObserver(() => {
      measureLayout();
      measurePeekHeader();
    });
    const parent = el.offsetParent as HTMLElement | null;
    if (parent) ro.observe(parent);
    else ro.observe(el.parentElement ?? el);
    const headerEl = headerRef.current;
    if (headerEl) ro.observe(headerEl);
    const onResize = () => {
      measureLayout();
      measurePeekHeader();
    };
    window.addEventListener('resize', onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [measureLayout, measurePeekHeader]);

  useEffect(() => {
    if (isDragging || sectionHeight <= 0) return;
    setDragTranslateY(snapOffsets[snapIndex] ?? maxTranslateY);
  }, [snapIndex, snapOffsets, isDragging, sectionHeight, maxTranslateY]);

  // iOS: prevent list rubber-band while handing off a pull to the sheet
  useEffect(() => {
    const list = listRef.current;
    if (!list || !(listHandoffActive || listScrollLocked)) return;
    const blockTouchMove = (e: TouchEvent) => {
      if (pullRef.current?.sheetDragActive || listScrollLocked) e.preventDefault();
    };
    list.addEventListener('touchmove', blockTouchMove, { passive: false });
    return () => list.removeEventListener('touchmove', blockTouchMove);
  }, [listHandoffActive, listScrollLocked, listRef]);

  // Dropping out of the full detent parks the list back at its top, so the
  // half/peek window always shows the start of the list, never a stranded
  // mid-scroll slice.
  useEffect(() => {
    if (!listScrollLocked) return;
    const list = listRef.current;
    if (list && list.scrollTop > 0) list.scrollTop = 0;
  }, [listScrollLocked, listRef]);

  const snapToIndex = useCallback(
    (index: number) => {
      const clamped = clamp(index, EXPLORE_SHEET_SNAP_PEEK, EXPLORE_SHEET_SNAP_FULL);
      onSnapIndexChange(clamped);
    },
    [onSnapIndexChange],
  );

  const resolveSnapIndex = useCallback(
    (currentY: number, velocityY: number, startIndex: number) => {
      // Three detents - peek / half / full. Settle on the nearest one, and let a
      // flick carry you exactly ONE detent in the flung direction so half is
      // always reachable (a velocity jump straight to an extreme is what made
      // the old two-detent sheet feel like it was fighting you).
      let nearest = EXPLORE_SHEET_SNAP_PEEK;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (let i = EXPLORE_SHEET_SNAP_PEEK; i <= EXPLORE_SHEET_SNAP_FULL; i += 1) {
        const distance = Math.abs(currentY - snapOffsets[i]);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = i;
        }
      }
      if (velocityY < -FLICK_VELOCITY_PX_S) {
        // Upward flick: at least one detent taller than where the drag began.
        return clamp(
          Math.max(nearest, startIndex + 1),
          EXPLORE_SHEET_SNAP_PEEK,
          EXPLORE_SHEET_SNAP_FULL,
        );
      }
      if (velocityY > FLICK_VELOCITY_PX_S) {
        return clamp(
          Math.min(nearest, startIndex - 1),
          EXPLORE_SHEET_SNAP_PEEK,
          EXPLORE_SHEET_SNAP_FULL,
        );
      }
      return nearest;
    },
    [snapOffsets],
  );

  const endPullSession = useCallback(
    (e: React.PointerEvent, releaseCaptureEl: HTMLElement) => {
      const session = pullRef.current;
      if (!session || e.pointerId !== session.pointerId) return;

      const wasTap = session.source === 'header' && session.maxDelta <= TAP_SLOP_PX;

      if (wasTap) {
        // A tap on the grabber walks up the detents, then wraps back to peek -
        // the whole ladder is reachable without ever dragging.
        releaseCaptureEl.releasePointerCapture(e.pointerId);
        snapToIndex(
          session.startIndex >= EXPLORE_SHEET_SNAP_FULL
            ? EXPLORE_SHEET_SNAP_PEEK
            : session.startIndex + 1,
        );
      } else if (session.sheetDragActive) {
        releaseCaptureEl.releasePointerCapture(e.pointerId);
        const dt = Math.max(1, performance.now() - session.lastT);
        const velocityY = ((e.clientY - session.lastY) / dt) * 1000;
        const currentY = clamp(
          session.startTranslateY + (e.clientY - session.startY),
          minTranslateY,
          maxTranslateY,
        );
        snapToIndex(resolveSnapIndex(currentY, velocityY, session.startIndex));
      }

      pullRef.current = null;
      if (dragRafRef.current != null) {
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = null;
      }
      setIsDragging(false);
      setListHandoffActive(false);
    },
    [maxTranslateY, minTranslateY, resolveSnapIndex, snapToIndex],
  );

  const applySheetDrag = useCallback(
    (session: PullSession, clientY: number) => {
      const dy = clientY - session.startY;
      session.maxDelta = Math.max(session.maxDelta, Math.abs(dy));
      // rAF-throttle so we update the transform at most once per frame (smoother drag).
      pendingDragYRef.current = clamp(session.startTranslateY + dy, minTranslateY, maxTranslateY);
      session.lastY = clientY;
      session.lastT = performance.now();
      if (dragRafRef.current == null) {
        dragRafRef.current = requestAnimationFrame(() => {
          dragRafRef.current = null;
          setDragTranslateY(pendingDragYRef.current);
        });
      }
    },
    [maxTranslateY, minTranslateY],
  );

  useEffect(
    () => () => {
      if (dragRafRef.current != null) cancelAnimationFrame(dragRafRef.current);
    },
    [],
  );

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || sectionHeight <= 0) return;
    pullRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startTranslateY: restingTranslateY,
      lastY: e.clientY,
      lastT: performance.now(),
      source: 'header',
      sheetDragActive: true,
      startIndex: snapIndex,
      maxDelta: 0,
    };
    setIsDragging(true);
    setDragTranslateY(restingTranslateY);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onHeaderPointerMove = (e: React.PointerEvent) => {
    const session = pullRef.current;
    if (!session || e.pointerId !== session.pointerId || session.source !== 'header') return;
    applySheetDrag(session, e.clientY);
  };

  const onHeaderPointerUp = (e: React.PointerEvent) => {
    endPullSession(e, e.currentTarget as HTMLElement);
  };

  const onListPointerDown = (e: React.PointerEvent) => {
    const list = listRef.current;
    if (!list || e.button !== 0 || sectionHeight <= 0) return;
    // Below the full detent the list is parked at the top and its own scrolling
    // is locked, so a gesture anywhere in it is a candidate sheet drag.
    if (!listScrollLocked && list.scrollTop > 0.5) return;

    pullRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startTranslateY: restingTranslateY,
      lastY: e.clientY,
      lastT: performance.now(),
      source: 'list',
      sheetDragActive: false,
      startIndex: snapIndex,
      maxDelta: 0,
    };
  };

  const onListPointerMove = (e: React.PointerEvent) => {
    const session = pullRef.current;
    const list = listRef.current;
    if (!session || e.pointerId !== session.pointerId || session.source !== 'list') return;

    if (!session.sheetDragActive) {
      if (!list || (!listScrollLocked && list.scrollTop > 0.5)) {
        pullRef.current = null;
        return;
      }
      const dy = e.clientY - session.startY;
      // Locked: either direction grows/shrinks the sheet. At full: only a pull
      // down from the very top of the list, so upward scrolling stays scrolling.
      const engaged = listScrollLocked
        ? Math.abs(dy) > LIST_HANDOFF_THRESHOLD_PX
        : dy > LIST_HANDOFF_THRESHOLD_PX;
      if (!engaged) return;

      session.sheetDragActive = true;
      session.startY = e.clientY;
      session.startTranslateY = restingTranslateY;
      setIsDragging(true);
      setListHandoffActive(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
      applySheetDrag(session, e.clientY);
      return;
    }

    e.preventDefault();
    applySheetDrag(session, e.clientY);
  };

  const onListPointerUp = (e: React.PointerEvent) => {
    const session = pullRef.current;
    if (!session || e.pointerId !== session.pointerId || session.source !== 'list') return;
    if (session.sheetDragActive) {
      endPullSession(e, e.currentTarget as HTMLElement);
      return;
    }
    pullRef.current = null;
  };

  const onListPointerCancel = (e: React.PointerEvent) => {
    onListPointerUp(e);
  };

  // The grabber is part of the sheet's resting shape, so it only disappears once
  // the sheet has actually settled at full - collapsing it mid-drag reflowed the
  // header under the user's finger, which is what made the drag look jumpy.
  const handleCollapsed = snapIndex === EXPLORE_SHEET_SNAP_FULL && !isDragging;
  const isAtPeekDetent = snapIndex === EXPLORE_SHEET_SNAP_PEEK && !isDragging;
  // Corners round off continuously as the sheet meets the top inset instead of
  // popping square the instant the full detent latches.
  const cornerRadiusPx = clamp(translateY - minTranslateY, 0, 16);

  return (
    <div
      className={cn('pointer-events-none absolute inset-x-0 bottom-0 top-0 z-20 overflow-hidden', className)}
      aria-hidden={false}
    >
      <div
        ref={sheetRef}
        className={cn(
          'pointer-events-auto absolute inset-x-0 bottom-0 flex h-full flex-col border border-border bg-card shadow-[0_-4px_24px_rgba(0,0,0,0.15)] will-change-transform',
          snapIndex === EXPLORE_SHEET_SNAP_FULL && !isDragging && 'border-t-0',
          isAtPeekDetent && 'overflow-hidden',
          !isDragging &&
            'transition-[transform,border-radius] duration-[300ms] ease-[cubic-bezier(0.32,0.72,0,1)]',
        )}
        style={{
          transform: `translateY(${translateY}px)`,
          borderTopLeftRadius: `${cornerRadiusPx}px`,
          borderTopRightRadius: `${cornerRadiusPx}px`,
        }}
      >
        <div
          ref={headerRef}
          className={cn(
            'z-10 shrink-0 touch-none cursor-grab border-b border-border bg-card px-4 pb-2 active:cursor-grabbing',
            handleCollapsed ? 'pt-3' : 'pt-2',
            snapIndex !== EXPLORE_SHEET_SNAP_FULL && 'shadow-raised',
          )}
          role="button"
          tabIndex={0}
          aria-label="Resize the housing list. Arrow up to expand, arrow down to collapse."
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              snapToIndex(snapIndex + 1);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              snapToIndex(snapIndex - 1);
            } else if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              snapToIndex(
                snapIndex >= EXPLORE_SHEET_SNAP_FULL
                  ? EXPLORE_SHEET_SNAP_PEEK
                  : snapIndex + 1,
              );
            }
          }}
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={onHeaderPointerUp}
          onPointerCancel={onHeaderPointerUp}
        >
          <div
            className={cn(
              'py-1.5',
              handleCollapsed && 'h-0 min-h-0 overflow-hidden py-0',
            )}
            aria-hidden
          >
            <div
              className={cn(
                'mx-auto h-1.5 w-12 shrink-0 rounded-full',
                handleCollapsed ? 'bg-transparent' : 'bg-muted-foreground/40',
              )}
            />
          </div>
          <div
            className={cn(
              'relative flex min-h-[28px] items-center pb-0.5',
              snapIndex === EXPLORE_SHEET_SNAP_FULL && headerAccessory
                ? 'w-full'
                : 'justify-center',
            )}
          >
            {!(snapIndex === EXPLORE_SHEET_SNAP_FULL && headerAccessory) ? (
              <p className="text-center text-sm font-semibold text-foreground">{headerLabel}</p>
            ) : null}
            {headerAccessory && snapIndex === EXPLORE_SHEET_SNAP_FULL ? (
              <div
                className="flex w-full items-center"
                onPointerDown={(e) => e.stopPropagation()}
              >
                {headerAccessory}
              </div>
            ) : null}
          </div>
          {peekAccessory ? (
            <div
              className="w-full px-4 pb-2 pt-1"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {peekAccessory}
            </div>
          ) : null}
        </div>
        <div
          ref={listRef}
          className={cn(
            'min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin pb-[calc(4rem+env(safe-area-inset-bottom,0px))]',
            (listHandoffActive || listScrollLocked) && 'touch-none overflow-hidden',
          )}
          style={{ touchAction: listHandoffActive || listScrollLocked ? 'none' : 'pan-y' }}
          onPointerDown={onListPointerDown}
          onPointerMove={onListPointerMove}
          onPointerUp={onListPointerUp}
          onPointerCancel={onListPointerCancel}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
