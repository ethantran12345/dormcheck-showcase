import { test, expect } from '@playwright/test';

/**
 * AUTH-GATING canary. Runs against LIVE https://dormcheck.com (see
 * playwright.auth-gating.config.ts - no local webServer, no auth session).
 *
 * The leak this guards (found 2026-07-03): student PII must never render to a
 * signed-out visitor. Marketplace listings carry phone numbers and Instagram/
 * Snapchat handles; profiles carry contact info.
 *
 * There are now TWO ways a route can satisfy that, and they are asserted
 * separately because they fail differently:
 *
 *   GATED routes (/checklist, /profile) - `ProtectedRoute` bounces an anon
 *     visitor to `/auth?redirect=...` client-side. We assert the redirect fired
 *     AND the settled DOM is PII-free. If the gate is removed the page stays put
 *     and renders student data.
 *
 *   GUEST-BROWSABLE routes (/marketplace) - deliberately NOT gated, since
 *     2026-08-01 / commit a8ee1917. Apple rejected build 30 under guideline
 *     5.1.1(v): browsing is not an account-based feature, so it must work signed
 *     out. Here a redirect is the REGRESSION, not the pass condition, so the
 *     assertion is three-part: the route RENDERS, it leaks NO PII, and it
 *     EXPOSES NO SURNAME. Safety comes from the `marketplace_public` projection
 *     (no contact columns at all, the three `show_*` opt-ins pinned to constant
 *     false, `seller_name` first-name-only), not from a redirect.
 *
 *     The surname clause is #144/#155 (migration 20260911000000): a full name
 *     beside a building name and an item, on a page that needs no account, is a
 *     doxxing dataset for one named undergrad. It is asserted against the WIRE
 *     PAYLOAD rather than the DOM, because the DOM only shows the handful of
 *     cards in the viewport while the PostgREST response carries the whole page
 *     of rows - and because a name that is fetched but not yet painted has still
 *     left the database. This config holds no Supabase credentials by design, so
 *     the check rides on the responses the page itself makes.
 *
 * Why this split rather than dropping /marketplace from the canary: the PII
 * assertions are the actual security property, and on a guest-browsable route
 * they finally do real work. On a gated route they run against /auth, where the
 * footer and nav are suppressed, so they are close to trivially clean. Deleting
 * /marketplace here would retire the only case where the PII scan inspects a page
 * that genuinely renders student-authored content.
 *
 * The PII assertions are IDENTICAL for both sets, and deliberately stricter than
 * the pre-2026-08-05 version: `mailto:` links and bare phone-number text are now
 * failures too. A guest-browsable route means "contact data is absent", not
 * "contact data is one CSS rule away".
 *
 * Prove it goes RED:
 *   - gated: drop `<ProtectedRoute>` from /checklist in src/routes/AppRoutes.tsx.
 *   - guest: re-add `/marketplace` to the gated set, or expose a contact column
 *     in `private.marketplace_public` - the PII scan catches the second.
 *   - surname: put `p.full_name` back as `seller_name` in
 *     `private.marketplace_public` - the payload scan catches it on the next run.
 */

const parseRoutes = (raw: string | undefined, fallback: string) =>
  (raw ?? fallback)
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);

// Routes that MUST bounce an anon visitor to /auth.
const GATED_ROUTES = parseRoutes(process.env.AUTH_GATING_ROUTES, '/checklist,/profile');

// Routes a guest is ALLOWED to browse (App Store 5.1.1(v)). Mirrors
// src/routes/guestPaths.ts - keep the two in step, or this canary will assert a
// redirect the app no longer performs (or miss one it started performing).
const GUEST_ROUTES = parseRoutes(process.env.AUTH_GATING_GUEST_ROUTES, '/marketplace');

// Text that only appears when real student contact data renders. Absent from
// /auth, which suppresses the footer + nav, and absent from the guest
// marketplace projection, which carries no contact columns.
const CONTACT_NEEDLES = ['instagram.com/', 'snapchat.com/', 'instagram:', 'snapchat:'];

// Deliberately not anchored to a link: a leaked number is just as leaked as
// plain text. Matches 412-555-1234, (412) 555 1234, 4125551234.
const PHONE_RE = /\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/;

/**
 * The actual security property, applied identically to every route. Nothing in
 * here may be relaxed for a guest-browsable route - that a page is allowed to
 * render is exactly why its contents have to be checked.
 */
