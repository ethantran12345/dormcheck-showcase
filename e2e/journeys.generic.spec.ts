import { expect, test } from '@playwright/test';
import { Journey, expectSettled } from './lib/journey';
import {
  clickExpectingResult,
  countViewTransitions,
  expectNoStuckTransition,
  failReads,
  locate,
  primaryCandidates,
  slowReads,
} from './lib/probes';

/**
 * No-dead-end sweep, generic half (inventory §4/§5). Page-agnostic probes run
 * against every core surface as the seeded Pitt student:
 *   · every primary CTA reaches a visible terminal state (no silent buttons);
 *   · each core query has a distinct, retryable failure state when offline, and
 *     a loading state (not an empty state) on a slow network;
 *   · View Transitions survive the browser Back button (no stuck fade, no double
 *     animation).
 * The flow-specific journeys live in journeys.flows.spec.ts.
 */

const CORE = [
  { path: '/my-home', id: 'my-home', label: 'My Home', ready: /checklist|marketplace|move-in/i },
  { path: '/marketplace', id: 'marketplace', label: 'Marketplace', ready: /Mini fridge/i },
  { path: '/checklist', id: 'checklist', label: 'Checklist', ready: /My Checklist/i },
  { path: '/messages', id: 'messages', label: 'Messages', ready: /message|conversation|inbox/i },
  { path: '/profile', id: 'profile', label: 'Profile', ready: /E2E User|profile/i },
  { path: '/settings', id: 'settings', label: 'Settings', ready: /settings/i },
];

test.describe('every primary CTA reaches a terminal state', () => {
  for (const surface of CORE) {
    test(`${surface.label} CTAs`, async ({ page }) => {
      test.setTimeout(240_000);
      const j = new Journey(`cta-${surface.id}`, `${surface.label}: every primary CTA`, surface.label, 'P0', page);
      await page.goto(surface.path);
      await expectSettled(page).catch(() => {});
      const candidates = await primaryCandidates(page);
      await j.check('entry', `${candidates.length} candidate CTAs found on ${surface.path}`, async () => {
        expect(candidates.length).toBeGreaterThan(0);
      });
      for (const c of candidates) {
        await j.check('result', `${c.role} "${c.name.slice(0, 50)}"`, async () => {
          await page.goto(surface.path);
          await expectSettled(page).catch(() => {});
          const target = locate(page, c);
          await target.scrollIntoViewIfNeeded({ timeout: 3_000 });
          await clickExpectingResult(page, target);
        });
      }
      j.finish();
    });
  }
});

test.describe('core queries: offline and slow network', () => {
  for (const surface of CORE.slice(0, 4)) {
    test(`${surface.label} offline → retry, slow → loading`, async ({ page }) => {
      test.setTimeout(120_000);
      const j = new Journey(`net-${surface.id}`, `${surface.label}: offline + slow-3G`, surface.label, 'P1', page);

      const restore = await failReads(page, 'abort');
      await page.goto(surface.path);
      await page.waitForTimeout(4_000);
      const retry = page.getByRole('button', { name: /retry|try again|reload/i }).filter({ visible: true }).first();
      await j.check('errors', 'offline load shows an error with a retry action (not a spinner, not a fake empty state)', async () => {
        await expect(retry).toBeVisible({ timeout: 8_000 });
      });
      await j.check('errors', 'retry after reconnecting recovers the data', async () => {
        await restore();
        await retry.click();
        await expect(page.getByText(surface.ready).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
      }, { needs: ['offline load shows an error with a retry action (not a spinner, not a fake empty state)'] });
      await restore();

      const undoSlow = await slowReads(page, 3_000);
      await page.goto(surface.path);
      await j.check('progress', 'slow network shows a loading state within 1.5s (not an empty state)', async () => {
        await expect
          .poll(
            () =>
              page.evaluate(
                () => // .animate-skeleton is the ui/skeleton primitive's own class.
                document.querySelectorAll('[aria-busy="true"],[role="progressbar"],.animate-spin,.animate-pulse,.animate-skeleton,[data-skeleton]').length,
              ),
            { timeout: 1_500 },
          )
          .toBeGreaterThan(0);
      });
      await j.check('result', 'slow network eventually renders the data', async () => {
        await expect(page.getByText(surface.ready).filter({ visible: true }).first()).toBeVisible({ timeout: 25_000 });
      });
      await undoSlow();
      j.finish();
    });
  }
});

test('View Transitions survive browser Back', async ({ page }) => {
  test.setTimeout(120_000);
  await countViewTransitions(page);
  const j = new Journey('view-transitions-back', 'View Transitions + browser Back', 'Navigation', 'P0', page);
  await page.goto('/my-home');
  await expectSettled(page).catch(() => {});
  // Bottom nav on phones, sidebar on desktop: whichever navigation is showing the link.
  const nav = page.getByRole('navigation');
  // Housing on the phone bar opens a chooser rather than navigating, so it is
  // not a hop here; Home, Checklist and Market are.
  const hops = [/checklist/i, /market/i, /home/i];
  const visited: string[] = [new URL(page.url()).pathname];
  for (const hop of hops) {
    await j.check('entry', `bottom nav → ${hop.source}`, async () => {
      const before = await page.evaluate(() => (window as unknown as { __vt?: number }).__vt ?? 0);
      // Bottom-bar items are buttons ("Go to Checklist"); sidebar items are links.
      await nav.getByRole('link', { name: hop }).or(nav.getByRole('button', { name: hop })).filter({ visible: true }).first().click();
      await expect(page).not.toHaveURL(new RegExp(`${visited[visited.length - 1]}$`));
      await expectNoStuckTransition(page);
      const after = await page.evaluate(() => (window as unknown as { __vt?: number }).__vt ?? 0);
      expect(after - before, 'view transitions started for one navigation').toBeLessThanOrEqual(1);
      visited.push(new URL(page.url()).pathname);
    });
  }
  for (let i = visited.length - 2; i >= 0; i--) {
    await j.check('cancel', `Back → ${visited[i]}`, async () => {
      const before = await page.evaluate(() => (window as unknown as { __vt?: number }).__vt ?? 0);
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`${visited[i]}(\\?|$)`));
      await expectNoStuckTransition(page);
      await expectSettled(page);
      const after = await page.evaluate(() => (window as unknown as { __vt?: number }).__vt ?? 0);
      expect(after - before, 'view transitions started for one Back').toBeLessThanOrEqual(1);
    });
  }
  j.finish();
});
