import { test as setup, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.resolve(HERE, '../.audit-app/state');
fs.mkdirSync(STATE_DIR, { recursive: true });

/** Sign in through the real /auth form (also exercises the auth flow itself). */
async function signIn(page: import('@playwright/test').Page, email: string, password: string) {
  // With more than one active school, /auth redirects unauthenticated users to
  // the /select-school picker. Name the school via ?school= so we land straight
  // on the login form (exercises the real param path; the resolver persists it).
  await page.goto('/auth?school=pitt');
  // Stable id, not placeholder copy - the placeholder text is marketing
  // copy and changed once already (de-Pitt pass).
  await page.locator('#auth-email').fill(email);
  // Identifier-first flow: Continue resolves the sign-in method for the
  // email, then the password step renders (stable id, not placeholder copy).
  await page.getByRole('button', { name: /^continue$/i }).click();
  const passwordInput = page.locator('#auth-password');
  await passwordInput.waitFor({ state: 'visible', timeout: 15_000 });
  await passwordInput.fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  // The auth context redirects away from /auth once the session lands.
  await expect(page).not.toHaveURL(/\/auth(\?|$)/, { timeout: 20_000 });
}

setup('authenticate user', async ({ page }) => {
  await signIn(page, process.env.E2E_USER_EMAIL!, process.env.E2E_USER_PASSWORD!);
  await page.context().storageState({ path: path.join(STATE_DIR, 'user.json') });
});

setup('authenticate admin', async ({ page }) => {
  await signIn(page, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
  // Turn on admin "full app preview" so gated surfaces (housing/map/roommates) un-gate.
  await page.evaluate(() => localStorage.setItem('dc_admin_full_app_preview', 'true'));
  await page.context().storageState({ path: path.join(STATE_DIR, 'admin.json') });
});
