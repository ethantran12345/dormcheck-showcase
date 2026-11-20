import { useCallback, useRef, useState } from 'react';

/**
 * Touch/pointer-driven pinch-to-zoom + pan for an image-viewer surface.
 *
 * The container clips; the content is transformed with `translate3d()…scale()`.
 * During a gesture the transform is written **imperatively** to the DOM node (no
 * React re-render per frame - that's what made naive versions feel janky), and
 * React state is only synced on gesture end for the zoom readout / button state.
 *
 * One finger pans (and, at scale 1, scrolls through tall multi-page content);
 * two fingers pinch-zoom anchored at the gesture midpoint; double-tap toggles
 * fit ↔ 2.5×. Translation is clamped so content can't be dragged out of view, and
 * content narrower/shorter than the container stays centered.
 *
 * Wire `containerRef` to the clipping element (give it `touch-none`),
 * `contentRef` to the transformed child, and spread `handlers` on the container.
 */

interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SCALE = 2.5;
const TAP_SLOP = 12; // px of movement still considered a tap

/** Clamp one axis so content stays in view, centering it when it's smaller. */
function clampAxis(value: number, size: number, container: number): number {
  if (size <= container) return (container - size) / 2;
  return Math.min(0, Math.max(container - size, value));
}

export function usePinchZoom(minScale = 1, maxScale = 4, step = 0.5) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentNode = useRef<HTMLDivElement | null>(null);

  const transform = useRef<Transform>({ scale: 1, tx: 0, ty: 0 });
  const [scale, setScale] = useState(1); // mirror for the readout + button disabled state

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; mx: number; my: number } | null>(null);
  const lastPan = useRef<{ x: number; y: number } | null>(null);
  const tap = useRef<{ at: number; x: number; y: number } | null>(null);
  const prevTapUp = useRef<{ at: number; x: number; y: number } | null>(null);

  const clampScale = useCallback(
    (s: number) => Math.min(maxScale, Math.max(minScale, s)),
    [minScale, maxScale],
  );

  const clamp = useCallback((next: Transform): Transform => {
    const container = containerRef.current;
    const content = contentNode.current;
    if (!container || !content) return next;
    const cW = container.clientWidth;
    const cH = container.clientHeight;
    const nW = content.offsetWidth;
    const nH = content.offsetHeight;
    return {
      scale: next.scale,
      tx: clampAxis(next.tx, nW * next.scale, cW),
      ty: clampAxis(next.ty, nH * next.scale, cH),
    };
  }, []);

  const apply = useCallback((animate: boolean) => {
    const el = contentNode.current;
    if (!el) return;
    const { scale: s, tx, ty } = transform.current;
    el.style.transition = animate ? 'transform 200ms ease-out' : 'none';
    el.style.transformOrigin = '0 0';
    el.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${s})`;
  }, []);

  // Callback ref: apply the current transform as soon as the node mounts.
  const contentRef = useCallback(
    (node: HTMLDivElement | null) => {
      contentNode.current = node;
      if (node) apply(false);
    },
    [apply],
  );

  /** Zoom toward `nextScale`, keeping the container-local point (ax, ay) fixed. */
  const zoomAround = useCallback(
    (nextScale: number, ax: number, ay: number, animate: boolean) => {
      const prev = transform.current;
      const s = clampScale(nextScale);
      const k = s / prev.scale;
      transform.current = clamp({ scale: s, tx: ax - (ax - prev.tx) * k, ty: ay - (ay - prev.ty) * k });
      apply(animate);
      setScale(transform.current.scale);
    },
    [apply, clamp, clampScale],
  );

  const center = () => {
    const c = containerRef.current;
    return { x: (c?.clientWidth ?? 0) / 2, y: (c?.clientHeight ?? 0) / 2 };
  };

  const zoomIn = useCallback(() => {
    const a = center();
    zoomAround(transform.current.scale + step, a.x, a.y, true);
  }, [zoomAround, step]);

  const zoomOut = useCallback(() => {
    const a = center();
    zoomAround(transform.current.scale - step, a.x, a.y, true);
  }, [zoomAround, step]);

  const reset = useCallback(() => {
    transform.current = { scale: 1, tx: 0, ty: 0 };
    apply(true);
    setScale(1);
  }, [apply]);

  const local = (e: React.PointerEvent) => {
    const r = containerRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      lastPan.current = null;
      tap.current = null;
      return;
    }
    lastPan.current = p;
    tap.current = { at: e.timeStamp, x: p.x, y: p.y };
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      const p = local(e);
      pointers.current.set(e.pointerId, p);

      if (pointers.current.size >= 2 && pinch.current) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const prevMid = { x: pinch.current.mx, y: pinch.current.my };
        const ratio = pinch.current.dist > 0 ? dist / pinch.current.dist : 1;
        pinch.current = { dist, mx, my };

        const prev = transform.current;
        const s = clampScale(prev.scale * ratio);
        const k = s / prev.scale;
        transform.current = clamp({ scale: s, tx: mx - (prevMid.x - prev.tx) * k, ty: my - (prevMid.y - prev.ty) * k });
        apply(false);
      } else if (pointers.current.size === 1 && lastPan.current) {
        const dx = p.x - lastPan.current.x;
        const dy = p.y - lastPan.current.y;
        lastPan.current = p;
        if (tap.current && Math.hypot(p.x - tap.current.x, p.y - tap.current.y) > TAP_SLOP) {
          tap.current = null; // moved too far to count as a tap
        }
        const prev = transform.current;
        transform.current = clamp({ scale: prev.scale, tx: prev.tx + dx, ty: prev.ty + dy });
        apply(false);
      }
    },
    [apply, clamp, clampScale],
  );

  const endPointer = useCallback(
    (e: React.PointerEvent) => {
      const wasPinching = pointers.current.size >= 2;
      pointers.current.delete(e.pointerId);

      if (pointers.current.size < 2) pinch.current = null;
      if (pointers.current.size === 1) {
        lastPan.current = [...pointers.current.values()][0];
        return;
      }
      if (pointers.current.size > 0) return;

      lastPan.current = null;

      // A surviving `tap` (cleared on > slop movement) that ended quickly is a tap.
      const t = tap.current;
      tap.current = null;
      const isTap = !wasPinching && t !== null && e.timeStamp - t.at < DOUBLE_TAP_MS;
      if (isTap && t) {
        const prev = prevTapUp.current;
        if (prev && e.timeStamp - prev.at < DOUBLE_TAP_MS && Math.hypot(t.x - prev.x, t.y - prev.y) < 40) {
          prevTapUp.current = null;
          if (transform.current.scale > 1) reset();
          else zoomAround(DOUBLE_TAP_SCALE, t.x, t.y, true);
          return;
        }
        prevTapUp.current = { at: e.timeStamp, x: t.x, y: t.y };
      }
      // Sync the readout after any gesture that may have changed scale.
      setScale(transform.current.scale);
    },
    [reset, zoomAround],
  );

  return {
    containerRef,
    contentRef,
    scale,
    reset,
    zoomIn,
    zoomOut,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPointer,
      onPointerCancel: endPointer,
    },
  };
}
