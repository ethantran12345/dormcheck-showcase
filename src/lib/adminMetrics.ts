import { supabase } from '@/integrations/supabase/client';
import type { SuppressibleCount } from '@/lib/smallCell';

export interface MetricsQueryError extends Error {
  forbidden?: boolean;
}

interface WoWDelta {
  current: SuppressibleCount;
  previous: SuppressibleCount;
}

export interface AdminMetricsResponse {
  metrics: {
    totalUsers: SuppressibleCount;
    activeLast7Days: SuppressibleCount;
    activeListings: SuppressibleCount;
  };
  deltas: {
    newSignups: WoWDelta;
    activeUsers: WoWDelta;
    coreActions: WoWDelta;
    listingsCreated: WoWDelta;
  };
  funnel: {
    signedUp: SuppressibleCount;
    activated: SuppressibleCount;
    activeThisWeek: SuppressibleCount;
    returning: SuppressibleCount;
  };
  dorms: Array<{ dorm: string; users: SuppressibleCount; actionsThisWeek: SuppressibleCount }>;
  signupsByWeek: Array<{ weekStart: string; count: SuppressibleCount }>;
  needsAttention: {
    openReports: number;
    stuckUsers: {
      count: SuppressibleCount;
      sample: Array<{ id: string; email: string | null; created_at: string }>;
    };
  };
  /** Present when the server applied small-cell suppression (university_admin viewers). */
  suppression?: { threshold: number; applied: boolean };
  recentSignups: Array<{
    id: string;
    email: string | null;
    class_year: number | null;
    dorm_name: string | null;
    created_at: string;
  }>;
}
export async function fetchAdminMetrics(
  siloUniversityId: string | null = null,
  asUniversityAdmin = false,
): Promise<AdminMetricsResponse> {
  // Superadmins pass their picked silo as a query param; the edge function
  // clamps it server-side (non-superadmins are always forced to their own
  // school, so the param is only meaningful for superadmins).
  const params = new URLSearchParams();
  if (siloUniversityId) params.set('university', siloUniversityId);
  // View-as POV: ask the server to SHAPE the response as a university_admin
  // gets it (small-cell suppression + PII omission). Honored only for real
  // superadmins, downgrade only - inert for everyone else.
  if (asUniversityAdmin) params.set('as_role', 'university_admin');
  const qs = params.toString();
  const fnPath = qs ? `admin-metrics?${qs}` : 'admin-metrics';
  const { data, error } = await supabase.functions.invoke<AdminMetricsResponse>(fnPath, {
    method: 'GET',
  });

  if (error) {
    // supabase-js wraps non-2xx as FunctionsHttpError with a Response on .context
    const ctx = (error as unknown as { context?: { status?: number; response?: Response } }).context;
    const status = ctx?.status ?? ctx?.response?.status;
    const err: MetricsQueryError = new Error(error.message || 'Metrics request failed');
    if (status === 403) err.forbidden = true;
    throw err;
  }

  if (!data) {
    throw new Error('Empty metrics response');
  }

  // Defensive defaults: if the deployed edge function predates the operator
  // scorecard (Phase 1), render zeros instead of crashing on missing fields.
  const zero = { current: 0, previous: 0 };
  return {
    ...data,
    deltas: data.deltas ?? { newSignups: zero, activeUsers: zero, coreActions: zero, listingsCreated: zero },
    funnel: data.funnel ?? { signedUp: data.metrics?.totalUsers ?? 0, activated: 0, activeThisWeek: 0, returning: 0 },
    dorms: data.dorms ?? [],
    signupsByWeek: data.signupsByWeek ?? [],
    needsAttention: data.needsAttention ?? { openReports: 0, stuckUsers: { count: 0, sample: [] } },
  };
}