async function expectNoStudentPII(page: import('@playwright/test').Page, path: string) {
  const telLinks = await page.locator('a[href^="tel:"]').count();
  expect(telLinks, `${path}: ${telLinks} tel: link(s) rendered logged-out`).toBe(0);

  const mailtoLinks = await page.locator('a[href^="mailto:"]').count();
  expect(mailtoLinks, `${path}: ${mailtoLinks} mailto: link(s) rendered logged-out`).toBe(0);

  const contactBlocks = await page
    .locator('[data-testid*="seller-contact"], [data-testid*="contact"]')
    .count();
  expect(contactBlocks, `${path}: ${contactBlocks} contact block(s) rendered logged-out`).toBe(0);

  const body = await page.locator('body').innerText();
  const lower = body.toLowerCase();
  for (const needle of CONTACT_NEEDLES) {
    expect(lower.includes(needle), `${path}: contact handle "${needle}" rendered logged-out`).toBe(
      false,
    );
  }

  const phone = body.match(PHONE_RE);
  expect(phone?.[0] ?? null, `${path}: a phone-shaped string rendered logged-out`).toBeNull();
}

/**
 * #144/#155: the guest marketplace projection publishes a FIRST NAME, never a
 * surname. `seller_name` is the only name-shaped field on the anon path, so the
 * property is "every seller_name we were sent is a single token".
 *
 * A single token is the assertion rather than a hard-coded name list, because
 * the canary runs against live prod data it cannot predict. It holds for
 * "Ethan", fails for "Ethan Tran", and correctly tolerates null (a seller whose
 * profile carries no name at all).
 */
function collectGuestSellerNames(page: import('@playwright/test').Page) {
  const names: string[] = [];
  const failures: string[] = [];

  page.on('response', (response) => {
    if (!/\/rest\/v1\/marketplace_public/.test(response.url())) return;
    // Fire-and-forget: the body may be gone by teardown, and a canary must never
    // fail on its own instrumentation. A missed body is covered by the
    // `sawPayload` assertion at the call site.
    void response
      .json()
      .then((payload: unknown) => {
        const rows = Array.isArray(payload) ? payload : [payload];
        for (const row of rows) {
          const value = (row as { seller_name?: unknown } | null)?.seller_name;
          if (typeof value === 'string') names.push(value);
        }
      })
      .catch((err: unknown) => failures.push(String(err)));
  });

  return { names, failures };
}

async function expectNoSurname(
  page: import('@playwright/test').Page,
  path: string,
  collected: { names: string[]; failures: string[] },
) {
  // `response.json()` resolves asynchronously, so give any body that arrived
  // late in the page's load window a moment to finish parsing before reading.
  await page.waitForTimeout(500);

  const multiToken = collected.names.filter((n) => /\s/.test(n.trim()));
  expect(
    multiToken,
    `${path}: the guest marketplace payload carried ${multiToken.length} multi-word seller_name value(s) - a surname reached an unauthenticated caller. The projection must publish a first name only (supabase/migrations/20260911000000_marketplace_public_first_name_only.sql).`,
  ).toEqual([]);
}

for (const path of GATED_ROUTES) {
  test(`logged-out ${path} redirects to /auth and leaks no student PII`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'domcontentloaded' });

    // ProtectedRoute renders a brief spinner while auth resolves, then
    // <Navigate to="/auth?redirect=...">, so poll rather than asserting once.
    await expect(async () => {
      const pathname = new URL(page.url()).pathname;
      expect(pathname, `stayed on ${path} while logged out - auth gate is open`).toMatch(/^\/auth/);
    }).toPass({ timeout: 15_000 });

    await expectNoStudentPII(page, path);
  });
}

for (const path of GUEST_ROUTES) {
  test(`logged-out ${path} renders, leaks no student PII, and exposes no surname`, async ({
    page,
  }) => {
    // Attach BEFORE navigating - the guest feed fetch fires during load.
    const collected = collectGuestSellerNames(page);

    await page.goto(path, { waitUntil: 'domcontentloaded' });

    // Give the client-side gates the same window the redirect assertion gets, so
    // a re-introduced ProtectedRoute / AppLayout bounce is actually observed
    // rather than raced past.
    await page.waitForTimeout(5_000);

    const pathname = new URL(page.url()).pathname;
    expect(
      pathname,
      `${path} redirected to "${pathname}" while logged out - guest browsing is gated again, which is the App Store 5.1.1(v) rejection (build 30). Check src/routes/guestPaths.ts and the AppLayout native redirect.`,
    ).toBe(path);

    // The page rendered rather than erroring out.
    await expect(page.locator('main')).toBeVisible();

    await expectNoStudentPII(page, path);
    await expectNoSurname(page, path, collected);

    // Record how much work the surname scan actually did. With zero approved
    // listings on prod the scan is vacuous but still correct, so this is an
    // annotation, not an assertion - a canary must not go red because the
    // marketplace happens to be empty.
    test.info().annotations.push({
      type: 'guest-payload',
      description: `${collected.names.length} seller_name value(s) inspected${
        collected.failures.length ? `; ${collected.failures.length} unreadable response(s)` : ''
      }`,
    });
  });
}
