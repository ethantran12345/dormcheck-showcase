import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en/misc.json';
import zh from '@/i18n/locales/zh/misc.json';
import { handleListArrowKeys, LIST_CONTAINER_ATTR, LIST_ROW_ATTR } from '@/lib/listKeyboard';
import {
  SHORTCUTS,
  getShortcut,
  isApplePlatform,
  matchesShortcut,
  shortcutsForSheet,
  type ShortcutKey,
} from '@/lib/shortcuts';

const key = (k: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

/** The DOM `key` a registry key produces when pressed alone. */
const DOM_KEY: Partial<Record<ShortcutKey, string>> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  home: 'Home',
  end: 'End',
  enter: 'Enter',
  esc: 'Escape',
};

describe('matchesShortcut', () => {
  it('opens the palette on Cmd+K and Ctrl+K, not on bare K or Cmd+Shift+K', () => {
    expect(matchesShortcut(key('k', { metaKey: true }), 'openPalette')).toBe(true);
    expect(matchesShortcut(key('k', { ctrlKey: true }), 'openPalette')).toBe(true);
    expect(matchesShortcut(key('K', { metaKey: true }), 'openPalette')).toBe(true);
    expect(matchesShortcut(key('k'), 'openPalette')).toBe(false);
    expect(matchesShortcut(key('K', { metaKey: true, shiftKey: true }), 'openPalette')).toBe(false);
    expect(matchesShortcut(key('k', { metaKey: true, altKey: true }), 'openPalette')).toBe(false);
  });

  it('treats "?" and "/" as typed characters (shift allowed), never with Cmd/Ctrl', () => {
    expect(matchesShortcut(key('?', { shiftKey: true }), 'showShortcuts')).toBe(true);
    expect(matchesShortcut(key('/'), 'focusSearch')).toBe(true);
    expect(matchesShortcut(key('/', { metaKey: true }), 'focusSearch')).toBe(false);
    expect(matchesShortcut(key('?', { ctrlKey: true, shiftKey: true }), 'showShortcuts')).toBe(false);
  });

  it('keeps the reports queue letters bare: no modifiers, no shifted capitals', () => {
    expect(matchesShortcut(key('j'), 'reportsNext')).toBe(true);
    expect(matchesShortcut(key('J', { shiftKey: true }), 'reportsNext')).toBe(false);
    expect(matchesShortcut(key('j', { metaKey: true }), 'reportsNext')).toBe(false);
    expect(matchesShortcut(key('k'), 'reportsPrev')).toBe(true);
    expect(matchesShortcut(key('a'), 'reportsApprove')).toBe(true);
    expect(matchesShortcut(key('h'), 'reportsHide')).toBe(true);
  });
});

describe('the "?" sheet cannot drift from the handlers', () => {
  it('lists conversation keys that listKeyboard actually consumes', () => {
    document.body.innerHTML = `<div ${LIST_CONTAINER_ATTR}><button ${LIST_ROW_ATTR}>a</button><button ${LIST_ROW_ATTR}>b</button></div>`;
    const row = document.querySelector<HTMLElement>(`[${LIST_ROW_ATTR}]`)!;
    // jsdom has no layout, so no scrollIntoView; the handler calls it after a move.
    Element.prototype.scrollIntoView ??= () => {};
    for (const id of ['messagesMove', 'messagesEnds'] as const) {
      for (const [k] of getShortcut(id).combos) {
        const e = { ...key(DOM_KEY[k]!), target: row, preventDefault: () => {} };
        expect(handleListArrowKeys(e as unknown as React.KeyboardEvent<HTMLElement>), `${id}:${k}`).toBe(true);
      }
    }
  });

  it('every shortcut has a label in English and Chinese', () => {
    for (const s of SHORTCUTS) {
      // labelKey is `misc:shortcuts.<leaf>`; keep the prefix out of a string literal,
      // or the i18n scanner reads it as a (missing) key.
      const leaf = s.labelKey.split('.').slice(1).join('.') as keyof typeof en.shortcuts;
      expect(en.shortcuts[leaf], s.id).toBeTypeOf('string');
      expect(zh.shortcuts[leaf as keyof typeof zh.shortcuts], s.id).toBeTypeOf('string');
    }
  });

  it('hides admin-only shortcuts from students', () => {
    const studentIds = shortcutsForSheet(false).flatMap((g) => g.items.map((s) => s.id));
    expect(studentIds).not.toContain('reportsNext');
    const adminIds = shortcutsForSheet(true).flatMap((g) => g.items.map((s) => s.id));
    expect(adminIds).toContain('reportsNext');
  });
});

describe('isApplePlatform', () => {
  it('labels mod as Command on Apple platforms only', () => {
    expect(isApplePlatform({ platform: 'MacIntel', userAgent: '' })).toBe(true);
    expect(isApplePlatform({ platform: 'Win32', userAgent: '' })).toBe(false);
    expect(isApplePlatform({ platform: '', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe(false);
  });
});
