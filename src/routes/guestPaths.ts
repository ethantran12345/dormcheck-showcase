/**
 * App-zone paths a signed-out visitor may browse.
 *
 * App Store guideline 5.1.1(v) forbids requiring an account for features that
 * are not account-based, and the Student Market feed is one of those. Dropping
 * the `ProtectedRoute` in `AppRoutes` is only half the fix: on the native shell
 * `AppLayout` (`src/App.tsx`) redirects every logged-out route to `/auth`, so a
 * guest-browsable path must be exempted here too — otherwise the change is
 * invisible on iOS, which is the only surface Apple reviews.
 *
 * Exact matches only, deliberately. `/marketplace` is browsable; its
 * account-based children (`/marketplace/create`, `/marketplace/my-items`,
 * `/marketplace/edit/:id`) are not, and a prefix match would let them through.
 * Listing detail needs no entry: it opens as a modal on `/marketplace` itself
 * via `?listing=<id>`, and query strings are not part of `pathname`.
 *
 * Legal pages have their own list (`./legalPaths`) — they are exempt for a
 * different reason (Apple requires them reachable from the sign-in screen).
 */
export const GUEST_BROWSABLE_PATHS = ["/marketplace"] as const;

export function isGuestBrowsablePath(pathname: string): boolean {
  return (GUEST_BROWSABLE_PATHS as readonly string[]).includes(pathname);
}
