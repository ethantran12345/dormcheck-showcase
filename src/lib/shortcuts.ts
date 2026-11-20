/**
 * The ONE list of keyboard shortcuts that actually work in the app.
 *
 * Every consumer reads from here, which is what keeps the "?" sheet honest:
 *   - the key handlers (GlobalSearchContext, admin ReportsPage) match with
 *     `matchesShortcut(e, id)`, so changing a key here changes the behaviour;
 *   - the hints (sidebar, profile menu, palette footer) and the "?" sheet render
 *     the same `combos`, so they cannot advertise a key the handler ignores.
 * `src/lib/shortcuts.test.ts` drives each handler through this table, so a
 * shortcut that stops working fails a test instead of silently rotting in the sheet.
 *
 * Desktop only. Keyboard hints never render on touch or in the native shell;
 * see `useShowKeyboardHints` in `src/components/shortcuts/`.
 */

/** `mod` = Cmd on Apple platforms, Ctrl elsewhere (both are accepted when matching). */
export type ShortcutKey =
  | 'mod'
  | 'shift'
  | 'enter'
  | 'esc'
  | 'up'
  | 'down'
  | 'home'
  | 'end'
  | '/'
  | '?'
  | 'a'
  | 'h'
  | 'j'
  | 'k';

export type ShortcutGroup = 'general' | 'search' | 'messages' | 'adminReports';

export type ShortcutId =
  | 'openPalette'
  | 'focusSearch'
  | 'showShortcuts'
  | 'paletteMove'
  | 'paletteRun'
  | 'paletteClose'
  | 'messagesMove'
  | 'messagesEnds'
  | 'reportsNext'
  | 'reportsPrev'
  | 'reportsApprove'
  | 'reportsHide';

export interface ShortcutDef {
  id: ShortcutId;
  group: ShortcutGroup;
  /** Each inner array is keys pressed together; several arrays are alternatives. */
  combos: readonly (readonly ShortcutKey[])[];
  /** i18n key (namespace `misc`) describing what it does. */
  labelKey: string;
  /** Only listed for admins (the admin console itself is web-only). */
  adminOnly?: boolean;
}

export const SHORTCUT_GROUP_ORDER: readonly ShortcutGroup[] = ['general', 'search', 'messages', 'adminReports'];

export const SHORTCUTS: readonly ShortcutDef[] = [
  { id: 'openPalette', group: 'general', combos: [['mod', 'k']], labelKey: 'misc:shortcuts.openPalette' },
  { id: 'focusSearch', group: 'general', combos: [['/']], labelKey: 'misc:shortcuts.focusSearch' },
  { id: 'showShortcuts', group: 'general', combos: [['?']], labelKey: 'misc:shortcuts.showShortcuts' },
  // Palette keys are cmdk's own; listed so the sheet is complete, not re-implemented.
  { id: 'paletteMove', group: 'search', combos: [['up'], ['down']], labelKey: 'misc:shortcuts.paletteMove' },
  { id: 'paletteRun', group: 'search', combos: [['enter']], labelKey: 'misc:shortcuts.paletteRun' },
  { id: 'paletteClose', group: 'search', combos: [['esc']], labelKey: 'misc:shortcuts.paletteClose' },
  // Conversation rows: src/lib/listKeyboard.ts (the test proves it handles these keys).
  { id: 'messagesMove', group: 'messages', combos: [['up'], ['down']], labelKey: 'misc:shortcuts.messagesMove' },
  { id: 'messagesEnds', group: 'messages', combos: [['home'], ['end']], labelKey: 'misc:shortcuts.messagesEnds' },
  { id: 'reportsNext', group: 'adminReports', combos: [['j']], labelKey: 'misc:shortcuts.reportsNext', adminOnly: true },
  { id: 'reportsPrev', group: 'adminReports', combos: [['k']], labelKey: 'misc:shortcuts.reportsPrev', adminOnly: true },
  { id: 'reportsApprove', group: 'adminReports', combos: [['a']], labelKey: 'misc:shortcuts.reportsApprove', adminOnly: true },
  { id: 'reportsHide', group: 'adminReports', combos: [['h']], labelKey: 'misc:shortcuts.reportsHide', adminOnly: true },
];

export function getShortcut(id: ShortcutId): ShortcutDef {
  const def = SHORTCUTS.find((s) => s.id === id);
  if (!def) throw new Error(`Unknown shortcut: ${id}`);
  return def;
}

const NAMED_KEYS: Partial<Record<ShortcutKey, string>> = {
  enter: 'Enter',
  esc: 'Escape',
  up: 'ArrowUp',
  down: 'ArrowDown',
  home: 'Home',
  end: 'End',
};

type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>;

function matchesCombo(e: KeyLike, combo: readonly ShortcutKey[]): boolean {
  const wantsMod = combo.includes('mod');
  const wantsShift = combo.includes('shift');
  const main = combo.find((k) => k !== 'mod' && k !== 'shift');
  if (!main) return false;
  if (e.altKey) return false;
  if (wantsMod !== (e.metaKey || e.ctrlKey)) return false;
  // Letters are case-sensitive in intent: Cmd+Shift+K is a different command, and a
  // bare "J" (caps lock or shift) should not advance the reports queue. "?" and "/"
  // are typed WITH shift on most layouts, so shift is not checked for them.
  const isLetter = /^[a-z]$/.test(main);
  if (wantsShift ? !e.shiftKey : isLetter && e.shiftKey) return false;
  const named = NAMED_KEYS[main];
  if (named) return e.key === named;
  return isLetter ? e.key.toLowerCase() === main : e.key === main;
}

/** True when `e` is any of the shortcut's combos. */
export function matchesShortcut(e: KeyLike, id: ShortcutId): boolean {
  return getShortcut(id).combos.some((combo) => matchesCombo(e, combo));
}

/** Apple keyboards label `mod` as ⌘; everything else spells out Ctrl. */
export function isApplePlatform(nav: Pick<Navigator, 'platform' | 'userAgent'> | undefined =
  typeof navigator !== 'undefined' ? navigator : undefined): boolean {
  if (!nav) return false;
  return /mac|iphone|ipad|ipod/i.test(nav.platform || nav.userAgent || '');
}

/** Visible shortcuts for the "?" sheet, grouped in display order. */
export function shortcutsForSheet(isAdmin: boolean): { group: ShortcutGroup; items: ShortcutDef[] }[] {
  return SHORTCUT_GROUP_ORDER.map((group) => ({
    group,
    items: SHORTCUTS.filter((s) => s.group === group && (!s.adminOnly || isAdmin)),
  })).filter((g) => g.items.length > 0);
}
