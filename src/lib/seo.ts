/**
 * Per-route document title + canonical URL for the PUBLIC (indexable) surface.
 *
 * Before this, every route reported the one static `<title>` in `index.html`,
 * and nothing emitted a canonical — so `/about`, `/partners` and `/privacy` were
 * indistinguishable to a crawler, and `/marketplace?tab=buy-sell&utm_source=…`
 * looked like a different page from `/marketplace`.
 *
 * React 19 hoists `<title>` and `<link rel="canonical">` rendered anywhere in
 * the tree into `<head>` natively, so this needs no dependency (no react-helmet).
 * Measured behaviour on React 19.2 (see `seo.test.ts`): the hoisted `<title>` is
 * inserted BEFORE the static one from `index.html`, and `document.title` is the
 * first title in tree order — so the route title wins while the static tag stays
 * as the pre-hydration fallback. Unmounting restores it.
 *
 * SCOPE — public routes only. Auth-gated app routes (`/messages`, `/settings`,
 * `/campus`, …) are behind `ProtectedRoute`, are not indexable, and deliberately
 * get nothing here.
 *
 * NOT handled here, on purpose: `og:*`. This is a client-rendered SPA with no
 * prerender, and social scrapers (Slack, iMessage, Facebook, LinkedIn) do not
 * execute JS — they only ever see the static tags in `index.html`. A per-route
 * `og:title` would be dead markup. Per-route sharing previews need prerendering
 * or an edge handler; see `docs/handoffs/lane-seo-meta.md`.
 */

/** Production origin. Canonicals always point at prod, so a Vercel preview
 *  deploy or a local dev server never canonicalises to its own hostname. */
export const SITE_ORIGIN = "https://dormcheck.com";

export const SITE_NAME = "DormCheck";

/** The `index.html` fallback, and the title of `/`. Keep in sync with the
 *  static `<title>` + `og:title` in `index.html`. */
export const DEFAULT_TITLE = "DormCheck | The verified student hub for move-in";

/** `Dorm Database` -> `Dorm Database | DormCheck`. */
export function pageTitle(label: string): string {
  return `${label} | ${SITE_NAME}`;
}

/**
 * Self-referencing canonical for `pathname`.
 *
 * Query string and hash are stripped — that is the whole point: tracking params
 * (`?utm_source=…`), UI state (`/marketplace?tab=buy-sell`) and modal deep links
 * (`/marketplace?listing=<id>`, which is a modal ON `/marketplace`, not its own
 * page) must all collapse onto one canonical URL. A trailing slash is dropped so
 * `/about/` and `/about` agree; `/` keeps its slash.
 */
export function canonicalUrl(pathname: string): string {
  // Defensive: accept a full href or a location-ish string, not just a pathname.
  let path = pathname.split("#")[0].split("?")[0];
  if (!path.startsWith("/")) path = `/${path}`;
  // Collapse repeated slashes, then drop the trailing one (except at the root).
  path = path.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return `${SITE_ORIGIN}${path}`;
}
