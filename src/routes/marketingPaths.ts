/**
 * Public marketing paths (web-only zone). These render marketing chrome
 * (`MarketingTopNav` + `MarketingFooter`) regardless of auth state - a logged-in
 * user who lands on `/` or another marketing page sees the marketing shell, NOT
 * the app sidebar. `LayoutWrapper` (`src/App.tsx`) uses `isMarketingPath()` to
 * pick chrome, so the app shell (`AppSidebar`) never overlays a marketing page.
 * Keep this list in sync with the routes in `MarketingRoutes`
 * (`src/routes/MarketingRoutes.tsx`).
 */
export const MARKETING_PATHS = [
  "/",
  "/features",
  "/how-it-works",
  "/for-students",
  "/for-universities",
  "/partners",
  "/feedback",
  "/about",
  "/ads",
  "/moderation",
] as const;

export function isMarketingPath(pathname: string): boolean {
  return (MARKETING_PATHS as readonly string[]).includes(pathname);
}
