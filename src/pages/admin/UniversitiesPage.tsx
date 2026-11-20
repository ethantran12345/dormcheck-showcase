import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronRight, Loader2, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { PageContainer } from '@/components/ui/page-container';
import { supabase } from '@/integrations/supabase/client';
import { useAdminUniversitySilo } from '@/contexts/AdminUniversityContext';

/**
 * Superadmin landing page: pick which university's admin console to enter.
 * Each school is a silo - after picking, every admin surface (Overview,
 * Reports, Team, Activity, Manage Dorms) scopes to that school only. The
 * route guard (RequireSuperAdmin in AdminRoutes) keeps this superadmin-only;
 * university_admins never see it (their silo is fixed to their own school).
 */

type UniversityRow = {
  id: string;
  name: string;
  short_name: string;
  city: string | null;
  is_active: boolean;
};

async function fetchUniversities(): Promise<UniversityRow[]> {
  const { data, error } = await supabase
    .from('universities')
    .select('id, name, short_name, city, is_active')
    .order('name');
  if (error) throw error;
  return (data ?? []) as UniversityRow[];
}

export default function UniversitiesPage() {
  const navigate = useNavigate();
  const { setSiloUniversityId } = useAdminUniversitySilo();

  const query = useQuery({
    queryKey: ['admin-universities'],
    queryFn: fetchUniversities,
    staleTime: 300_000,
  });

  const enterSilo = (id: string) => {
    setSiloUniversityId(id);
    navigate('/admin/dashboard');
  };

  return (
    <div className="min-h-screen bg-stone-50">
      {/* LayoutWrapper provides the page's <main id="main-content">; inner layout only. */}
      <PageContainer width="content" className="px-4 py-12 sm:px-6">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-malachite-600/15">
            <ShieldCheck className="h-5 w-5 text-malachite-600" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-stone-900">Universities</h1>
            <p className="text-sm text-stone-500">
              Pick a school to open its admin console. Everything inside is scoped to that school.
            </p>
          </div>
        </div>

        {query.isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-malachite-600" aria-label="Loading universities" />
          </div>
        ) : query.isError ? (
          <Card className="rounded-xl border-stone-200 bg-white p-6 text-sm text-stone-700">
            Couldn't load universities.
          </Card>
        ) : (
          <ul className="space-y-3">
            {(query.data ?? []).map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => enterSilo(u.id)}
                  className="flex w-full items-center gap-4 rounded-xl border border-stone-200 bg-white p-5 text-left shadow-raised transition-shadow hover:shadow-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-2"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-malachite-50">
                    <Building2 className="h-5 w-5 text-malachite-800" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-base font-bold text-stone-900">{u.name}</span>
                      <span
                        className={
                          u.is_active
                            ? 'inline-flex shrink-0 items-center rounded-full bg-malachite-50 px-2 py-0.5 text-[11px] font-bold text-malachite-800'
                            : 'inline-flex shrink-0 items-center rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-bold text-stone-600'
                        }
                      >
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </span>
                    <span className="block truncate text-sm text-stone-500">
                      {u.short_name}
                      {u.city ? ` · ${u.city}` : ''}
                    </span>
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-stone-400" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </PageContainer>
    </div>
  );
}
