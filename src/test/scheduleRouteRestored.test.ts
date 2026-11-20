import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildHousingGroup,
  buildScheduleGroup,
  getAllNavSections,
  getCreateAction,
  getHomeHubItems,
} from '@/components/nav/navSections';
import { SHOW_SCHEDULE } from '@/lib/featureFlags';
import { RETIRED_MY_HOME_WIDGET_IDS, HIDEABLE_MY_HOME_WIDGET_IDS } from '@/lib/myHomeLayout';

/**
 * Schedule was retired on 2026-08-17 (`74898fc8`) and restored on 2026-08-26. The
 * retirement left several tombstones behind — a `/schedule` → `/housing` redirect, a
 * non-rendering My Home widget id, a missing feature flag — and each of them silently
 * neuters the feature rather than breaking a build. This pins the wiring so a future
 * cleanup pass cannot half-remove it again without a red test.
 */
describe('restored Schedule surface', () => {
  const routes = readFileSync(resolve(process.cwd(), 'src/routes/AppRoutes.tsx'), 'utf8');

  it('routes /schedule to SchedulePage, not to a redirect', () => {
    expect(routes).toContain('const SchedulePage = lazy(() => import("@/pages/app/SchedulePage"));');
    expect(routes).toContain('<Route path="/schedule" element={<ProtectedRoute><SchedulePage /></ProtectedRoute>} />');
    expect(routes).not.toContain('<Route path="/schedule" element={<Navigate to="/housing" replace />} />');
  });

  it('ships with the nav entries on', () => {
    expect(SHOW_SCHEDULE).toBe(true);
  });

  /**
   * Schedule left the Housing cluster on 2026-08-27. It had been a row inside
   * `buildHousingGroup`, and `/schedule` counted as a housing path throughout —
   * which meant the Housing tab remembered it as the section's last-visited page
   * and thereafter opened the schedule instead of the dorms list. These cases pin
   * the separation from both ends, since re-coupling them compiles fine.
   */
  it('keeps Schedule out of the Housing cluster entirely', () => {
    for (const path of ['/housing', '/schedule', '/gallery', '/community']) {
      const tos = buildHousingGroup(path, true, true).items.map((i) => i.to);
      expect(tos, `housing group on ${path}`).not.toContain('/schedule');
    }
  });

  it('never marks a Housing row active while on /schedule', () => {
    const active = buildHousingGroup('/schedule', true, true).items.filter((i) => i.active);
    expect(active).toEqual([]);
  });

  it('gives /schedule its own group, not the housing one', () => {
    const group = buildScheduleGroup('/schedule', true);
    expect(group.key).toBe('schedule');
    expect(group.primaryAction?.to).toBe('/schedule?action=add-class');
    expect(group.items.map((i) => i.to)).toContain('/schedule?action=change-home');
    expect(getCreateAction('/schedule')?.to).toBe('/schedule?action=add-class');
  });

  it('derives the schedule tile active state instead of pinning it true', () => {
    const onRoute = buildScheduleGroup('/schedule', true).items.find((i) => i.to === '/schedule');
    const offRoute = buildScheduleGroup('/my-home', true).items.find((i) => i.to === '/schedule');
    expect(onRoute?.active).toBe(true);
    expect(offRoute?.active).toBe(false);
  });

  it('still lists Schedule for the sidebar and Home hub when the flag is on', () => {
    const flags = { showHousing: true, showRoommates: false, showBrowseSublease: true, showSchedule: true };
    const keys = getAllNavSections('/my-home', '', flags).map((g) => g.key);
    expect(keys).toContain('schedule');
    expect(getAllNavSections('/my-home', '', { ...flags, showSchedule: false }).map((g) => g.key))
      .not.toContain('schedule');
    expect(getHomeHubItems('/my-home', '', flags).map((i) => i.to)).toContain('/schedule');
  });

  // The bottom bar's half of the separation — that neither the read nor the write
  // side of `dormcheck_last_housing` treats /schedule as a housing page — is
  // covered behaviourally in `src/components/BottomNav.housingTab.test.tsx`,
  // which drives the real component through the real store.

  it('treats the My Home schedule widget as live, not retired', () => {
    expect(RETIRED_MY_HOME_WIDGET_IDS.has('schedule')).toBe(false);
    expect(HIDEABLE_MY_HOME_WIDGET_IDS.has('schedule')).toBe(true);
  });
});
