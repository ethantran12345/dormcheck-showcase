import AxeBuilder from '@axe-core/playwright';
import { devices, expect, test } from '@playwright/test';

/**
 * Regression (a11y, hard-fail in the weekly audit:app crawl): at the crawl's
 * Desktop Chrome 1280x720, the sidebar bookmarks region (flex-1 min-h-0
 * overflow-y-auto) shrinks on pages whose Housing section is expanded until its
 * "No bookmarks yet" hint overflows: a scrollable region with nothing focusable
 * (axe scrollable-region-focusable, serious → P0 under A11Y_STRICT=1).
 */
// 560px tall: the crawl hit this at 720 only when enough sidebar content sat
// above the region; a shorter window makes the structural defect (an empty-state
// hint inside a shrinkable scroll box) deterministic.
test.use({ ...devices['Desktop Chrome'], viewport: { width: 1280, height: 560 } });

for (const route of ['/subleases', '/campus', '/housing', '/gallery', '/housing/this-dorm-does-not-exist']) {
  test(`no scrollable-region-focusable at 1280x560: ${route}`, async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 1024, 'desktop sidebar only');
    await page.goto(route);
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(600);
    const { violations } = await new AxeBuilder({ page }).withRules(['scrollable-region-focusable']).analyze();
    expect(violations.flatMap((v) => v.nodes.map((n) => n.target.join(' ')))).toEqual([]);
  });
}
