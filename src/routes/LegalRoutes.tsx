import { Route } from "react-router";
import Privacy from "@/pages/marketing/Privacy";
import Terms from "@/pages/marketing/Terms";
import Moderation from "@/pages/marketing/Moderation";
import Licenses from "@/pages/marketing/Licenses";
import DeleteAccount from "@/pages/marketing/DeleteAccount";

/**
 * Shared legal routes (`/privacy`, `/terms`, `/moderation`, `/licenses`).
 * Unlike the rest of the Marketing zone (web-only), these mount on web AND
 * native so they never resolve to NotFound in the native app and stay reachable
 * from the sign-in, profile, and Settings > Support & legal screens. The
 * matching path list + guard live in `./legalPaths`.
 */
export function LegalRoutes() {
  return (
    <>
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/moderation" element={<Moderation />} />
      <Route path="/licenses" element={<Licenses />} />
      <Route path="/delete-account" element={<DeleteAccount />} />
    </>
  );
}
