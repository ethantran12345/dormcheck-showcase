import { lazy } from "react";
import { Navigate, Route } from "react-router";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { RequireAdmin, RequireAdminSilo, RequireSuperAdmin } from "@/components/RequireRole";

const AdminLayout = lazy(() => import("@/components/admin/AdminLayout"));
const AdminDashboardPage = lazy(() => import("@/pages/admin/Dashboard"));
const AdminUniversitiesPage = lazy(() => import("@/pages/admin/UniversitiesPage"));
const AdminDormsListPage = lazy(() => import("@/pages/admin/DormsListPage"));
const AdminDormEditPage = lazy(() => import("@/pages/admin/DormEditPage"));
const AdminReportsPage = lazy(() => import("@/pages/admin/ReportsPage"));
const AdminPlatformPage = lazy(() => import("@/pages/admin/PlatformPage"));
const AdminTeamPage = lazy(() => import("@/pages/admin/TeamPage"));
const AdminActivityPage = lazy(() => import("@/pages/admin/ActivityPage"));
const AdminPilotReportPage = lazy(() => import("@/pages/admin/PilotReportPage"));
const AdminBroadcastPage = lazy(() => import("@/pages/admin/BroadcastPage"));
const AdminAdsReviewPage = lazy(() => import("@/pages/admin/AdsReviewPage"));

/**
 * Admin / Internal zone routes. Web-only - the native guard does not mount
 * these (see `App.tsx`). The console is per-university: a superadmin first
 * picks a school on /admin/universities (standalone, outside the sidebar
 * shell), then every surface inside `AdminLayout` scopes to that silo
 * (`RequireAdminSilo` bounces silo-less superadmins back to the picker). A
 * university_admin's silo is always their own school - no picker for them,
 * and `master_housing` tenant RLS plus the clamped admin RPC params
 * (`p_university_id`, honored for superadmins only) are the real enforcement.
 * Dorm management is any-admin (RLS-scoped); only the platform surface stays
 * `RequireSuperAdmin`.
 */
export function AdminRoutes() {
  return (
<>
      <Route
        path="/admin/universities"
        element={
          <ProtectedRoute>
            <RequireSuperAdmin>
              <AdminUniversitiesPage />
            </RequireSuperAdmin>
          </ProtectedRoute>
        }
      />
      <Route
        element={
          <ProtectedRoute>
            <RequireAdmin>
              <RequireAdminSilo>
                <AdminLayout />
              </RequireAdminSilo>
            </RequireAdmin>
          </ProtectedRoute>
        }
      >
        <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
        <Route path="/admin/reports" element={<RequireSuperAdmin><AdminReportsPage /></RequireSuperAdmin>} />
        <Route path="/admin/team" element={<AdminTeamPage />} />
        <Route path="/admin/activity" element={<AdminActivityPage />} />
        <Route path="/admin/report" element={<AdminPilotReportPage />} />
        <Route path="/admin/dorms" element={<AdminDormsListPage />} />
        <Route path="/admin/dorms/:id" element={<AdminDormEditPage />} />
        <Route
          path="/admin/platform"
          element={<RequireSuperAdmin><AdminPlatformPage /></RequireSuperAdmin>}
        />
        <Route
          path="/admin/ads"
          element={<RequireSuperAdmin><AdminAdsReviewPage /></RequireSuperAdmin>}
        />
        {/* Any-admin: university_admins broadcast to their own school; the
            per-audience scope is enforced server-side in api/admin/broadcast.ts. */}
        <Route path="/admin/broadcast" element={<AdminBroadcastPage />} />
      </Route>
    </>
  );
}
