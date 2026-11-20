import { expect, test, type Page } from '@playwright/test';
import { installClsObserver, readCls } from '../lib/cls';

/**
 * Regression (layout-shift P1, phone): My Home painted its column, then one
 * frame later mounted RecentActivityWidget (126px) and JourneyStrip (313px)
 * above the glance row, pushing everything below down ~487px. CLS measured
 * 0.46-0.49 at 360/390 on /my-home, and the same on /settings and the ⌘K palette
 * (both sit over My Home on phones). Racy, so each case loads five times and
 * the WORST load must stay under the 0.1 "good" bar.
 */
const LOADS = 5;

async function worstCls(page: Page, path: string, after?: (p: Page) => Promise<void>) {
  let worst = 0;
  const notes: string[] = [];
  for (let i = 0; i < LOADS; i++) {
    await page.goto('about:blank');
    await page.goto(path);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(600);
    if (after) await after(page);
    const cls = await readCls(page);
    const v = cls?.value ?? 0;
    notes.push(String(v));
    worst = Math.max(worst, v);
  }
  return { worst, notes: notes.join(', ') };
}

test.beforeEach(async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, 'phone-width regression');
  await installClsObserver(page);
});

for (const width of [360, 390]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: width === 360 ? 780 : 844 } });

    test('/my-home CLS < 0.1 on every load', async ({ page }) => {
      const { worst, notes } = await worstCls(page, '/my-home');
      expect(worst, `CLS per load: ${notes}`).toBeLessThan(0.1);
    });

    test('/settings CLS < 0.1 on every load', async ({ page }) => {
      const { worst, notes } = await worstCls(page, '/settings');
      expect(worst, `CLS per load: ${notes}`).toBeLessThan(0.1);
    });

    test('⌘K palette over My Home CLS < 0.1 on every load', async ({ page }) => {
      const { worst, notes } = await worstCls(page, '/my-home', async (p) => {
        await p.keyboard.press('ControlOrMeta+k');
        await expect(p.getByRole('dialog')).toBeVisible();
        await p.waitForTimeout(500);
      });
      expect(worst, `CLS per load: ${notes}`).toBeLessThan(0.1);
    });
  });
}
