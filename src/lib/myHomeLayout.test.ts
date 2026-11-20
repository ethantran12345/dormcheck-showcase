import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MY_HOME_WIDGET_ORDER,
  RETIRED_MY_HOME_WIDGET_IDS,
  mergeEffectiveHomeLayout,
  parseHomeLayout,
} from '@/lib/myHomeLayout';

const LIVE_DEFAULT_ORDER = DEFAULT_MY_HOME_WIDGET_ORDER.filter(
  (id) => !RETIRED_MY_HOME_WIDGET_IDS.has(id),
);

// The building_chats widget was retired when its content moved into the Your
// Dorm hub. Saved home_layout JSON from before the retirement still contains
// the id; parsing and merging must drop it silently.
describe('myHomeLayout with retired building_chats id', () => {
  const legacyLayout = {
    order: ['building_chats', 'checklist', 'your_dorm'],
    hidden: ['building_chats'],
    sizes: { building_chats: 'large', messages: 'small' },
  };

  it('parseHomeLayout drops the retired id from order, hidden, and sizes', () => {
    const parsed = parseHomeLayout(legacyLayout);
    expect(parsed).not.toBeNull();
    expect(parsed!.order).not.toContain('building_chats');
    expect(parsed!.hidden).not.toContain('building_chats');
    expect(Object.keys(parsed!.sizes ?? {})).not.toContain('building_chats');
  });

  it('mergeEffectiveHomeLayout returns a valid full order', () => {
    const merged = mergeEffectiveHomeLayout(parseHomeLayout(legacyLayout));
    expect(merged.order).not.toContain('building_chats');
    expect([...merged.order].sort()).toEqual([...LIVE_DEFAULT_ORDER].sort());
  });

  it('handles a saved order containing only retired ids', () => {
    const merged = mergeEffectiveHomeLayout(parseHomeLayout({ order: ['building_chats'] }));
    expect([...merged.order].sort()).toEqual([...LIVE_DEFAULT_ORDER].sort());
  });
});

// The hero/journey/glance layer superseded several grid widgets (setup_guide,
// checklist, roommate_group, roommate_matches). Saved layouts from before that
// still hold the ids; the merge must drop them from the rendered order.
describe('myHomeLayout with hero-superseded retired widgets', () => {
  it('drops retired ids from a legacy saved order', () => {
    const merged = mergeEffectiveHomeLayout(
      parseHomeLayout({ order: ['your_dorm', 'checklist', 'messages'] }),
    );
    for (const id of RETIRED_MY_HOME_WIDGET_IDS) {
      expect(merged.order).not.toContain(id);
    }
    expect([...merged.order].sort()).toEqual([...LIVE_DEFAULT_ORDER].sort());
  });

  it('keeps a retired hidden pref harmless', () => {
    const merged = mergeEffectiveHomeLayout(parseHomeLayout({ hidden: ['setup_guide'] }));
    expect(merged.order).not.toContain('setup_guide');
  });
});
