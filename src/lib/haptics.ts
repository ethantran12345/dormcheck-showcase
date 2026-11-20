import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

import {
  getStoredReduceMotion,
  getSystemReduceMotion,
  resolveReduceMotion,
} from '@/lib/accessibility';

/**
 * Native haptic feedback — no-op on web, and silent whenever Reduce Motion is on.
 *
 * ── THE CONTRACT ──────────────────────────────────────────────────────────────
 * Comparable interactions must feel the same everywhere. A toggle that buzzes on
 * one screen and not another is worse than none buzzing at all, so pick by
 * INTERACTION CLASS, never by "does this one feel like it deserves a buzz":
 *
 *   selection()  Choosing among options with no side effect until later — switches,
 *                segmented controls, tabs, filter chips, radio/checkbox, theme
 *                pickers. The lightest, most repeatable tick.
 *   light()      A reversible state change the user caused directly — opening a
 *                sheet/overlay, revealing swipe actions, expanding a row, adding to
 *                a local list, an optimistic send that is not yet confirmed.
 *   medium()     A COMMIT — submitting, saving, deleting, claiming, confirming a
 *                destructive dialog. Anything that writes to the server or cannot
 *                be undone by repeating the same gesture.
 *   success()    A completed async operation the user was waiting on (refresh
 *                landed, upload finished). Not for every mutation — only where the
 *                user would otherwise wonder whether it worked.
 *   error()      A failed operation or rejected input. Pair with a visible message;
 *                a buzz is never the only error signal.
 *   warning()    A destructive action armed but not yet taken (swiped past the
 *                delete threshold, entering an irreversible flow).
 *
 * Rules that bind:
 *  1. One haptic per user action. If a Button already carries `haptic="medium"`,
 *     its onClick must not fire a second one.
 *  2. Fire on the user's gesture, not on the server response — except success()
 *     and error(), which exist precisely to report the response.
 *  3. Never fire during scroll or continuous drag-tracking; only at the discrete
 *     moment a threshold is crossed.
 *
 * ── REDUCE MOTION ─────────────────────────────────────────────────────────────
 * Haptics are motion. They are gated on the SAME preference the rest of the app
 * uses (`dormcheck-reduce-motion` folded with the OS `prefers-reduced-motion`
 * query by `resolveReduceMotion`) — read through `lib/accessibility` on purpose,
 * rather than adding a second haptics-specific setting, so there is exactly one
 * switch. The value is read per call because this module is imported outside React
 * and the preference can change mid-session.
 */

const isNative = Capacitor.isNativePlatform();

/** True when haptics must stay silent: web, or the user asked for less motion. */
function suppressed(): boolean {
  if (!isNative) return true;
  try {
    return resolveReduceMotion(getStoredReduceMotion(), getSystemReduceMotion());
  } catch {
    // A missing localStorage/matchMedia must never break an interaction.
    return false;
  }
}

const impact = (style: ImpactStyle) => () => {
  if (suppressed()) return;
  Haptics.impact({ style }).catch(() => {});
};

const notify = (type: NotificationType) => () => {
  if (suppressed()) return;
  Haptics.notification({ type }).catch(() => {});
};

export const haptic = {
  /** Selection among options — toggles, tabs, chips, segmented controls. */
  selection: () => {
    if (suppressed()) return;
    Haptics.selectionStart()
      .then(() => Haptics.selectionEnd())
      .catch(() => {});
  },
  /** Reversible direct manipulation — open, reveal, expand, optimistic add. */
  light: impact(ImpactStyle.Light),
  /** Commit — submit, save, delete, claim, confirm. */
  medium: impact(ImpactStyle.Medium),
  /** Completed async operation the user was waiting on. */
  success: notify(NotificationType.Success),
  /** Destructive action armed, or a threshold crossed the user can back out of. */
  warning: notify(NotificationType.Warning),
  /** Failed operation or rejected input. Always paired with a visible message. */
  error: notify(NotificationType.Error),
};

export type HapticKind = keyof typeof haptic;
