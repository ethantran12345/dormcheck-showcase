import { expect, test, type Page } from '@playwright/test';
import { failReads } from '../lib/probes';

/**
 * Regression (contract §7, P1): with reads failing (offline), My Home, Messages,
 * Marketplace and the checklist hub sat on skeletons forever. Root cause: a
 * failed profile read left universityId null, so every tenant-scoped query
 * stayed disabled (pending, never erroring). Each surface must show a clear
 * error with a retry within a few seconds, and retry must recover once reads
 * work again. The checklist hub and its group lists must also say so when only
 * their own reads fail.
 */
const SURFACES: { path: string; ready: RegExp }[] = [
  { path: '/my-home', ready: /checklist|marketplace|move-in/i },
  { path: '/messages', ready: /messages/i },
  // Public route (outside ProtectedRoute): gated in Marketplace.tsx itself.
  { path: '/marketplace', ready: /Mini fridge/i },
  { path: '/checklist', ready: /My Checklist/i },
];

// supabase-js retries a failed request with backoff (~7s) before the app sees an
// error; that is client-wide and deliberately left alone (P2: faster offline
// detection). The contract is "an error with a retry", not "a skeleton forever".
const ERROR_WITHIN = 15_000;

const retryButton = (page: Page) => page.getByRole('button', { name: /try again|retry/i }).filter({ visible: true }).first();

for (const s of SURFACES) {
  test(`offline ${s.path}: error + retry, then recovery`, async ({ page }) => {
    const restore = await failReads(page, 'abort');
    await page.goto(s.path);
    await expect(page.getByRole('alert').filter({ visible: true }).first()).toBeVisible({ timeout: ERROR_WITHIN });
    await expect(retryButton(page)).toBeVisible();
    await restore();
    await retryButton(page).click();
    await expect(page.getByText(s.ready).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
  });
}

test('checklist hub: a failed hub read shows an error with retry, not a forever-skeleton', async ({ page }) => {
  await page.route((u) => /\/rest\/v1\/checklist_items/.test(u.pathname), (r) =>
    r.request().method() === 'GET' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"injected"}' }) : r.continue(),
  );
  await page.goto('/checklist');
  await expect(page.getByRole('alert').filter({ visible: true }).first()).toBeVisible({ timeout: ERROR_WITHIN });
  await expect(retryButton(page)).toBeVisible();
});

test('checklist hub: a failed group-lists read says so instead of showing no groups', async ({ page }) => {
  await page.route((u) => /\/rest\/v1\/ranking_(collaborations|group_members)/.test(u.pathname), (r) =>
    r.request().method() === 'GET' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"injected"}' }) : r.continue(),
  );
  await page.goto('/checklist');
  await expect(page.getByRole('alert').filter({ visible: true }).first()).toBeVisible({ timeout: ERROR_WITHIN });
  await expect(retryButton(page)).toBeVisible();
});
