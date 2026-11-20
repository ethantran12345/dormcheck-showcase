import { createContext, useContext, useState, ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { logAdminAction } from '@/lib/adminAudit';

/**
 * Admin console university silo + "view as" POV.
 *
 * Silo: superadmins pick ONE school on /admin/universities and every admin
 * surface then scopes to it (queries pass it as a filter / clamped RPC param).
 * A university_admin's silo is always their own profiles.university_id - the
 * picker never shows for them and setSiloUniversityId is a no-op.
 *
 * View as: a REAL superadmin can preview the UI as a university_admin or as a
 * regular student via the `effective*` flags. PRESENTATION ONLY - every data
 * query keeps using the real role + silo (the DB clamps already make a
 * superadmin-in-a-silo's rows identical to a real university_admin's), so the
 * POV never widens or narrows access; it just re-renders the chrome. For
 * non-superadmins viewAs is inert and the effective flags equal the real ones.
 */

const STORAGE_KEY = 'dc_admin_university_silo';
const VIEW_AS_KEY = 'dc_admin_view_as';

export type AdminViewAs = 'superadmin' | 'university_admin' | 'user';

interface AdminUniversitySiloContextType {
  /** The school the admin console is scoped to; null = superadmin hasn't picked yet. */
  siloUniversityId: string | null;
  /** Superadmin-only; persists to localStorage so a refresh keeps the silo. */
  setSiloUniversityId: (id: string | null) => void;
  /** Current POV ('superadmin' = real view). Only ever non-default for real superadmins. */
  viewAs: AdminViewAs;
  /** Superadmin-only; persists to sessionStorage (survives refresh, clears with the tab). */
  setViewAs: (v: AdminViewAs) => void;
  /** Presentation flags: the real role downgraded by the POV. Use for UI branches only. */
  effectiveIsSuperAdmin: boolean;
  effectiveIsUniversityAdmin: boolean;
  effectiveIsAdmin: boolean;
}

const AdminUniversitySiloContext = createContext<AdminUniversitySiloContextType | null>(null);

function readStoredSiloId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function writeStoredSiloId(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

function readStoredViewAs(): AdminViewAs {
  try {
    const v = sessionStorage.getItem(VIEW_AS_KEY);
    return v === 'university_admin' || v === 'user' ? v : 'superadmin';
  } catch {
    return 'superadmin';
  }
}

function writeStoredViewAs(v: AdminViewAs): void {
  try {
    if (v === 'superadmin') sessionStorage.removeItem(VIEW_AS_KEY);
    else sessionStorage.setItem(VIEW_AS_KEY, v);
  } catch {
    // ignore storage errors
  }
}

export function AdminUniversitySiloProvider({ children }: { children: ReactNode }) {
  const { isAdmin, isSuperAdmin, isUniversityAdmin, universityId } = useAuth();
  const [storedId, setStoredId] = useState<string | null>(readStoredSiloId);
  const [storedViewAs, setStoredViewAs] = useState<AdminViewAs>(readStoredViewAs);

  // Silo derivation stays on the REAL role: the POV must never change which
  // rows the console fetches, only how the chrome renders.
  const siloUniversityId = isSuperAdmin ? storedId : (universityId ?? null);

  const setSiloUniversityId = (id: string | null) => {
    if (!isSuperAdmin) return;
    setStoredId(id);
    writeStoredSiloId(id);
  };

  const viewAs: AdminViewAs = isSuperAdmin ? storedViewAs : 'superadmin';

  const setViewAs = (v: AdminViewAs) => {
    if (!isSuperAdmin) return;
    // Impersonation trail (P0.5): every POV switch is audited, including the
    // return to superadmin. Presentation-only or not, "view as" is the thing
    // a security review asks to see logged.
    if (v !== storedViewAs) {
      void logAdminAction(`admin.view_as.${v}`, 'admin_pov', null, siloUniversityId);
    }
    setStoredViewAs(v);
    writeStoredViewAs(v);
  };

  const effectiveIsSuperAdmin = isSuperAdmin && viewAs === 'superadmin';
  const effectiveIsUniversityAdmin = isUniversityAdmin || (isSuperAdmin && viewAs === 'university_admin');
  const effectiveIsAdmin = isAdmin && !(isSuperAdmin && viewAs === 'user');

  return (
    <AdminUniversitySiloContext.Provider
      value={{
        siloUniversityId,
        setSiloUniversityId,
        viewAs,
        setViewAs,
        effectiveIsSuperAdmin,
        effectiveIsUniversityAdmin,
        effectiveIsAdmin,
      }}
    >
      {children}
    </AdminUniversitySiloContext.Provider>
  );
}

export function useAdminUniversitySilo(): AdminUniversitySiloContextType {
  const ctx = useContext(AdminUniversitySiloContext);
  // Provider-less fallback (tests, isolated renders): behave as the REAL role
  // with no silo and no POV, so nothing is hidden that the real role can see.
  const { isAdmin, isSuperAdmin, isUniversityAdmin, universityId } = useAuth();
  return (
    ctx ?? {
      siloUniversityId: isSuperAdmin ? null : (universityId ?? null),
      setSiloUniversityId: () => {},
      viewAs: 'superadmin',
      setViewAs: () => {},
      effectiveIsSuperAdmin: isSuperAdmin,
      effectiveIsUniversityAdmin: isUniversityAdmin,
      effectiveIsAdmin: isAdmin,
    }
  );
}
