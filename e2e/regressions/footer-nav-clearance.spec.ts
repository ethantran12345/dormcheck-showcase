import { expect, test } from '@playwright/test';

/**
 * Regression (layout P1, nav-occlusion): on phones a signed-in student reaches
 * the marketing and legal pages with the bottom nav still showing, but their
 * footer renders after <main>, outside the app shell's --dc-bottom-nav-h
 * reservation. At full scroll "© DormCheck" sat under the bar (803px vs a 762px
 * bar top at 390x844). The last line of every such page must clear the bar.
 */
const PAGES = ['/about', '/ads', '/feedback', '/for-students', '/moderation'];

for (const path of PAGES) {
  test(`footer clears the bottom nav at full scroll: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.getByText(/© DormCheck/).first().waitFor();
    const nav = page.getByRole('navigation', { name: 'Bottom navigation' });
    const phone = (page.viewportSize()?.width ?? 1280) < 768;
    if (phone) await expect(nav).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);
    const copyrightBottom = await page.getByText(/© DormCheck/).first().evaluate((n) => n.getBoundingClientRect().bottom);
    const barTop = phone ? await nav.evaluate((n) => n.getBoundingClientRect().top) : await page.evaluate(() => innerHeight);
    expect(copyrightBottom, `© line bottom ${copyrightBottom}px vs bar top ${barTop}px`).toBeLessThanOrEqual(barTop);
  });
}
