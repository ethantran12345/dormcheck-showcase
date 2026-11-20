import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN_STATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.audit-app/state/admin.json');

/**
 * Regression (a11y P1, dark mode, student-facing), from the 2026-10-12 after-run:
 *  · signed-out visitors on /marketplace and the 404 got the light-only marketing
 *    chrome under a DARK document (wordmark 1.01:1, guest banner 2.03:1); dark
 *    mode is a signed-in feature, so signed-out must resolve light;
 *  · My Items amber/destructive actions on dark cards (3.35 / 3.51);
 *  · Filters (/campus, /housing, /gallery) and Map View (/map) in malachite-800
 *    on dark cards (2.7).
 */
async function contrast(page: Page, route: string) {
  await page.addInitScript(() => localStorage.setItem('dormcheck-theme', 'dark'));
  await page.goto(route);
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(800);
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  return violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(' ')}: ${n.any[0]?.message ?? ''}`));
}

test.use({ colorScheme: 'dark' });

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const route of ['/marketplace', '/this-route-does-not-exist']) {
    test(`dark OS, signed out → light, contrast clean: ${route}`, async ({ page }) => {
      expect(await contrast(page, route)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(false);
    });
  }
});

for (const route of ['/marketplace/my-items', '/campus', '/housing', '/gallery', '/map']) {
  test(`signed in, dark: contrast clean on ${route}`, async ({ page }) => {
    test.skip(route === '/map', '/map is gated for the Pitt e2e student; covered by the full-app case below');
    expect(await contrast(page, route)).toEqual([]);
  });
}

test.describe('full app (admin preview; what a CMU student sees on /map)', () => {
  test.use({ storageState: ADMIN_STATE });
  test('signed in, dark: contrast clean on /map', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('dc_admin_full_app_preview', 'true'));
    expect(await contrast(page, '/map')).toEqual([]);
  });
});
