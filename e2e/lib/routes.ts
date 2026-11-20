/**
 * Catalog of every route in src/App.tsx, annotated with how each persona should
 * see it. The crawl specs iterate this list and the audit helper asserts the
 * persona-appropriate outcome.
 */

export type Persona = 'anon' | 'user' | 'admin';

/** What we expect when a given persona visits a route. */
export type Expectation =
  | 'render' // the real page renders
  | 'redirect-auth' // protected route bounces an anon visitor to /auth
  | 'coming-soon' // feature-gated route shows the ComingSoon placeholder
  | 'any'; // layout-only route: measured, but its persona outcome is not asserted

export interface RouteSpec {
  /** URL path to visit. */
  path: string;
  /** Stable id used for screenshot/log filenames. */
  id: string;
  /** Human label for the report. */
  label: string;
  /** Per-persona expected outcome. */
  expect: Record<Persona, Expectation>;
  /** Routes that legitimately render a "not found" empty state with bogus params. */
  allowNotFound?: boolean;
}

const R = (
  path: string,
  id: string,
  label: string,
  expect: Record<Persona, Expectation>,
  allowNotFound = false,
): RouteSpec => ({ path, id, label, expect, allowNotFound });

// Helpers for the common expectation shapes.
const PUBLIC: Record<Persona, Expectation> = { anon: 'render', user: 'render', admin: 'render' };
const PROTECTED: Record<Persona, Expectation> = {
  anon: 'redirect-auth',
  user: 'render',
  admin: 'render',
};
// Feature-gated: auth comes first (c114602 wraps gated routes in ProtectedRoute),
// so anon is bounced to /auth; a signed-in normal user gets ComingSoon; admin
// (full-app-preview) gets the real page.
const GATED: Record<Persona, Expectation> = {
  anon: 'redirect-auth',
  user: 'coming-soon',
  admin: 'render',
};
// Housing browse is OPEN to a signed-in Pitt student and has been since
// 2026-08-05: `src/config/universities.ts` gives Pitt
// `features: { showHousing: true }` — a per-surface override on top of
// `limitedSurfaces: true`, because dorm reviews are spec'd onto the dorm detail
// portal and that portal sits behind `showHousing`. So /campus, /housing and
// /gallery render for `user` exactly as they do for `admin`; only anon is
// bounced to /auth. The 2026-08-16 audit reported all three as P1 "expected
// coming-soon but got render": the table was describing the world before that
// override, not a regression. Do NOT re-gate the pages to make the table right.
const HOUSING_OPEN: Record<Persona, Expectation> = {
  anon: 'redirect-auth',
  user: 'render',
  admin: 'render',
};

export const ROUTES: RouteSpec[] = [
  // --- Public / Phase-1 ---
  R('/', 'landing', 'Landing', PUBLIC),
  R('/auth', 'auth', 'Auth / sign-in', { anon: 'render', user: 'render', admin: 'render' }),
  // /checklist and /profile require sign-in since c114602 ("require sign-in for
  // all student-data routes"). /marketplace left that group on 2026-08-01: guests
  // browse approved listings via the marketplace_public view (App Store guideline
  // 5.1.1(v) fix) — write actions still prompt for sign-in.
  R('/checklist', 'checklist', 'Move-in checklist', PROTECTED),
  R('/marketplace', 'marketplace', 'Marketplace', PUBLIC),
  R('/profile', 'profile', 'Profile (self)', PROTECTED),
  R('/privacy', 'privacy', 'Privacy', PUBLIC),
  R('/terms', 'terms', 'Terms', PUBLIC),
  R('/ads', 'ads', 'Ads policy', PUBLIC),
  R('/moderation', 'moderation', 'Moderation policy', PUBLIC),
  R('/guide', 'guide-redirect', 'Guide → checklist redirect', PROTECTED),
  R('/this-route-does-not-exist', 'not-found', '404 catch-all', PUBLIC, true),

  // --- Protected (need a session) ---
  R('/my-home', 'my-home', 'My Home dashboard', PROTECTED),
  R('/onboarding/intro', 'onboarding-intro', 'Onboarding intro', PROTECTED),
  R('/profile/edit', 'profile-edit', 'Edit profile', PROTECTED),
  R('/profile/blocked', 'profile-blocked', 'Blocked accounts', PROTECTED),
  R('/marketplace/my-items', 'marketplace-my-items', 'My marketplace items', PROTECTED),
  // The sublease map. PROTECTED, not GATED: it rides `showBrowseSublease`, which
  // derives from the SHOW_POST_SUBLEASE launch constant (true) and is deliberately
  // absent from OVERRIDABLE_SURFACES — a school can close its own POSTING, never
  // anyone's reading. So a signed-in student at any tenant gets the real page,
  // exactly as an admin does. The one gate that still closes it is the native
  // clamp in resolveFeatureFlags, which this web crawl never exercises.
  R('/subleases', 'subleases', 'Sublease map', PROTECTED),
  R('/messages', 'messages', 'Messages / DMs', PROTECTED),
  // Admin sub-routes. ProtectedRoute only checks for *a* session (not is_admin),
  // so a normal user reaching these exercises AdminPanel's own gating - worth crawling.
  R('/admin', 'admin', 'Admin panel', PROTECTED),
  R('/admin/dashboard', 'admin-dashboard', 'Admin dashboard', PROTECTED),
  R('/admin/dorms', 'admin-dorms', 'Admin dorms list', PROTECTED),
  R('/admin/reports', 'admin-reports', 'Admin reports', PROTECTED),

  // --- Feature-gated (ComingSoon unless admin full-app-preview) ---
  R('/campus', 'campus', 'Campus / housing explore', HOUSING_OPEN),
  R('/map', 'map', 'Campus map', GATED),
  R('/housing', 'housing', 'Housing explore (legacy)', HOUSING_OPEN),
  R('/gallery', 'gallery', 'Room gallery', HOUSING_OPEN),
  R('/roommates', 'roommates', 'Roommates', GATED),
  R('/roommates/liked', 'roommates-liked', 'Roommates - liked', GATED),
  R('/roommates/saved-posts', 'roommates-saved', 'Roommates - saved posts', GATED),
  // Gated dynamic routes with bogus params: admin should render a graceful not-found,
  // never a hard crash.
  R('/campus/this-dorm-does-not-exist', 'campus-detail', 'Dorm detail (bogus slug)', HOUSING_OPEN, true),
  R('/housing/this-dorm-does-not-exist', 'housing-detail', 'Housing detail (bogus slug)', HOUSING_OPEN, true),
  R('/rankings/invite/BOGUSCODE', 'ranking-invite', 'Ranking invite (bogus code)', GATED, true),
];

