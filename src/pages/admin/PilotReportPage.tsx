import { Link, Navigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Download, Loader2, Printer } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getUniversityById } from '@/config/universities';
import { displayCount, countOrZero, type SuppressibleCount } from '@/lib/smallCell';
import { fetchAdminMetrics, type AdminMetricsResponse } from '@/lib/adminMetrics';
import { Button } from '@/components/ui/button';
import { PageContainer } from '@/components/ui/page-container';

/**
 * CSV companion for institutional-research staff (P1.8c): the same
 * aggregate-only, small-cell-suppressed numbers as the printed scorecard -
 * suppressed cells export as "<5", never the raw value.
 */
export function buildReportCsv(data: AdminMetricsResponse, universityName: string): string {
  const rows: string[][] = [
    ['section', 'metric', 'value'],
    ['headline', 'students_signed_up', displayCount(data.metrics.totalUsers)],
    ['headline', 'active_last_7_days', displayCount(data.metrics.activeLast7Days)],
    ['headline', 'marketplace_listings_live', displayCount(data.metrics.activeListings)],
    ['funnel', 'signed_up', displayCount(data.funnel.signedUp)],
    ['funnel', 'took_core_action', displayCount(data.funnel.activated)],
    ['funnel', 'active_this_week', displayCount(data.funnel.activeThisWeek)],
    ['funnel', 'returning_week_over_week', displayCount(data.funnel.returning)],
    ...data.signupsByWeek.map((w) => ['signups_by_week', w.weekStart, displayCount(w.count)]),
    ...data.dorms
      .filter((d) => d.dorm !== 'No dorm set')
      .map((d) => ['activity_by_hall', d.dorm, displayCount(d.users)]),
    ['safety', 'open_reports', String(data.needsAttention.openReports)],
  ];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [
    `# DormCheck scorecard - ${universityName} - aggregate adoption data only, no student PII`,
    ...rows.map((r) => r.map(esc).join(',')),
  ].join('\n');
}

/**
 * Plain-English narrative for a section (P1.8c). Only speaks when the inputs
 * are unsuppressed real numbers - never invents figures around "<5" cells.
 */
export function funnelNarrative(f: AdminMetricsResponse['funnel']): string | null {
  const signedUp = f.signedUp;
  const activated = f.activated;
  if (typeof signedUp !== 'number' || typeof activated !== 'number' || signedUp === 0) return null;
  const pct = Math.round((activated / signedUp) * 100);
  return `${pct}% of signed-up students have taken a core action in the app.`;
}

export function signupsNarrative(weeks: AdminMetricsResponse['signupsByWeek']): string | null {
  if (weeks.length < 2) return null;
  const last = weeks[weeks.length - 1]?.count;
  const prev = weeks[weeks.length - 2]?.count;
  if (typeof last !== 'number' || typeof prev !== 'number' || prev === 0) return null;
  const delta = Math.round(((last - prev) / prev) * 100);
  if (delta === 0) return 'Weekly signups held steady versus the prior week.';
  return `Weekly signups ${delta > 0 ? 'grew' : 'declined'} ${Math.abs(delta)}% versus the prior week.`;
}

export function dormsNarrative(dorms: { dorm: string; users: SuppressibleCount }[]): string | null {
  const real = dorms.filter((d) => d.dorm !== 'No dorm set' && typeof d.users === 'number');
  if (real.length === 0) return null;
  const top = real.reduce((a, b) => (countOrZero(b.users) > countOrZero(a.users) ? b : a));
  if (countOrZero(top.users) === 0) return null;
  return `Adoption is led by ${top.dorm}.`;
}

const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
const weekFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

/**
 * Printable pilot scorecard for the university champion to circulate.
 * Adoption numbers only: no dollar figures, no student emails or PII.
 * Small-cell suppression from the metrics endpoint carries through as "<5".
 * Print/Save as PDF via the browser print dialog.
 */
