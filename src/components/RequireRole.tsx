import { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { useAdminUniversitySilo } from '@/contexts/AdminUniversityContext';

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

/**
 * Central role gates for the admin zone. Wrap inside ProtectedRoute (which
 * handles the not-signed-in redirect); these wait for the profile role fetch,
 * then redirect non-qualifying users home. Client-side UX only - real
 * enforcement is RLS + the admin-metrics edge function role check.
 *
 * The gates read the EFFECTIVE role so a superadmin's "view as" POV behaves
 * realistically (Student POV bounces from /admin, University-admin POV
 * bounces from /admin/platform and the picker). The ViewAsBanner (driven by
 * the REAL role) is always available to exit the POV.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { profileLoaded } = useAuth();
  const { effectiveIsAdmin } = useAdminUniversitySilo();
  if (!profileLoaded) return <Spinner />;
  if (!effectiveIsAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function RequireSuperAdmin({ children }: { children: ReactNode }) {
  const { profileLoaded } = useAuth();
  const { effectiveIsSuperAdmin } = useAdminUniversitySilo();
  if (!profileLoaded) return <Spinner />;
  if (!effectiveIsSuperAdmin) return <Navigate to="/admin" replace />;
  return <>{children}</>;
}

/**
 * University-silo gate for the admin console shell: a superadmin must pick a
 * school (/admin/universities) before entering any silo-scoped surface. A
 * university_admin's silo is always their own school, so they pass straight
 * through. The profileLoaded wait prevents a redirect flash before the role
 * resolves.
 */
export function RequireAdminSilo({ children }: { children: ReactNode }) {
  const { isSuperAdmin, profileLoaded } = useAuth();
  const { siloUniversityId } = useAdminUniversitySilo();
  if (!profileLoaded) return <Spinner />;
  if (isSuperAdmin && !siloUniversityId) return <Navigate to="/admin/universities" replace />;
  return <>{children}</>;
}
