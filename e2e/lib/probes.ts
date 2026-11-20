import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Generic terminal-state probes for the journey sweep. Page-agnostic on
 * purpose, like the layout detectors: they find the dead end, they don't
 * need to be told where it is.
 */

/** Names we never click in a sweep: they destroy data or end the session. */
// State-changing actions on SHARED seed data count too: a sweep that clicked
// "Mark as sold" on the seeded listing emptied /marketplace for every later
// journey (2026-10-12 after-run).
export const DESTRUCTIVE = /sign ?out|log ?out|delete|remove|block|report|leave|deactivate|discard|reset|clear all|unmatch|mark as sold|relist|retract|archive|hide/i;

export interface Candidate {
  role: 'button' | 'link';
  name: string;
  /** Index among all `role` elements in scope: names drift between loads ("7 minutes ago" → "2m"). */
  index: number;
}

/** Main content, plus any open sheet (mobile Settings is a dialog in a portal). */
export const SWEEP_SCOPE = 'main, [role="main"], [role="dialog"]';

/** Visible, enabled buttons and links in the page's main surface, deduped by role+name. */
export async function primaryCandidates(page: Page, scope = SWEEP_SCOPE, limit = 30): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const role of ['button', 'link'] as const) {
    const all = page.locator(scope).last().getByRole(role);
    const n = await all.count();
    for (let i = 0; i < n && out.length < limit; i++) {
      const el = all.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      if (await el.isDisabled().catch(() => true)) continue;
      // Global chrome (bottom nav, sidebar, header) is swept once, not per page.
      if (await el.evaluate((n) => !!n.closest('nav,header,[data-sidebar],aside'))) continue;
      // sr-only skip links and other 1px controls are not tap targets.
      const box = await el.boundingBox();
      if (!box || box.width < 4 || box.height < 4) continue;
      const name = ((await el.getAttribute('aria-label')) || (await el.innerText().catch(() => '')) || '').trim().replace(/\s+/g, ' ');
      if (!name || DESTRUCTIVE.test(name)) continue;
      const key = `${role}:${name.replace(/\d+/g, '#')}`;
      if (seen.has(key)) continue; // the first of a repeated control (e.g. every card's "Save") stands for all
      seen.add(key);
      out.push({ role, name, index: i });
    }
  }
  return out;
}

export function locate(page: Page, c: Candidate, scope = SWEEP_SCOPE): Locator {
  return page.locator(scope).last().getByRole(c.role).nth(c.index);
}

/**
 * Click a control and report what observably happened, or throw "silent".
 * Counts as a result: URL change, a popup/download/file chooser, a new open
 * dialog/menu/listbox/popover, an aria-expanded/pressed/checked/selected flip,
 * a toast or live-region update, or a meaningful change to the main surface's
 * text. A control that does none of these within 2.5s is a dead end.
 */