export default function PilotReportPage() {
  const { user, isAdmin, universityId, isLoading: authLoading, profileLoaded } = useAuth();

  const query = useQuery({
    queryKey: ['admin-metrics'],
    // Wrap so React Query's QueryFunctionContext isn't passed as siloUniversityId
    // (which sent "[object Object]" as the university param at runtime).
    queryFn: () => fetchAdminMetrics(),
    enabled: !authLoading && !!user && isAdmin === true,
    retry: false,
    staleTime: 30_000,
  });

  if (authLoading || !profileLoaded) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!user || !isAdmin) return <Navigate to="/" replace />;

  const universityName = getUniversityById(universityId ?? '')?.name ?? 'DormCheck';

  return (
    <div className="min-h-screen bg-white">
      <PageContainer width="prose" className="px-6 py-8 space-y-6">
        <div className="flex items-center justify-between gap-3 print:hidden">
          <Link to="/admin/dashboard" className="text-sm font-medium text-malachite-800 hover:underline">
            ← Back to Overview
          </Link>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!query.data}
              onClick={() => {
                if (!query.data) return;
                const csv = buildReportCsv(query.data, universityName);
                const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
                const a = document.createElement('a');
                a.href = url;
                a.download = `dormcheck-scorecard-${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              CSV
            </Button>
            <Button
              type="button"
              onClick={() => window.print()}
              className="bg-malachite-800 text-white hover:bg-malachite-900"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print / Save as PDF
            </Button>
          </div>
        </div>

        {query.isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : query.isError || !query.data ? (
          <p className="py-24 text-center text-sm text-foreground">Couldn't load metrics for the report.</p>
        ) : (
          <ReportBody data={query.data} universityName={universityName} />
        )}
      </PageContainer>
    </div>
  );
}

function ReportBody({ data, universityName }: { data: AdminMetricsResponse; universityName: string }) {
  const activityDorms = data.dorms.filter((d) => d.dorm !== 'No dorm set').slice(0, 10);
  const funnelLine = funnelNarrative(data.funnel);
  const signupsLine = signupsNarrative(data.signupsByWeek);
  const dormsLine = dormsNarrative(data.dorms);
  return (
    <article className="space-y-8">
      <header className="border-b-4 border-malachite-600 pb-4">
        <p className="text-sm font-semibold uppercase tracking-wide text-malachite-800">
          DormCheck pilot scorecard
        </p>
        <h1 className="text-3xl font-bold text-stone-900">{universityName}</h1>
        <p className="text-sm text-stone-600">
          {monthFmt.format(new Date())} · Adoption summary - an extension of your existing housing
          systems, not a replacement.
        </p>
      </header>

      <section aria-label="Headline metrics" className="grid grid-cols-3 gap-4">
        <Stat label="Students signed up" value={displayCount(data.metrics.totalUsers)} />
        <Stat label="Active in the last 7 days" value={displayCount(data.metrics.activeLast7Days)} />
        <Stat label="Marketplace listings live" value={displayCount(data.metrics.activeListings)} />
      </section>

      <section aria-label="Engagement funnel" className="space-y-2">
        <h2 className="text-lg font-semibold text-stone-900">Engagement funnel</h2>
        {funnelLine && <p className="text-sm text-stone-700">{funnelLine}</p>}
        <table className="w-full text-sm">
          <tbody className="divide-y divide-stone-200">
            <FunnelRow label="Signed up" value={displayCount(data.funnel.signedUp)} />
            <FunnelRow label="Took a core action" value={displayCount(data.funnel.activated)} />
            <FunnelRow label="Active this week" value={displayCount(data.funnel.activeThisWeek)} />
            <FunnelRow label="Returning week over week" value={displayCount(data.funnel.returning)} />
          </tbody>
        </table>
      </section>

      <section aria-label="Signups by week" className="space-y-2">
        <h2 className="text-lg font-semibold text-stone-900">Signups by week</h2>
        {signupsLine && <p className="text-sm text-stone-700">{signupsLine}</p>}
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="py-1.5 font-medium">Week of</th>
              <th className="py-1.5 font-medium text-right">New signups</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200">
            {data.signupsByWeek.map((w) => (
              <tr key={w.weekStart}>
                <td className="py-1.5 text-stone-700">{weekFmt.format(new Date(w.weekStart))}</td>
                <td className="py-1.5 text-right font-medium text-stone-900">{displayCount(w.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {activityDorms.length > 0 && (
        <section aria-label="Activity by residence hall" className="space-y-2">
          <h2 className="text-lg font-semibold text-stone-900">Activity by residence hall</h2>
          {dormsLine && <p className="text-sm text-stone-700">{dormsLine}</p>}
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="py-1.5 font-medium">Hall</th>
                <th className="py-1.5 font-medium text-right">Students</th>
                <th className="py-1.5 font-medium text-right">Actions this week</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {activityDorms.map((d) => (
                <tr key={d.dorm}>
                  <td className="py-1.5 text-stone-700">{d.dorm}</td>
                  <td className="py-1.5 text-right font-medium text-stone-900">{displayCount(d.users)}</td>
                  <td className="py-1.5 text-right text-stone-700">{displayCount(d.actionsThisWeek)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section aria-label="Community safety" className="space-y-1">
        <h2 className="text-lg font-semibold text-stone-900">Community safety</h2>
        <p className="text-sm text-stone-700">
          {data.needsAttention.openReports === 0
            ? 'No student reports are currently awaiting review.'
            : `${data.needsAttention.openReports} student ${
                data.needsAttention.openReports === 1 ? 'report is' : 'reports are'
              } in the moderation queue.`}{' '}
          Every report is reviewed by the DormCheck team.
        </p>
      </section>

      <footer className="border-t border-stone-200 pt-3 text-xs text-stone-500 space-y-1">
        {data.suppression?.applied && (
          <p>
            Counts under {data.suppression.threshold} display as "&lt;{data.suppression.threshold}" to
            protect student privacy.
          </p>
        )}
        <p>
          Generated by DormCheck for {universityName}. Contains aggregate adoption data only - no
          individual student information.
        </p>
      </footer>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <p className="text-3xl font-bold text-stone-900">{value}</p>
      <p className="text-xs text-stone-600">{label}</p>
    </div>
  );
}

function FunnelRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="py-1.5 text-stone-700">{label}</td>
      <td className="py-1.5 text-right font-medium text-stone-900">{value}</td>
    </tr>
  );
}
