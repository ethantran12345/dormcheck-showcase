import { Eye, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAdminUniversitySilo } from '@/contexts/AdminUniversityContext';

/**
 * Floating indicator while a REAL superadmin previews the app as another role.
 * Driven by the real role (not the effective one) so it survives every
 * simulated restriction - it is the one always-available exit, even after the
 * Student POV bounces the superadmin off /admin. Amber on purpose: visually
 * distinct from the malachite chrome so a preview can never be mistaken for
 * the real console.
 */
export function ViewAsBanner() {
  const { isSuperAdmin } = useAuth();
  const { viewAs, setViewAs } = useAdminUniversitySilo();

  if (!isSuperAdmin || viewAs === 'superadmin') return null;

  const label = viewAs === 'university_admin' ? 'University admin' : 'Student';

  return (
    <div
      className="fixed bottom-4 left-1/2 z-[1200] -translate-x-1/2"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 py-1.5 pl-3 pr-1.5 shadow-raised">
        <Eye className="h-4 w-4 shrink-0 text-amber-700" aria-hidden />
        <span className="whitespace-nowrap text-sm font-bold text-amber-800">
          Viewing as {label}
        </span>
        <button
          type="button"
          onClick={() => setViewAs('superadmin')}
          className="flex items-center gap-1 rounded-full bg-amber-200 px-2.5 py-1 text-xs font-bold text-amber-900 transition-colors hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-1"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Exit
        </button>
      </div>
    </div>
  );
}
