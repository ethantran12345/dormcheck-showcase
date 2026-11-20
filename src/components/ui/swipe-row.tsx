import { animate, motion, useMotionValue, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { haptic } from '@/lib/haptics';
import { cn } from '@/lib/utils';

interface SwipeRowProps {
  /** The row itself. Stays fully interactive; the swipe only translates it. */
  children: ReactNode;
  /** Accessible name for the revealed action — required, it IS the button's label. */
  actionLabel: string;
  /** Icon for the action button. */
  actionIcon: ReactNode;
  onAction: () => void;
  /** Disable the gesture (desktop, reorder mode). The action button still renders. */
  swipeEnabled?: boolean;
  className?: string;
}

/** How far the row slides to fully reveal the action, and the commit threshold. */
const REVEAL = 80;
const COMMIT = REVEAL * 0.55;

/**
 * A list row whose destructive action can be revealed by swiping left — WITHOUT
 * the action becoming gesture-only.
 *
 * ── WHY THE BUTTON IS ALWAYS IN THE DOM ───────────────────────────────────────
 * A swipe is unreachable by keyboard, switch control, and screen-reader gesture
 * navigation, so a swipe-only action is a WCAG 2.1 AA failure outright. The action
 * here is a real, always-rendered, always-focusable <Button>. It sits behind the
 * row visually, but:
 *   · Tab reaches it in DOM order, and focusing it slides the row open so the
 *     focus ring is actually visible (2.4.7 / 2.4.11 — a focused control hidden
 *     under another element is not "visible focus").
 *   · Screen readers announce it from the row like any other button.
 *   · The swipe is a shortcut TO that same button, never a replacement for it.
 * This is also why SwipeRow never hides a button a caller already renders — pass
 * the action here and it serves both paths, or keep your button and don't wrap.
 *
 * ── MOTION ────────────────────────────────────────────────────────────────────
 * Transform-only (compositor-offloaded), and with Reduce Motion on the row snaps
 * instead of springing — the action stays fully reachable either way, because the
 * preference must never remove functionality.
 */
export function SwipeRow({
  children,
  actionLabel,
  actionIcon,
  onAction,
  swipeEnabled = true,
  className,
}: SwipeRowProps) {
  const x = useMotionValue(0);
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  // Latched so crossing the commit point buzzes once, not once per pointer move.
  const armedRef = useRef(false);

  const settle = useCallback(
    (next: boolean) => {
      setOpen(next);
      const to = next ? -REVEAL : 0;
      // Reduce Motion snaps instead of springing — the action stays equally
      // reachable, only the travel animation goes away.
      if (reduceMotion) x.set(to);
      else animate(x, to, { type: 'spring', stiffness: 520, damping: 42 });
    },
    [reduceMotion, x],
  );

  // Keep the visual position honest if `open` is driven from focus.
  useEffect(() => {
    if (!swipeEnabled && open) settle(false);
  }, [swipeEnabled, open, settle]);

  return (
    <div className={cn('relative overflow-hidden', className)}>
      {/* The action layer. Always rendered, always focusable — never conditional
          on the gesture having happened. */}
      <div className="absolute inset-y-0 right-0 flex items-stretch">
        <Button
          type="button"
          variant="ghost"
          aria-label={actionLabel}
          onFocus={() => settle(true)}
          onBlur={() => settle(false)}
          onClick={() => {
            haptic.medium();
            settle(false);
            onAction();
          }}
          className={cn(
            'h-full rounded-none bg-destructive px-5 text-destructive-foreground',
            'hover:bg-destructive/90 focus-visible:relative focus-visible:z-10',
          )}
          style={{ width: REVEAL }}
        >
          {actionIcon}
        </Button>
      </div>

      <motion.div
        style={{ x }}
        drag={swipeEnabled ? 'x' : false}
        dragDirectionLock
        dragConstraints={{ left: -REVEAL, right: 0 }}
        dragElastic={{ left: 0.06, right: 0 }}
        onDrag={(_, info) => {
          // One tick the instant the row passes the commit point (contract: only
          // at the discrete threshold, never continuously during the drag).
          const past = info.offset.x < -COMMIT;
          if (past && !armedRef.current) {
            armedRef.current = true;
            haptic.light();
          } else if (!past) {
            armedRef.current = false;
          }
        }}
        onDragEnd={(_, info) => {
          armedRef.current = false;
          settle(info.offset.x < -COMMIT);
        }}
        className="relative bg-card"
      >
        {children}
      </motion.div>
    </div>
  );
}
