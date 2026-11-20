import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the PROD blank-page canary (prod-watch.yml).
 *
 * Deliberately separate from playwright.config.ts (the local e2e audit): this one
 * has NO webServer - it drives a real headless Chromium against LIVE prod
 * (https://dormcheck.com) and asserts the SPA actually hydrates. The blank-prod
 * failure mode is a successful HTTP 200 serving the static index.html shell with an
 * empty #root (e.g. a VITE_ env var missing/misnamed on Vercel at build time), so a
 * status check or a raw-HTML grep can't see it - only executing the page can.
 *
 * Retries absorb network flake (a transient blip shouldn't page you); a real outage
 * fails all attempts. Only e2e/prod-smoke.spec.ts runs here; the audit config's
 * testMatch patterns never pick it up, and this config never touches Supabase.
 */
const BASE_URL = process.env.PROD_SMOKE_URL ?? 'https://dormcheck.com';

export default defineConfig({
  testDir: './e2e',
  testMatch: /prod-smoke\.spec\.ts/,
  outputDir: './test-results-prod',
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
