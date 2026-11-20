import { Route, Navigate } from "react-router";
import { Capacitor } from "@capacitor/core";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { HAD_PERSISTED_SESSION_AT_BOOT } from "@/lib/sessionHint";
import LandingPage from "@/pages/marketing/LandingPage";
import Ads from "@/pages/marketing/Ads";
import ForStudents from "@/pages/marketing/ForStudents";
import ForUniversities from "@/pages/marketing/ForUniversities";
import Partners from "@/pages/marketing/Partners";
import Contact from "@/pages/marketing/Contact";
import Feedback from "@/pages/marketing/Feedback";
import About from "@/pages/marketing/About";
import WaitlistPage from "@/pages/marketing/WaitlistPage";

/**
 * `/` handler. Native redirects to `/my-home` (signed in) or `/auth` (signed
 * out). Web sends signed-in users straight into the app at `/my-home`; only
 * signed-out visitors see the marketing landing. Exported separately so the
 * native guard can mount `/` without mounting the rest of the marketing zone.
 */
export function LandingRoute() {
  const { user, isLoading } = useAuth();
  const isNative = Capacitor.isNativePlatform();

  if (isNative) {
    if (isLoading) {
      return (
        <div className="flex min-h-[60vh] flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      );
    }
    return <Navigate to={user ? "/my-home" : "/auth"} replace />;
  }

  // Queue item 8d. The `isLoading` window used to paint a `min-h-[60vh]` spinner,
  // which is the whole of `/`'s remaining CLS. `MarketingFooter` is rendered by
  // `LayoutWrapper` *below* this outlet, so a 60vh page put the footer in the
  // middle of the viewport (measured: y 540, height 360 at 1280x900); when the
  // real tree replaced the spinner the footer was pushed far below the fold and
  // the shift scored 0.3953 on its own. The signed-in case is the same defect
  // seen from the other side: `/` is a marketing path, so `isMarketingChrome`
  // stays true even once `layoutAuthed` flips, and the marketing-shaped frame was
  // painted and then replaced across the client-side redirect to `/my-home`
  // (the `dx 220` contributor on the redirect routes).
  //
  // Both disappear if this route never paints a placeholder it will not keep. The
  // boot-time session hint already tells us, synchronously, which of the two
  // outcomes is coming — so commit to it on frame one instead of guessing with a
  // spinner. This is consulted ONLY while auth is still resolving: it is a
  // boot-time constant, so after sign-out `isLoading` is false and the real
  // `user` below decides. As everywhere else, the hint is layout/routing only —
  // `/my-home` still gates access on the real session and bounces a stale hint.
  if (isLoading) {
    return HAD_PERSISTED_SESSION_AT_BOOT ? <Navigate to="/my-home" replace /> : <LandingPage />;
  }
  if (user) {
    return <Navigate to="/my-home" replace />;
  }
  return <LandingPage />;
}

/**
 * Public / Marketing zone routes. Web-only - the native guard does not mount
 * these (see `App.tsx`). The legal pages (`/privacy`, `/terms`) are NOT here:
 * they live in `LegalRoutes` and mount on web + native.
 */
export function MarketingRoutes() {
  return (
    <>
      <Route path="/" element={<LandingRoute />} />
      {/* Consolidation 2026-07-12: /features folds into /for-students; the
          lifecycle walkthrough lives only on the homepage (#how). */}
      <Route path="/features" element={<Navigate to="/for-students" replace />} />
      <Route path="/how-it-works" element={<Navigate to="/#how" replace />} />
      <Route path="/for-students" element={<ForStudents />} />
      <Route path="/for-universities" element={<ForUniversities />} />
      <Route path="/partners" element={<Partners />} />
      <Route path="/contact" element={<Contact />} />
      <Route path="/feedback" element={<Feedback />} />
      <Route path="/about" element={<About />} />
      {/* /dorms is deliberately absent (2026-08-16). The page promised real room
          setups but its only CTA returned visitors home, so it was deleted. Old
          links are preserved by a 308 in `vercel.json` -> /campus, NOT by a route
          here: an in-app <Navigate> would boot the SPA at a path that is not in
          MARKETING_PATHS and then hand off to an app route, which is the
          one-frame marketing->app chrome swap already fixed on `/`. The edge
          redirect means the browser never mounts the SPA at /dorms at all, so
          the anonymous case (which `layoutAuthed` cannot distinguish) is covered
          too. On native and in local dev it falls through to the 404 catch-all. */}
      <Route path="/ads" element={<Ads />} />
      {/* /moderation moved to LegalRoutes (2026-07-13) so it also resolves in
          the native app - it's linked from Settings > Support & legal. */}
      <Route path="/waitlist" element={<WaitlistPage />} />
    </>
  );
}
