import { lazy } from "react";
import { Route } from "react-router";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const AdvertiserPortalPage = lazy(() => import("@/pages/advertiser/AdvertiserPortalPage"));

/**
 * Advertiser zone (P1.10, web-only - the native guard does not mount these).
 * Accounts are invite-gated (advertiser_invitations); the page itself bounces
 * non-advertiser users. Chrome-less like /admin: LayoutWrapper opts /advertise
 * out of the student app shell.
 */
export function AdvertiserRoutes() {
  return (
    <Route
      path="/advertise"
      element={
        <ProtectedRoute>
          <AdvertiserPortalPage />
        </ProtectedRoute>
      }
    />
  );
}
