import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the AUTH-GATING canary (prod-watch.yml).
 *
 * Deliberately separate from playwright.config.ts (the local e2e audit) and mirrors
 * playwright.prod.config.ts: NO webServer and NO auth session - it drives a real
 * headless Chromium against LIVE prod (https://dormcheck.com) as a logged-out
 * visitor and asserts the student-data routes redirect to /auth and render no PII.
 *
 * Retries absorb network flake (a transient blip shouldn't page you); a real leak
 * fails all attempts. Only e2e/auth-gating-canary.spec.ts runs here; the audit
 * config's testMatch never picks it up, and this config never touches Supabase.
 */
const BASE_URL = process.env.AUTH_GATING_URL ?? 'https://dormcheck.com';

export default defineConfig({
  testDir: './e2e',
  testMatch: /auth-gating-canary\.spec\.ts/,
  outputDir: './test-results-auth-gating',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 2,
  workers: 1,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 900 },
    ...devices['Desktop Chrome'],
  },
});
