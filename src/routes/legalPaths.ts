/**
 * Legal paths that are reachable in-app on BOTH web and native. Apple requires
 * the privacy policy and terms of service to be viewable inside the app - incl.
 * from the signed-out sign-in screen - so these are exempt from the native
 * "logged-out → /auth" guard in `AppLayout` (see `src/App.tsx`). Keep this list
 * in sync with the routes in `LegalRoutes` (`src/routes/LegalRoutes.tsx`).
 */
export const LEGAL_PATHS = ["/privacy", "/terms", "/moderation", "/licenses", "/delete-account"] as const;

export function isLegalPath(pathname: string): boolean {
  return (LEGAL_PATHS as readonly string[]).includes(pathname);
}
