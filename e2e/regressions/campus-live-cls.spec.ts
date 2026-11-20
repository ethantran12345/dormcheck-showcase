import { expect, test } from '@playwright/test';
import { installClsObserver, readCls } from '../lib/cls';

/**
 * Regression (layout-shift P1 by the crawl's >0.25 bar, phone): /campus-live
 * painted three cards with fixed skeleton heights, then each resolved to a
 * different height (dining 294 → 126px, key dates 190 → 126px locally; row
 * counts in production), shifting everything below. CLS 0.27-0.33 at 360/390.
 * Worst of five loads must stay under the 0.1 "good" bar.
 */
for (const width of [360, 390]) {
  test(`/campus-live CLS < 0.1 on every load at ${width}px`, async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) >= 768, 'phone-width regression');
    await page.setViewportSize({ width, height: width === 360 ? 780 : 844 });
    await installClsObserver(page);
    const values: number[] = [];
    for (let i = 0; i < 5; i++) {
      await page.goto('about:blank');
      await page.goto('/campus-live');
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(600);
      values.push((await readCls(page))?.value ?? 0);
    }
    expect(Math.max(...values), `CLS per load: ${values.join(', ')}`).toBeLessThan(0.1);
  });
}
