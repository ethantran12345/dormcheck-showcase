import { test, expect } from '@playwright/test';

/**
 * PROD blank-page canary. Runs against LIVE https://dormcheck.com (see
 * playwright.prod.config.ts - no local webServer). The point is to catch the
 * "successful 200 but empty app" outage: the static index.html shell serves fine
 * while the React app never hydrates (e.g. a VITE_ env var missing on Vercel).
 * So we assert on REAL RENDERED CONTENT inside #root, not on the HTTP status.
 */
test('prod home page hydrates (not a blank shell)', async ({ page }) => {
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });

  // A 2xx/3xx is necessary but NOT sufficient - the blank-prod bug is a healthy
  // 200 with an empty #root. We check status only to fail fast on a hard outage.
  expect(response, 'no response from prod').toBeTruthy();
  expect(response!.status(), `prod returned HTTP ${response!.status()}`).toBeLessThan(400);

  // Right site (sanity that DNS/routing didn't send us somewhere else). The title
  // lives in the static shell, so this alone does NOT prove hydration.
  await expect(page).toHaveTitle(/DormCheck/i);

  // The real signal: #root must fill with substantial rendered content. On a blank
  // deploy #root stays empty (~0 chars). Poll so we tolerate normal hydration delay
  // and a brief loading state, but a genuinely blank app never crosses the bar.
  const root = page.locator('#root');
  await expect(async () => {
    const text = (await root.innerText()).trim();
    expect(text.length, `#root rendered only ${text.length} chars - app did not hydrate`).toBeGreaterThan(150);
  }).toPass({ timeout: 30_000 });

  // And it must be an actual interactive app, not just a wall of text: at least one
  // link or button rendered by React inside #root.
  const interactive = await page.locator('#root a, #root button').count();
  expect(interactive, 'no links/buttons rendered inside #root - app did not hydrate').toBeGreaterThan(0);
});
