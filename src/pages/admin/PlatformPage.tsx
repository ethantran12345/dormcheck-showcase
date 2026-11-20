import { Navigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { logAdminAction } from '@/lib/adminAudit';
import { Switch } from '@/components/ui/switch';
import { getUniversityBySlug } from '@/config/universities';
import { LIMITED_SURFACES } from '@/lib/featureFlags';
import { PageContainer } from '@/components/ui/page-container';

type UniversityRow = {
  id: string;
  slug: string;
  name: string;
  short_name: string;
  city: string | null;
  email_domains: string[] | null;
  is_active: boolean;
  feature_flags: Record<string, boolean> | null;
};

/** Per-tenant toggles surfaced in the console. limitedSurfaces is the master gate;
 *  the rest override individual surfaces (see useFeatureFlags overrides). */
const TENANT_FLAGS: { key: string; label: string; hint: string }[] = [
  {
    key: 'limitedSurfaces',
    label: 'Limited surfaces',
    hint: 'Reduced surface set: checklist, marketplace, and messages',
  },
  { key: 'showHousing', label: 'Housing explore', hint: 'Dorm explore, gallery, and reviews' },
  { key: 'showRoommates', label: 'Roommate browsing', hint: 'Roommate finder posts' },
  { key: 'showMap', label: 'Campus map', hint: 'Interactive campus map' },
  { key: 'showGroupChats', label: 'Group chats', hint: 'General group chats (building chats are separate)' },
  { key: 'showRankings', label: 'Dorm rankings', hint: 'Collaborative ranking boards' },
  { key: 'showSavedDorms', label: 'Saved dorms', hint: 'Save or bookmark dorms' },
];

type SeedCounts = Record<string, { dorms: number }>;

/** Build per-tenant seed counts from the one housing-catalog response. */
export function countDormsByUniversity(
  housingRows: readonly { university_id: string | null }[],
): SeedCounts {
  return housingRows.reduce<SeedCounts>((seed, { university_id }) => {
    if (!university_id) return seed;
    const counts = seed[university_id] ?? { dorms: 0 };
    counts.dorms += 1;
    seed[university_id] = counts;
    return seed;
  }, {});
}

async function fetchUniversities(): Promise<{ rows: UniversityRow[]; seed: SeedCounts }> {
  const [universitiesResult, housingResult] = await Promise.all([
    supabase
      .from('universities')
      .select('id, slug, name, short_name, city, email_domains, is_active, feature_flags')
      .order('name'),
    supabase.from('master_housing').select('university_id'),
  ]);
  if (universitiesResult.error) throw universitiesResult.error;
  if (housingResult.error) throw housingResult.error;

  // Cast: types.ts intentionally lags the feature_flags migration.
  const rows = (universitiesResult.data ?? []) as unknown as UniversityRow[];
  return { rows, seed: countDormsByUniversity(housingResult.data ?? []) };
}

/**
 * Superadmin platform surface: which universities are live, and whether each
 * has the content it needs before flipping on. Activation is the launch
 * switch - it gates signup domains and tenant visibility platform-wide.
 */
export default function PlatformPage() {
  const { user, isAdmin, isSuperAdmin, isLoading: authLoading, profileLoaded } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['admin-platform-universities'],
    queryFn: fetchUniversities,
    enabled: !authLoading && !!user && isSuperAdmin,
    staleTime: 30_000,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ row, active }: { row: UniversityRow; active: boolean }) => {
      const { data, error } = await supabase
        .from('universities')
        .update({ is_active: active })
        .eq('id', row.id)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Update blocked - check superadmin RLS.');
      await logAdminAction(
        active ? 'university.activate' : 'university.deactivate',
        'universities',
        row.id,
        row.id,
      );
    },
    onSuccess: (_d, { row, active }) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-platform-universities'] });
      toast.success(`${row.short_name} is now ${active ? 'ACTIVE' : 'inactive'}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Update failed'),
  });

  const flagMutation = useMutation({
    mutationFn: async ({ row, key, value }: { row: UniversityRow; key: string; value: boolean }) => {
      const next = { ...(row.feature_flags ?? {}), [key]: value };
      // Cast: types.ts intentionally lags the set_university_feature_flags migration.
      const { error } = await supabase.rpc(
        'set_university_feature_flags' as never,
        { p_university_id: row.id, p_flags: next } as never,
      );
      if (error) throw error;
    },
    onSuccess: (_d, { row, key, value }) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-platform-universities'] });
      void queryClient.invalidateQueries({ queryKey: ['university-feature-flags', row.id] });
      toast.success(`${row.short_name}: ${key} ${value ? 'on' : 'off'}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Flag update failed'),
  });

  if (authLoading || !profileLoaded) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!user || !isAdmin || !isSuperAdmin) return <Navigate to="/" replace />;

  const rows = query.data?.rows ?? [];
  const seed = query.data?.seed ?? {};

  return (
    <div className="min-h-screen bg-background">
      <PageContainer width="wide" className="px-4 sm:px-6 py-6 pb-16 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-malachite-600/15 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-malachite-600" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Platform</h1>
            <p className="text-sm text-muted-foreground">
              University activation and seed status. Activating a school opens its email domains
              for signup.
            </p>
          </div>
        </div>

        <section className="rounded-xl border border-border bg-card shadow-raised overflow-hidden">
          {query.isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : query.isError ? (
            <div className="px-4 py-6 text-center text-sm text-foreground">
              Couldn't load universities.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">University</th>
                    <th className="px-4 py-3 font-medium">Signup domains</th>
                    <th className="px-4 py-3 font-medium">Seed status</th>
                    <th className="px-4 py-3 font-medium">Live</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => {
                    const counts = seed[row.id] ?? { dorms: 0 };
                    const unseeded = counts.dorms === 0;
                    return (
                      <tr key={row.id}>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-foreground">{row.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {row.slug}
                            {row.city ? ` · ${row.city}` : ''}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-foreground">
                          {(row.email_domains ?? []).map((d) => `@${d}`).join(', ') || ' - '}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={
                              unseeded
                                ? 'inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800'
                                : 'text-foreground'
                            }
                          >
                            {counts.dorms} dorm rows
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Switch
                            checked={row.is_active}
                            disabled={toggleMutation.isPending}
                            onCheckedChange={(v) => {
                              const verb = v ? 'Activate' : 'Deactivate';
                              if (
                                window.confirm(
                                  `${verb} ${row.name}? This changes who can sign up right now.`,
                                )
                              ) {
                                toggleMutation.mutate({ row, active: v });
                              }
                            }}
                            aria-label={`${row.name} active`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card shadow-raised overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Feature flags</h2>
            <p className="text-xs text-muted-foreground">
              Per-tenant overrides stored in the database. Unset flags inherit the static config
              default; changes reach students within about five minutes (client cache).
            </p>
          </div>
          {rows.map((row) => {
            const overrides = row.feature_flags ?? {};
            const staticDefault = getUniversityBySlug(row.slug);
            // Legacy `phase1Only` rows are still readable for one release — see
            // sanitizeOverrides in useFeatureFlags.ts. Writes always use the new key.
            const effectiveLimited =
              overrides.limitedSurfaces ??
              overrides.phase1Only ??
              staticDefault?.limitedSurfaces ??
              LIMITED_SURFACES;
            return (
              <div key={row.id} className="px-4 py-4 border-b border-border last:border-b-0">
                <p className="font-semibold text-foreground mb-3">{row.name}</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {TENANT_FLAGS.map(({ key, label, hint }) => {
                    const overridden = overrides[key] !== undefined;
                    const checked =
                      overrides[key] ??
                      (key === 'limitedSurfaces' ? effectiveLimited : !effectiveLimited);
                    return (
                      <div key={key} className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {label}
                            {!overridden && (
                              <span className="ml-2 text-xs font-normal text-muted-foreground">
                                inherited
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">{hint}</p>
                        </div>
                        <Switch
                          checked={checked}
                          disabled={flagMutation.isPending}
                          onCheckedChange={(v) => flagMutation.mutate({ row, key, value: v })}
                          aria-label={`${row.name}: ${label}`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      </PageContainer>
    </div>
  );
}
