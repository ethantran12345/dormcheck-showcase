import { test, expect, type ConsoleMessage } from '@playwright/test';

/**
 * Regression for the ChecklistExploreTab infinite render loop.
 *
 * Before the fix (unstable `products = []` default + a picks-sync effect that
 * re-emitted a fresh array each run), loading /checklist as a signed-in user
 * spammed React's "Maximum update depth exceeded" warning and eventually threw.
 * This test fails on the pre-fix code and passes after.
 *
 * Runs under the `user` project (seeded student session) - see playwright.config.ts.
 */
test('checklist mounts without a render loop (Maximum update depth)', async ({ page }) => {
  const loopErrors: string[] = [];
  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() === 'error' && /Maximum update depth exceeded/i.test(msg.text())) {
      loopErrors.push(msg.text());
    }
  };
  const pageErrors: string[] = [];
  page.on('console', onConsole);
  page.on('pageerror', (e) => {
    if (/Maximum update depth exceeded/i.test(e.message)) pageErrors.push(e.message);
  });

  await page.goto('/checklist');
  await page.waitForLoadState('networkidle').catch(() => {});
  // Give effects time to settle (or to blow up, pre-fix).
  await page.waitForTimeout(1500);

  // The checklist heading should be present and the app not unmounted.
  await expect(page.locator('#root')).not.toBeEmpty();

  expect(
    [...loopErrors, ...pageErrors],
    `ChecklistExploreTab triggered a render loop:\n${[...loopErrors, ...pageErrors].slice(0, 3).join('\n')}`,
  ).toEqual([]);
});
