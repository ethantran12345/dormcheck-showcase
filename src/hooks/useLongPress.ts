import { useCallback, useRef } from 'react';

// Fires `onLongPress` after the pointer is held still on a target for `delayMs`.
// Pointer events unify touch + mouse; a small move threshold cancels so a scroll or
// drag never counts as a long-press. Used to open the reaction picker on mobile,
// where there's no hover affordance.
export function useLongPress(onLongPress: () => void, delayMs = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    start.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only primary button / touch / pen; ignore right-click.
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        onLongPress();
        clear();
      }, delayMs);
    },
    [onLongPress, delayMs, clear],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!start.current) return;
      const dx = Math.abs(e.clientX - start.current.x);
      const dy = Math.abs(e.clientY - start.current.y);
      if (dx > 10 || dy > 10) clear();
    },
    [clear],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
  };
}
