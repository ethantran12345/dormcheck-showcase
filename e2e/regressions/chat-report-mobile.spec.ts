import { expect, test } from '@playwright/test';
import { PITT_UNIVERSITY_ID, ensureUser } from '../lib/api';

/**
 * Regression (contract §12 trust, P0 journey "DM report"): on phones, ChatPanel
 * returns a separate mobile tree that rendered the message-report and share
 * dialogs but not the USER report dialog, so "Report" in a conversation's
 * options menu did nothing on mobile. Found by the 390 journey sweep right after
 * chat-options-reachable made the menu tappable.
 */
test('Report in a conversation opens the report form, at every width', async ({ page }) => {
  const peerId = await ensureUser('e2e-journey-peer@pitt.edu', { universityId: PITT_UNIVERSITY_ID, fullName: 'E2E Journey Peer' });
  await page.goto(`/messages?user=${peerId}`);
  await page.getByRole('button', { name: 'Conversation options' }).filter({ visible: true }).first().click({ timeout: 10_000 });
  await page.getByRole('menuitem', { name: 'Report' }).click();
  const form = page.getByRole('alertdialog').or(page.getByRole('dialog')).first();
  await expect(form).toBeVisible({ timeout: 5_000 });
  await expect(form.getByRole('button', { name: 'Submit report' })).toBeDisabled();
  await form.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});
