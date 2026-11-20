import { describe, expect, it } from 'vitest';
import {
  PALETTE_RECENTS_KEY,
  PALETTE_RECENTS_MAX,
  isPaletteActionVisible,
  readRecentActions,
  recordRecentAction,
  visiblePaletteActions,
} from '@/lib/paletteActions';

const student = { showPostItem: true, isAdmin: false, isNative: false };

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

describe('palette action visibility', () => {
  it('never offers posting when the tenant has it off', () => {
    expect(isPaletteActionVisible('new-listing', { ...student, showPostItem: false })).toBe(false);
    expect(visiblePaletteActions({ ...student, showPostItem: false })).not.toContain('new-listing');
  });

  it('offers the admin console only to an effective admin on web', () => {
    expect(visiblePaletteActions(student)).not.toContain('admin-console');
    expect(visiblePaletteActions({ ...student, isAdmin: true })).toContain('admin-console');
    // Admin routes do not mount in the native shell.
    expect(visiblePaletteActions({ ...student, isAdmin: true, isNative: true })).not.toContain('admin-console');
  });

  it('always offers the Phase 1 core actions', () => {
    const ids = visiblePaletteActions({ showPostItem: false, isAdmin: false, isNative: true });
    expect(ids).toEqual(['add-checklist-item', 'start-message', 'toggle-theme', 'notification-settings', 'sign-out']);
  });
});

describe('palette recents', () => {
  it('floats recent actions to the top, most recent first, without duplicates', () => {
    expect(visiblePaletteActions(student, ['sign-out', 'start-message']).slice(0, 3)).toEqual([
      'sign-out',
      'start-message',
      'new-listing',
    ]);
  });

  it('drops a recent action that is no longer visible (flag turned off since)', () => {
    const ids = visiblePaletteActions({ ...student, showPostItem: false }, ['new-listing', 'garbage']);
    expect(ids[0]).toBe('add-checklist-item');
    expect(ids).not.toContain('new-listing');
  });

  it('records most-recent-first and caps the list', () => {
    const storage = memoryStorage();
    recordRecentAction('start-message', storage);
    recordRecentAction('toggle-theme', storage);
    recordRecentAction('sign-out', storage);
    recordRecentAction('start-message', storage);
    const list = readRecentActions(storage);
    expect(list).toEqual(['start-message', 'sign-out', 'toggle-theme']);
    expect(list.length).toBeLessThanOrEqual(PALETTE_RECENTS_MAX);
  });

  it('survives corrupt or throwing storage', () => {
    expect(readRecentActions(memoryStorage({ [PALETTE_RECENTS_KEY]: '{not json' }))).toEqual([]);
    expect(readRecentActions(memoryStorage({ [PALETTE_RECENTS_KEY]: '{"a":1}' }))).toEqual([]);
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readRecentActions(throwing)).toEqual([]);
    expect(recordRecentAction('sign-out', throwing)).toEqual(['sign-out']);
  });
});