/** Routes to crawl for a given persona (all of them - expectation drives the assertion). */
export function routesFor(_persona: Persona): RouteSpec[] {
  return ROUTES;
}

/**
 * A state to open after the page settles, for the layout crawl. Sheets and
 * palettes are where "taller than the viewport, no scroll" lives, and a plain
 * page visit never opens one.
 */
export type LayoutState = 'palette' | 'shortcuts' | 'listing-detail';

export interface LayoutRouteSpec extends RouteSpec {
  state?: LayoutState;
  /** Only meaningful at desktop widths (e.g. the "?" sheet is desktop-pointer only). */
  desktopOnly?: boolean;
}

const ANY: Record<Persona, Expectation> = { anon: 'any', user: 'any', admin: 'any' };
const L = (path: string, id: string, label: string, extra: Partial<LayoutRouteSpec> = {}): LayoutRouteSpec => ({
  path,
  id,
  label,
  expect: ANY,
  allowNotFound: true,
  ...extra,
});

/**
 * Everything the layout crawl (AUDIT_LAYOUT=1) visits: the classic list, plus
 * the student-facing routes it never covered, the deep links that open a sheet,
 * and long-content detail pages from e2e/fixtures/long-content.json. Persona
 * outcomes for the additions are not asserted ('any'): this pass measures what
 * renders, the classic crawl owns the gate table.
 */
export const LAYOUT_ROUTES: LayoutRouteSpec[] = [
  ...ROUTES,
  L('/settings', 'settings', 'Settings'),
  L('/notifications', 'notifications', 'Notifications'),
  L('/marketplace/create', 'marketplace-create', 'Marketplace: post an item'),
  L('/marketplace/edit/a0000000-0000-4000-8000-000000000001', 'marketplace-edit', 'Marketplace: edit own listing'),
  L('/community', 'community', 'Community'),
  L('/schedule', 'schedule', 'Schedule'),
  L('/shop', 'shop', 'Shop essentials'),
  L('/logistics', 'logistics', 'Logistics'),
  L('/campus-live', 'campus-live', 'Campus live'),
  L('/my-home/dorm', 'my-home-dorm', 'My Home: dorm hub'),
  L('/account', 'account', 'Account'),
  L('/feedback', 'feedback', 'Feedback'),
  L('/subleases/create', 'subleases-create', 'Sublease: post'),
  L('/select-school', 'select-school', 'Select school'),
  L('/delete-account', 'delete-account', 'Delete account'),
  L('/licenses', 'licenses', 'Licenses'),
  L('/about', 'about', 'About'),
  L('/for-students', 'for-students', 'For students'),
  L('/contact', 'contact', 'Contact'),
  // Long-content detail page: the 40-char fixture building.
  L('/campus/layout-fixture-residence-hall-north-wing', 'campus-long-dorm', 'Dorm detail (40-char name)'),
  // Deep links and open states.
  L('/checklist?add=1', 'checklist-add', 'Checklist: ?add=1 sheet'),
  L('/messages?compose=1', 'messages-compose', 'Messages: ?compose=1'),
  L('/marketplace', 'marketplace-detail', 'Marketplace: long listing detail', { state: 'listing-detail' }),
  L('/my-home', 'palette', 'Command palette (⌘K)', { state: 'palette' }),
  L('/my-home', 'shortcuts', 'Shortcuts sheet (?)', { state: 'shortcuts', desktopOnly: true }),
];
