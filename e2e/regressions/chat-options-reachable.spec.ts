import { expect, test } from '@playwright/test';
import { PITT_UNIVERSITY_ID, ensureUser } from '../lib/api';

/**
 * Regression (contract §12 trust, P0 journey "DM report/block"): on phones the
 * global top-bar pill (TopNav, fixed top-0 z-[1000]) covered the open
 * conversation's "Conversation options" button (x 338-378 at 390px), so Report
 * and Block were unreachable from a chat on mobile. Found by the 390 journey
 * sweep once its harness could reach the report flow.
 */
test('phone: an open conversation\'s options menu is tappable and offers Report', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, 'phone-only overlap');
  const peerId = await ensureUser('e2e-journey-peer@pitt.edu', { universityId: PITT_UNIVERSITY_ID, fullName: 'E2E Journey Peer' });
  await page.goto(`/messages?user=${peerId}`);
  const options = page.getByRole('button', { name: 'Conversation options' }).filter({ visible: true }).first();
  await options.click({ timeout: 10_000 });
  await expect(page.getByRole('menuitem', { name: 'Report' })).toBeVisible();
});

test('phone: the top-bar pill is still there on the conversation list', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, 'phone-only');
  await page.goto('/messages');
  await expect(page.getByRole('link', { name: /messages/i }).filter({ visible: true }).first()).toBeVisible();
});
