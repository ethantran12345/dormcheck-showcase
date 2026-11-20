import { expect, test } from '@playwright/test';
import { serviceClient } from '../lib/api';

/**
 * Regressions (P0 journey "checklist mutate/group"):
 *  · hub card "Manage list" was silent at 390 and 1440 (no sheet, no change);
 *  · delete removed a row instantly with no confirm and no undo. Decision
 *    (2026-10-11): one tap, then an undo toast for a few seconds using the app's
 *    existing toast-with-undo pattern; Undo restores the row and the restore
 *    survives a reload.
 */
const addBox = (page: import('@playwright/test').Page) => page.getByRole('textbox', { name: 'Add an item…' });

test('hub card "Manage list" opens the manage sheet', async ({ page }) => {
  await page.goto('/checklist');
  // Make sure a group list exists to manage.
  if ((await page.getByText('My Group').count()) === 0) {
    await page.getByRole('button', { name: 'Make a new group list' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Create group & get invite link|Confirm .* & get link/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).first().click();
    await page.goto('/checklist');
  }
  // Visible on a phone without hover (it was opacity-0 until group-hover, so a
  // touch user could not see it at all).
  const manage = page.getByRole('button', { name: 'Manage list' }).first();
  await expect(manage).toBeVisible({ timeout: 10_000 });
  await manage.click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
});

test('delete → Undo restores the row, and the restore survives a reload', async ({ page }) => {
  const item = `Undo journey ${Date.now().toString(36)}`;
  await page.goto('/checklist?add=1');
  await addBox(page).fill(item);
  await addBox(page).press('Enter');
  const row = page.getByRole('button', { name: new RegExp(`^Advance ${item}, currently`) });
  await expect(row).toBeVisible();
  await page.getByRole('button', { name: `More actions for ${item}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: /^undo$/i }).click({ timeout: 4_000 });
  await expect(row).toBeVisible();
  await page.goto('/checklist?add=1');
  await expect(page.getByRole('button', { name: new RegExp(`^Advance ${item}, currently`) })).toBeVisible({ timeout: 15_000 });
  const { data: me } = await serviceClient().from('profiles').select('id').ilike('email', process.env.E2E_USER_EMAIL!).single();
  const { count } = await serviceClient().from('checklist_items').select('id', { count: 'exact', head: true }).eq('user_id', me!.id).eq('item', item);
  expect(count).toBe(1);
});
