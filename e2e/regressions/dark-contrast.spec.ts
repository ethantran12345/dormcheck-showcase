import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Regression (a11y P1, dark mode, student-facing): axe color-contrast must pass
 * in dark mode on every surface a signed-in student reaches. The 2026-10-11 dark
 * pass found: the Campus Live "see all" link (malachite-800 on #101114, 3.02:1)
 * on /my-home and under the /settings sheet; text-destructive freshness notes on
 * /campus-live (3.51:1); and the bottom nav over /contact, a light-only marketing
 * page that was not in the always-light theme scope (3.85:1).
 */
const ROUTES = [
  '/my-home', '/checklist', '/checklist?add=1', '/marketplace', '/messages', '/settings', '/notifications',
  // /campus and /housing (Map filters button) are covered by map-filters-dark.spec.ts.
  '/gallery', '/campus-live', '/community', '/schedule', '/shop', '/logistics',
  '/subleases', '/contact', '/waitlist', '/my-home/dorm', '/campus/sutherland-hall',
];

test.use({ colorScheme: 'dark' });
test.beforeEach(async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, 'phone dark pass (the 1440 dark crawl had no student-page contrast hits)');
  await page.addInitScript(() => localStorage.setItem('dormcheck-theme', 'dark'));
});

for (const route of ROUTES) {
  test(`dark contrast: ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {}); // map pages never idle (dummy Mapbox token)
    await page.waitForTimeout(800);
    const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
    const nodes = violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(' ')}: ${n.any[0]?.message ?? ''}`));
    expect(nodes).toEqual([]);
  });
}
