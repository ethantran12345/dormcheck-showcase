import { createContext, useContext, ReactNode, useMemo } from 'react';
import { DEFAULT_UNIVERSITY, getUniversityById, University } from '@/config/universities';
import { useAuth } from '@/hooks/useAuth';

interface UniversityContextType {
  university: University;
}

const UniversityContext = createContext<UniversityContextType | null>(null);

/**
 * Resolves the current user's university from profiles.university_id (exposed
 * by useAuth), falling back to DEFAULT_UNIVERSITY while signed out, while the
 * profile is still loading, or if the id isn't in the UNIVERSITIES registry.
 *
 * Pre-auth code (auth pages, module-level constants) should import
 * DEFAULT_UNIVERSITY from '@/config/universities' directly - this context is
 * the per-user resolution seam.
 */
export function UniversityProvider({ children }: { children: ReactNode }) {
  const { universityId } = useAuth();
  const value = useMemo(
    () => ({
      university:
        (universityId ? getUniversityById(universityId) : undefined) ?? DEFAULT_UNIVERSITY,
    }),
    [universityId],
  );
  return <UniversityContext.Provider value={value}>{children}</UniversityContext.Provider>;
}

export function useUniversity(): UniversityContextType {
  const ctx = useContext(UniversityContext);
  return ctx ?? { university: DEFAULT_UNIVERSITY };
}
