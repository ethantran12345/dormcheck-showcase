import { useEffect, useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';

const KEYBOARD_HEIGHT_VAR = '--keyboard-height';

/** Toggled on `<html>` when `--keyboard-height` is > 0 (CSS cannot branch on numeric vars). */
export const KEYBOARD_OPEN_HTML_CLASS = 'keyboard-open';
const FOCUS_SCROLL_DELAY_MS = 100;
const KEYBOARD_VISIBLE_MARGIN_PX = 12;

type RemovableListener = { remove: () => Promise<void> };

function isTextInputElement(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

function computeWebKeyboardHeight(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  const height = window.innerHeight - (vv.height + vv.offsetTop);
  return Math.max(0, Math.min(height, window.innerHeight));
}

function getVisibleViewportBottom(keyboardHeightPx: number, useVisualViewport: boolean): number {
  const vv = window.visualViewport;
  if (useVisualViewport && vv) {
    return vv.offsetTop + vv.height;
  }
  return window.innerHeight - keyboardHeightPx;
}

function getScrollableAncestor(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.documentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
      if (node.scrollHeight > node.clientHeight) return node;
    }
    node = node.parentElement;
  }
  return null;
}

function scrollIntoViewIfOccluded(el: HTMLElement, keyboardHeightPx: number, useVisualViewport: boolean) {
  const rect = el.getBoundingClientRect();
  const visibleBottom = getVisibleViewportBottom(keyboardHeightPx, useVisualViewport);
  const targetBottom = visibleBottom - KEYBOARD_VISIBLE_MARGIN_PX;

  if (rect.bottom <= targetBottom) return;

  const delta = rect.bottom - targetBottom;
  const scrollParent = getScrollableAncestor(el);

  if (scrollParent) {
    scrollParent.scrollBy({ top: delta, behavior: 'smooth' });
    return;
  }

  window.scrollBy({ top: delta, behavior: 'smooth' });
}

/**
 * Sets `--keyboard-height` on <html> while the software keyboard is open.
 *
 * - Native: @capacitor/keyboard `keyboardWillShow` / `keyboardWillHide`
 * - Web: `window.visualViewport` resize + scroll (rAF-throttled)
 *
 * Also scrolls focused text inputs only when occluded by the keyboard.
 */
export function useKeyboardInset() {
  useEffect(() => {
    const root = document.documentElement;
    const isNative = Capacitor.isNativePlatform();
    const useVisualViewportForOcclusion = !isNative;

    root.style.setProperty(KEYBOARD_HEIGHT_VAR, '0px');
    root.classList.remove(KEYBOARD_OPEN_HTML_CLASS);

    let cancelled = false;
    let keyboardHeightPx = 0;
    const nativeListeners: RemovableListener[] = [];
    let focusScrollTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let webRafId: number | null = null;

    const setKeyboardHeight = (px: number) => {
      keyboardHeightPx = px;
      root.style.setProperty(KEYBOARD_HEIGHT_VAR, `${px}px`);
      root.classList.toggle(KEYBOARD_OPEN_HTML_CLASS, px > 0);
    };

    const scrollFocusedInputIfOccluded = () => {
      const active = document.activeElement;
      if (!isTextInputElement(active)) return;
      scrollIntoViewIfOccluded(active, keyboardHeightPx, useVisualViewportForOcclusion);
    };

    const scheduleFocusScrollIfOccluded = () => {
      if (focusScrollTimeoutId != null) clearTimeout(focusScrollTimeoutId);
      focusScrollTimeoutId = setTimeout(() => {
        focusScrollTimeoutId = null;
        scrollFocusedInputIfOccluded();
      }, FOCUS_SCROLL_DELAY_MS);
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (!isTextInputElement(event.target instanceof Element ? event.target : null)) return;
      scheduleFocusScrollIfOccluded();
    };

    document.addEventListener('focusin', handleFocusIn);

    const applyWebKeyboardHeight = () => {
      webRafId = null;
      if (cancelled) return;
      const px = computeWebKeyboardHeight();
      setKeyboardHeight(px);
      if (px > 0) {
        scheduleFocusScrollIfOccluded();
      }
    };

    const scheduleWebKeyboardHeightUpdate = () => {
      if (webRafId != null) return;
      webRafId = requestAnimationFrame(applyWebKeyboardHeight);
    };

    if (isNative) {
      void (async () => {
        try {
          const { Keyboard } = await import('@capacitor/keyboard');
          const show = await Keyboard.addListener('keyboardWillShow', (info) => {
            setKeyboardHeight(info.keyboardHeight);
            scheduleFocusScrollIfOccluded();
          });
          const hide = await Keyboard.addListener('keyboardWillHide', () => {
            setKeyboardHeight(0);
          });
          if (cancelled) {
            await show.remove();
            await hide.remove();
            return;
          }
          nativeListeners.push(show, hide);
        } catch (err) {
          if (import.meta.env.DEV) {
            console.warn('[useKeyboardInset] keyboard listeners unavailable', err);
          }
        }
      })();
    } else if (window.visualViewport) {
      const vv = window.visualViewport;
      vv.addEventListener('resize', scheduleWebKeyboardHeightUpdate);
      vv.addEventListener('scroll', scheduleWebKeyboardHeightUpdate);
      scheduleWebKeyboardHeightUpdate();
    }

    return () => {
      cancelled = true;
      document.removeEventListener('focusin', handleFocusIn);
      if (focusScrollTimeoutId != null) clearTimeout(focusScrollTimeoutId);
      if (webRafId != null) cancelAnimationFrame(webRafId);

      if (!isNative && window.visualViewport) {
        const vv = window.visualViewport;
        vv.removeEventListener('resize', scheduleWebKeyboardHeightUpdate);
        vv.removeEventListener('scroll', scheduleWebKeyboardHeightUpdate);
      }

      void (async () => {
        try {
          await Promise.all(nativeListeners.map((l) => l.remove()));
        } catch {
          /* plugin teardown best-effort */
        }
      })();

      setKeyboardHeight(0);
    };
  }, []);
}

function subscribeKeyboardOpen(onStoreChange: () => void) {
  const el = document.documentElement;
  const observer = new MutationObserver(onStoreChange);
  observer.observe(el, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

function getKeyboardOpenSnapshot() {
  return document.documentElement.classList.contains(KEYBOARD_OPEN_HTML_CLASS);
}

/** Subscribes to `keyboard-open` on `<html>` (set by useKeyboardInset). */
export function useKeyboardOpen() {
  return useSyncExternalStore(subscribeKeyboardOpen, getKeyboardOpenSnapshot, () => false);
}
