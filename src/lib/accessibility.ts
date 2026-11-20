/**
 * Accessibility preferences (Reduce Motion + Text Size) — the mechanism layer.
 *
 * Mirrors `src/lib/theme.ts`: pure resolve/apply helpers + storage keys, with the
 * React wiring living in `AccessibilityContext`. Preferences are localStorage-only
 * (no profiles column yet — see the TODO in AccessibilityContext); the theme
 * precedent for a profiles write-through can be layered on later without changing
 * these helpers.
 *
 * Reduce Motion is a genuine app-wide override, not a cosmetic flag:
 *  - CSS animations/transitions honor the `.reduce-motion` / `.motion-safe-override`
 *    classes set on <html> (see the reduce-motion block in src/index.css).
 *  - framer-motion honors it via <MotionConfig reducedMotion={...}> in App.tsx,
 *    driven by `motionConfigMode()` below.
 * Text Size scales the root font-size so every rem-based Tailwind size follows.
 */

export type ReduceMotionPreference = 'system' | 'on' | 'off';
export type TextSize = 'default' | 'large' | 'larger';

export const REDUCE_MOTION_STORAGE_KEY = 'dormcheck-reduce-motion';
export const TEXT_SIZE_STORAGE_KEY = 'dormcheck-text-size';

/** Root font-size per step. Percentages scale the rem unit the whole UI is built on. */
export const TEXT_SIZE_SCALE: Record<TextSize, string> = {
  default: '100%',
  large: '112.5%', // 18px root
  larger: '125%', // 20px root
};

export function getSystemReduceMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function getStoredReduceMotion(): ReduceMotionPreference {
  if (typeof window === 'undefined') return 'system';
  const stored = localStorage.getItem(REDUCE_MOTION_STORAGE_KEY);
  if (stored === 'on' || stored === 'off' || stored === 'system') return stored;
  return 'system';
}

export function getStoredTextSize(): TextSize {
  if (typeof window === 'undefined') return 'default';
  const stored = localStorage.getItem(TEXT_SIZE_STORAGE_KEY);
  if (stored === 'large' || stored === 'larger' || stored === 'default') return stored;
  return 'default';
}

/** Effective on/off, folding the OS value in when the user hasn't overridden it. */
export function resolveReduceMotion(
  preference: ReduceMotionPreference,
  systemReduceMotion: boolean,
): boolean {
  return preference === 'system' ? systemReduceMotion : preference === 'on';
}

/**
 * Reflect the preference onto <html> for the CSS layer.
 *  - 'on'  → `.reduce-motion`         (kill animation regardless of OS)
 *  - 'off' → `.motion-safe-override`  (keep animation even if OS says reduce)
 *  - 'system' → neither               (OS media query governs)
 */
export function applyReduceMotion(preference: ReduceMotionPreference): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('reduce-motion', preference === 'on');
  root.classList.toggle('motion-safe-override', preference === 'off');
}

export function applyTextSize(size: TextSize): void {
  if (typeof document === 'undefined') return;
  // Empty string clears the inline override so the stylesheet default (100%) wins.
  document.documentElement.style.fontSize = size === 'default' ? '' : TEXT_SIZE_SCALE[size];
}

/** Map the preference to framer-motion's <MotionConfig reducedMotion> prop. */
export function motionConfigMode(
  preference: ReduceMotionPreference,
): 'always' | 'never' | 'user' {
  if (preference === 'on') return 'always';
  if (preference === 'off') return 'never';
  return 'user';
}
