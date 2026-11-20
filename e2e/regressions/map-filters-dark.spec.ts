import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Regression (a11y P1, dark mode): the floating "Map filters" button on /campus
 * and /housing was malachite-800 text on a dark card (2.7:1). It surfaced only
 * once the dark-contrast spec stopped timing out on map pages (networkidle
 * never settles with the dummy Mapbox token, so the wait is capped).
 */
test.use({ colorScheme: 'dark' });
test.beforeEach(async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, 'phone dark pass');
  await page.addInitScript(() => localStorage.setItem('dormcheck-theme', 'dark'));
});

for (const route of ['/campus', '/housing']) {
  test(`dark contrast: ${route} map filters`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    await page.getByRole('button', { name: 'Map filters' }).first().waitFor();
    const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
    const nodes = violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(' ')}: ${n.any[0]?.message ?? ''}`));
    expect(nodes).toEqual([]);
  });
}
