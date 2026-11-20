import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MY_HOME_WIDGET_ORDER,
  MY_HOME_WIDGET_LABELS,
  RETIRED_MY_HOME_WIDGET_IDS,
  mergeEffectiveHomeLayout,
  mergeHomeWidgetHidden,
  mergeHomeWidgetOrder,
  parseHomeLayout,
} from '@/lib/myHomeLayout';
import { MY_HOME_WIDGET_ICON, MY_HOME_WIDGET_TINT } from '@/components/my-home/widgetMeta';

const LIVE_DEFAULT_ORDER = DEFAULT_MY_HOME_WIDGET_ORDER.filter(
  (id) => !RETIRED_MY_HOME_WIDGET_IDS.has(id),
);

describe('widget registry completeness', () => {
  // Every widget in the default order must carry icon + tint + label metadata.
  // A missing entry crashes the customize list (renders a blank screen) but is
  // only a *type*-error, which `npm run build` (vite, no type-check) doesn't
  // catch - so guard it here, in `npm run test`. Regression: the `resources`
  // widget shipped without icon/tint and blanked the Customize screen.
  it('has icon, tint, and label for every default-order widget', () => {
    for (const id of DEFAULT_MY_HOME_WIDGET_ORDER) {
      expect(MY_HOME_WIDGET_ICON[id], `icon missing for "${id}"`).toBeDefined();
      expect(MY_HOME_WIDGET_TINT[id], `tint missing for "${id}"`).toBeDefined();
      expect(MY_HOME_WIDGET_LABELS[id], `label missing for "${id}"`).toBeTruthy();
    }
  });
});

describe('mergeHomeWidgetOrder', () => {
  it('returns default order (minus retired ids) when saved order is empty', () => {
    expect(mergeHomeWidgetOrder([])).toEqual(LIVE_DEFAULT_ORDER);
    expect(mergeHomeWidgetOrder(null)).toEqual(LIVE_DEFAULT_ORDER);
  });

  it('preserves saved order, appends missing registry ids, and drops retired ids', () => {
    const order = mergeHomeWidgetOrder(['messages', 'your_dorm', 'checklist', 'unknown' as never]);
    expect(order.indexOf('messages')).toBeLessThan(order.indexOf('your_dorm'));
    expect(order).toHaveLength(LIVE_DEFAULT_ORDER.length);
    for (const id of LIVE_DEFAULT_ORDER) {
      expect(order).toContain(id);
    }
    expect(order).not.toContain('checklist');
  });
});

describe('mergeHomeWidgetHidden', () => {
  it('strips essentials and unknown ids', () => {
    const hidden = mergeHomeWidgetHidden([
      'activity_feed',
      'messages',
      'not_a_widget' as never,
    ]);
    expect(hidden.has('activity_feed')).toBe(true);
    expect(hidden.has('messages')).toBe(false);
    expect(hidden.size).toBe(1);
  });
});

describe('parseHomeLayout', () => {
  it('parses valid layout json', () => {
    expect(
      parseHomeLayout({ order: ['messages', 'checklist'], hidden: ['saved'] }),
    ).toEqual({ order: ['messages', 'checklist'], hidden: ['saved'] });
  });
});

describe('mergeEffectiveHomeLayout', () => {
  it('merges order and hidden together, excluding retired ids from order', () => {
    const { order, hidden } = mergeEffectiveHomeLayout({
      order: ['messages'],
      hidden: ['checklist', 'saved'],
    });
    expect(order).toContain('messages');
    expect(order).not.toContain('checklist');
    expect(hidden.has('saved')).toBe(true);
  });
});
