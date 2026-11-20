import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Regression (a11y P1, layout crawl): dorm detail's "More to explore" carousel
 * wrapped each DormCard (which has its own open and Save buttons) in a
 * role="button" div: axe nested-interactive (serious) at every width. The card
 * must still open the other dorm.
 */
test('dorm detail has no nested interactive controls, and a carousel card still opens', async ({ page }) => {
  await page.goto('/campus/sutherland-hall');
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  await page.getByRole('button', { name: 'Litchfield Towers A' }).or(page.getByRole('link', { name: 'Litchfield Towers A' })).first().waitFor({ timeout: 15_000 });
  const { violations } = await new AxeBuilder({ page }).withRules(['nested-interactive']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => n.target.join(' ')))).toEqual([]);
  await page.getByRole('button', { name: 'Litchfield Towers A' }).or(page.getByRole('link', { name: 'Litchfield Towers A' })).first().click();
  await expect(page).toHaveURL(/litchfield-towers-a/);
});
