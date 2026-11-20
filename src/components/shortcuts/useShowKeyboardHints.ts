import { useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';

/**
 * Keyboard hints are a desktop affordance. They show only at `md:` and up AND on
 * a device whose primary pointer hovers precisely (a mouse or trackpad), and
 * never in the native shell. A 1024px iPad in Safari is `md:` but touch-first, so
 * width alone would advertise keys nobody has; this is why the hint is a hook,
 * not just a `hidden md:inline-flex` class.
 */
export const KEYBOARD_HINTS_QUERY = '(min-width: 768px) and (hover: hover) and (pointer: fine)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mql = window.matchMedia(KEYBOARD_HINTS_QUERY);
  mql.addEventListener?.('change', onChange);
  return () => mql.removeEventListener?.('change', onChange);
}

export function canShowKeyboardHints(): boolean {
  if (Capacitor.isNativePlatform()) return false;
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.(KEYBOARD_HINTS_QUERY).matches;
  } catch {
    return false;
  }
}

export function useShowKeyboardHints(): boolean {
  return useSyncExternalStore(subscribe, canShowKeyboardHints, () => false);
}