export async function clickExpectingResult(page: Page, target: Locator): Promise<string> {
  const before = await page.evaluate(() => ({
    url: location.href,
    open: document.querySelectorAll('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[data-state="open"]').length,
    text: (document.querySelector('main,[role="main"]') ?? document.body).textContent?.length ?? 0,
    live: Array.from(document.querySelectorAll('[role="status"],[aria-live],[data-sonner-toast]')).map((n) => n.textContent).join('|'),
  }));
  const state = async () =>
    target.evaluate((n) => ['aria-expanded', 'aria-pressed', 'aria-checked', 'aria-selected', 'data-state'].map((a) => n.getAttribute(a)).join(','))
      .catch(() => 'detached');
  const attrsBefore = await state();
  const side: string[] = [];
  const onPopup = () => side.push('opened a new tab/window');
  const onDownload = () => side.push('started a download');
  const onChooser = () => side.push('opened a file chooser');
  page.once('popup', onPopup);
  page.once('download', onDownload);
  page.once('filechooser', onChooser);
  try {
    await target.click({ timeout: 5_000 });
  } finally {
    // listeners removed below
  }
  let result = '';
  await expect
    .poll(
      async () => {
        if (side.length) return (result = side[0]);
        const now = await page.evaluate(() => ({
          url: location.href,
          open: document.querySelectorAll('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[data-state="open"]').length,
          text: (document.querySelector('main,[role="main"]') ?? document.body).textContent?.length ?? 0,
          live: Array.from(document.querySelectorAll('[role="status"],[aria-live],[data-sonner-toast]')).map((n) => n.textContent).join('|'),
        }));
        const focusMoved = await page.evaluate(() => {
          const a = document.activeElement as HTMLElement | null;
          return !!a && /^(INPUT|TEXTAREA)$/.test(a.tagName) ? 'focus' : '';
        });
        if (now.url !== before.url) return (result = `navigated to ${new URL(now.url).pathname}${new URL(now.url).search}`);
        if (now.open > before.open) return (result = 'opened a dialog/menu');
        if (now.live !== before.live && now.live.trim()) return (result = `announced "${now.live.slice(0, 60)}"`);
        const a = await state();
        if (a !== attrsBefore) return (result = `toggled state (${a})`);
        if (Math.abs(now.text - before.text) > 15) return (result = 'changed the page content');
        if (focusMoved && side.length === 0 && attrsBefore !== 'detached') {
          const editing = await target.evaluate((n) => !n.contains(document.activeElement)).catch(() => true);
          if (editing) return (result = 'moved focus into a text field');
        }
        return '';
      },
      { timeout: 2_500, intervals: [150, 250, 500] },
    )
    .not.toBe('')
    .catch(async () => {
      const href = await target.getAttribute('href').catch(() => null);
      const here = new URL(page.url());
      if (href && new URL(href, here).pathname === here.pathname) {
        throw new Error(`silent: links to the page you are already on (${href})`);
      }
      throw new Error('silent: no navigation, dialog, toast, state change or content change within 2.5s');
    });
  page.off('popup', onPopup);
  page.off('download', onDownload);
  page.off('filechooser', onChooser);
  return result;
}

/** Fail all Supabase REST/storage reads (GET) as if offline; returns an undo. */
export async function failReads(page: Page, mode: 'abort' | '500' = 'abort') {
  const matcher = (url: URL) => /\/rest\/v1\/|\/storage\/v1\//.test(url.pathname);
  await page.route(matcher, async (route) => {
    if (route.request().method() !== 'GET' && route.request().method() !== 'POST') return route.continue();
    // RPC reads are POSTs to /rest/v1/rpc; writes elsewhere are left alone.
    if (route.request().method() === 'POST' && !route.request().url().includes('/rpc/')) return route.continue();
    if (mode === 'abort') return route.abort('internetdisconnected');
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"injected failure"}' });
  });
  return () => page.unroute(matcher);
}

/** Delay every Supabase read by `ms` (a slow-3G stand-in that keeps the run deterministic). */
export async function slowReads(page: Page, ms = 3_000) {
  const matcher = (url: URL) => /\/rest\/v1\/|\/storage\/v1\//.test(url.pathname);
  await page.route(matcher, async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue().catch(() => {});
  });
  return () => page.unroute(matcher);
}

/** Count document.startViewTransition calls (installed before navigation). */
export async function countViewTransitions(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __vt?: number };
    w.__vt = 0;
    const orig = document.startViewTransition?.bind(document);
    if (orig) {
      (document as unknown as { startViewTransition: typeof orig }).startViewTransition = ((arg: never) => {
        w.__vt = (w.__vt ?? 0) + 1;
        return orig(arg);
      }) as typeof orig;
    }
  });
}

/** No finite animation still running and nothing left faded out over the app. */
export async function expectNoStuckTransition(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const running = document.getAnimations().filter((a) => {
            const end = Number(a.effect?.getComputedTiming().endTime);
            return Number.isFinite(end) && a.playState === 'running';
          }).length;
          const root = document.getElementById('root');
          let faded = false;
          for (let n: Element | null = root?.querySelector('main') ?? root; n; n = n.parentElement) {
            if (Number(getComputedStyle(n).opacity) < 0.99) faded = true;
          }
          return running === 0 && !faded ? 'settled' : `running=${running} faded=${faded}`;
        }),
      { timeout: 4_000, message: 'a transition never finished (stuck fade or animation)' },
    )
    .toBe('settled');
}
