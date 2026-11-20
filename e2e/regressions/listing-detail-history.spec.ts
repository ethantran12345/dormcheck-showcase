import { expect, test } from '@playwright/test';

/**
 * Regression (contract §8, P0 journey): the listing detail is in-page state with
 * no history entry, so the browser Back button left /marketplace entirely (to
 * the previous page) instead of closing the sheet. Back must close the detail
 * and keep the student on the feed; Close must not leave a dead history entry.
 */
const SEEDED = 'a0000000-0000-4000-8000-000000000001';

test('card → detail → Back closes the detail and stays on /marketplace', async ({ page }) => {
  await page.goto('/my-home');
  await page.goto('/marketplace');
  await page.locator('[data-listing-open]').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveURL(/listing=/);
  await page.goBack();
  await expect(page).toHaveURL(/\/marketplace/);
  await expect(page).not.toHaveURL(/listing=/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-listing-open]').first()).toBeVisible();
});

test('Close returns to the feed without a stale history entry', async ({ page }) => {
  await page.goto('/my-home');
  await page.goto('/marketplace');
  await page.locator('[data-listing-open]').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).not.toHaveURL(/listing=/);
  await page.goBack();
  await expect(page).toHaveURL(/\/my-home/);
});

test('?listing= deep link opens the detail and Back closes it on the feed', async ({ page }) => {
  await page.goto('/my-home');
  await page.goto(`/marketplace?listing=${SEEDED}`);
  await expect(page.getByRole('dialog').getByRole('heading', { name: /Mini fridge/ }).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
  await page.goBack();
  await expect(page).toHaveURL(/\/marketplace/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
