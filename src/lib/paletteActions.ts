/**
 * The command palette's Actions group: things a student DOES, as opposed to the
 * Pages group's places they go. Kept pure (no React, no router) so the visibility
 * rules and the recents ordering are unit-testable and cannot drift between the
 * palette and its tests.
 *
 * VISIBILITY IS THE POINT. The palette must never offer a surface the tenant has
 * turned off, so every action names the flag that gates it and `visiblePaletteActions`
 * is the only way the dialog gets its list. Phase 1 core (checklist, messages,
 * settings) is never flagged off, so those actions only need a signed-in user.
 */

export type PaletteActionId =
  | 'new-listing'
  | 'add-checklist-item'
  | 'start-message'
  | 'toggle-theme'
  | 'notification-settings'
  | 'admin-console'
  | 'sign-out';

export interface PaletteActionContext {
  /** `useFeatureFlags().showPostItem`: the tenant allows posting marketplace items. */
  showPostItem: boolean;
  /** Effective admin (view-as preview already applied), never the raw role. */
  isAdmin: boolean;
  /** Capacitor shell: the admin console is web-only, its routes do not mount natively. */
  isNative: boolean;
}

/** Default order when nothing is recent: create first, account last. */
export const PALETTE_ACTION_ORDER: readonly PaletteActionId[] = [
  'new-listing',
  'add-checklist-item',
  'start-message',
  'toggle-theme',
  'notification-settings',
  'admin-console',
  'sign-out',
];

/** Deep links the dialog navigates to. Each target reads its param once and strips it. */
export const PALETTE_ACTION_PATHS = {
  'new-listing': '/marketplace?compose=1',
  'add-checklist-item': '/checklist?add=1',
  'start-message': '/messages?compose=1',
  'notification-settings': '/settings?section=notifications',
  'admin-console': '/admin',
} as const satisfies Partial<Record<PaletteActionId, string>>;

export function isPaletteActionVisible(id: PaletteActionId, ctx: PaletteActionContext): boolean {
  switch (id) {
    case 'new-listing':
      return ctx.showPostItem;
    case 'admin-console':
      return ctx.isAdmin && !ctx.isNative;
    default:
      return true;
  }
}

/** Visible actions, most-recently-used first, then the default order. */
export function visiblePaletteActions(
  ctx: PaletteActionContext,
  recent: readonly string[] = [],
): PaletteActionId[] {
  const visible = PALETTE_ACTION_ORDER.filter((id) => isPaletteActionVisible(id, ctx));
  const recentVisible = recent.filter((id): id is PaletteActionId =>
    (visible as readonly string[]).includes(id),
  );
  return [...new Set([...recentVisible, ...visible])];
}

// ── Recents (per-viewer convenience: localStorage, never relied on) ─────────────

export const PALETTE_RECENTS_KEY = 'dc.palette.recentActions';
export const PALETTE_RECENTS_MAX = 3;

export function readRecentActions(storage: Pick<Storage, 'getItem'> | null = safeStorage()): string[] {
  try {
    const raw = storage?.getItem(PALETTE_RECENTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Moves `id` to the front, capped. Returns the new list even if storage throws. */
export function recordRecentAction(
  id: PaletteActionId,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage(),
): string[] {
  const next = [id, ...readRecentActions(storage).filter((v) => v !== id)].slice(0, PALETTE_RECENTS_MAX);
  try {
    storage?.setItem(PALETTE_RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* private mode / blocked storage: ordering just falls back to the default */
  }
  return next;
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
