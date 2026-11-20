import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Write flows (Phase 1b) - runs as the seeded Phase-1 student against the LOCAL
 * test DB, actually submitting data. Each flow asserts the success signal AND that
 * no uncaught exception fired during the interaction.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(HERE, '../docs/audits/app-bug-audit-report/screens');
fs.mkdirSync(SHOTS, { recursive: true });

/** Track uncaught exceptions across an interaction; fail if any fired. */
function watchPageErrors(page: Page): { assertClean: () => void } {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`));
  return {
    assertClean: () =>
      expect(errors, `uncaught exceptions during flow:\n${errors.join('\n')}`).toEqual([]),
  };
}

const uniqueTitle = `E2E Mini Fridge ${Date.now()}`;

test.describe('write flows', () => {
  test('profile edit - change name and save', async ({ page }, testInfo) => {
    const errs = watchPageErrors(page);
    await page.goto('/profile/edit');
    const nameInput = page.getByPlaceholder('Your name');
    await expect(nameInput).toBeVisible();
    const newName = `E2E User ${testInfo.project.name}`;
    await nameInput.fill(newName);
    await page.getByRole('button', { name: /^Save$/ }).click();
    // Success = a clean save lands on the settings profile section. The profile
    // editor moved under /settings (was a standalone /profile redirect).
    await expect(page).toHaveURL(/\/settings\?section=profile/, { timeout: 15_000 });
    await page.screenshot({ path: path.join(SHOTS, 'flow-profile-edit.png'), fullPage: true });
    errs.assertClean();
  });

  test('marketplace - create then edit a listing', async ({ page }) => {
    const errs = watchPageErrors(page);

    // The composer moved from an in-page dialog to the full-page /marketplace/create
    // takeover route (?compose=1 now navigates here). canSubmit requires a photo,
    // a title, a price, and a payment method.
    await page.goto('/marketplace/create');
    await expect(page.getByRole('heading', { name: 'Post an Item' })).toBeVisible({ timeout: 15_000 });

    // Photo: the web picker builds a hidden <input type=file> and clicks it
    // (src/hooks/useImageUpload.ts pickFilesOnWeb), so a filechooser fires.
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Add listing photos' }).click(),
    ]);
    await chooser.setFiles(path.join(HERE, 'fixtures', 'listing.png'));

    await page.getByPlaceholder('e.g., Mini Fridge').fill(uniqueTitle);
    await page.getByPlaceholder('0').first().fill('25');
    await page.getByRole('button', { name: 'Cash' }).click();
    await page.screenshot({ path: path.join(SHOTS, 'flow-marketplace-create.png'), fullPage: true });

    // Post: success returns to the marketplace buy-sell tab.
    await page.getByRole('button', { name: /^Post$/ }).click();
    await expect(page).toHaveURL(/\/marketplace\?tab=buy-sell/, { timeout: 15_000 });

    // Confirm it persisted: it shows up under My Items.
    await page.goto('/marketplace/my-items');
    await expect(page.getByText(uniqueTitle).first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: path.join(SHOTS, 'flow-marketplace-my-items.png'), fullPage: true });

    errs.assertClean();
  });
});
