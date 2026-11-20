import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  Check,
  Copy,
  FileDown,
  Loader2,
  ShieldCheck,
  Tag,
  UserPlus,
  Users,
  Zap,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAdminUniversitySilo } from '@/contexts/AdminUniversityContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { MetricCard } from '@/components/admin/MetricCard';
import { DataHealthCard } from '@/components/admin/DataHealthCard';
import { FunnelChart, type FunnelStep } from '@/components/admin/FunnelChart';
import { ReturningRateGauge } from '@/components/admin/ReturningRateGauge';
import { SignupsAreaChart } from '@/components/admin/SignupsAreaChart';
import { TopHallsBars } from '@/components/admin/TopHallsBars';
import { displayCount, countOrZero, type SuppressibleCount } from '@/lib/smallCell';
import { gridChildVariants, gridParentVariants, listItemVariants } from '@/lib/motion';
import { fetchAdminMetrics, type AdminMetricsResponse, type MetricsQueryError } from '@/lib/adminMetrics';
import { PageContainer } from '@/components/ui/page-container';



const dateFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function formatJoined(iso: string | null | undefined): string {
  if (!iso) return ' - ';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return ' - ';
  return dateFmt.format(d);
}



const FUNNEL_STEPS: FunnelStep[] = [
  { key: 'signedUp', label: 'Signed up', helper: 'Everyone who created an account' },
  {
    key: 'activated',
    label: 'Activated',
    helper: 'Did at least one real action',
    tip: 'Signed up AND did at least one core action (a listing, message, or checklist item) - not just created an account.',
  },
  {
    key: 'activeThisWeek',
    label: 'Active this week',
    helper: 'Used the app in the last 7 days',
    tip: 'Did any tracked action in the last 7 days.',
  },
  {
    key: 'returning',
    label: 'Returning',
    helper: 'Came back after a previous week',
    tip: 'Was active in an earlier week and came back to use the app again in a later week.',
  },
];

/**
 * "Since your last visit" strip: 2-3 plain-English sentences derived
 * client-side from the metrics response, each linking to its section.
 * Sentences with no data to report are skipped; the strip hides entirely
 * when nothing qualifies.
 */
function HighlightsStrip({ data }: { data: AdminMetricsResponse }) {
  const highlights: Array<{ key: string; text: string; to: string }> = [];

  // Suppressed counts (null) read as 0 here, so a small-cohort week simply
  // yields no highlight rather than an inaccurate one.
  const signupsCur = countOrZero(data.deltas.newSignups.current);
  const signupsPrev = countOrZero(data.deltas.newSignups.previous);
  if (signupsCur > 0) {
    let change = '';
    if (signupsPrev > 0 && signupsCur !== signupsPrev) {
      const pctChange = Math.round(((signupsCur - signupsPrev) / signupsPrev) * 100);
      change = ` (${pctChange > 0 ? '+' : ''}${pctChange}%)`;
    }
    highlights.push({
      key: 'signups',
      text: `${signupsCur} new signup${signupsCur === 1 ? '' : 's'} this week${change}.`,
      to: '#signups',
    });
  }

  const topDorm = [...data.dorms].sort(
    (a, b) => countOrZero(b.actionsThisWeek) - countOrZero(a.actionsThisWeek),
  )[0];
  if (topDorm && countOrZero(topDorm.actionsThisWeek) > 0) {
    highlights.push({
      key: 'top-dorm',
      text: `${topDorm.dorm} is your most active hall.`,
      to: '#by-dorm',
    });
  }

  const openReports = data.needsAttention.openReports;
  if (openReports > 0) {
    highlights.push({
      key: 'reports',
      text: `${openReports} report${openReports === 1 ? '' : 's'} need${openReports === 1 ? 's' : ''} your review.`,
      to: '/admin/reports',
    });
  }

  if (highlights.length === 0) return null;

  return (
    <section aria-label="Since your last visit" className="rounded-xl border border-malachite-600/25 bg-malachite-600/10 p-4">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Since your last visit</h2>
      <ul className="mt-2 space-y-1.5">
        {highlights.map((h) => (
          <li key={h.key}>
            {h.to.startsWith('#') ? (
              <a href={h.to} className="text-sm font-medium text-foreground hover:text-malachite-800 hover:underline">
                {h.text}
              </a>
            ) : (
              <Link to={h.to} className="text-sm font-medium text-foreground hover:text-malachite-800 hover:underline">
                {h.text}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Live "Updated Xs ago" heartbeat next to the header; shows a refresh affordance while fetching. */
function UpdatedAgo({ updatedAt, isFetching }: { updatedAt: number; isFetching: boolean }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const secs = updatedAt > 0 ? Math.max(0, Math.round((Date.now() - updatedAt) / 1000)) : 0;
  const label = isFetching
    ? 'Updating…'
    : secs < 10
      ? 'Updated just now'
      : secs < 60
        ? `Updated ${secs}s ago`
        : `Updated ${Math.floor(secs / 60)}m ago`;

  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {isFetching ? (
        <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-malachite-600" aria-hidden="true" />
      )}
      {label}
    </p>
  );
}

type DormSortKey = 'dorm' | 'users' | 'actionsThisWeek';

/**
 * Green / amber / gray engagement signal per hall, from active users. Not
 * color-only: an accessible name carries the level, and a tooltip surfaces the
 * exact threshold so the legend isn't only in the section subhead.
 */
function ActivityDot({ users }: { users: SuppressibleCount }) {
  const n = countOrZero(users);
  const level = n > 10 ? 'high' : n > 0 ? 'some' : 'none';
  const color = level === 'high' ? 'bg-malachite-600' : level === 'some' ? 'bg-amber-500' : 'bg-stone-300';
  const label = level === 'high' ? 'High activity' : level === 'some' ? 'Some activity' : 'No activity';
  const tip =
    level === 'high'
      ? 'High: more than 10 active users this week'
      : level === 'some'
        ? 'Some: 1-10 active users this week'
        : 'None: no active users this week';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={label}
          className="inline-flex items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600"
        >
          <span className={`h-2.5 w-2.5 rounded-full ${color}`} aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

/** Copy-to-clipboard affordance for emails/ids; reveals on row hover + keyboard focus. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable - no-op */
    }
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          onClick={onCopy}
          aria-label={copied ? 'Copied' : label}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 group-hover:opacity-100 group-focus-within:opacity-100"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-malachite-700" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? 'Copied' : label}</TooltipContent>
    </Tooltip>
  );
}

/** Per-hall table, sortable by any column; defaults to most active first. */
function DormTable({ dorms }: { dorms: AdminMetricsResponse['dorms'] }) {
  const [sortKey, setSortKey] = useState<DormSortKey>('actionsThisWeek');
  const [sortDesc, setSortDesc] = useState(true);

  const sorted = useMemo(() => {
    const rows = [...dorms];
    rows.sort((a, b) => {
      const cmp =
        sortKey === 'dorm'
          ? a.dorm.localeCompare(b.dorm)
          : countOrZero(a[sortKey]) - countOrZero(b[sortKey]);
      return sortDesc ? -cmp : cmp;
    });
    return rows;
  }, [dorms, sortKey, sortDesc]);

  const toggleSort = (key: DormSortKey) => {
    if (key === sortKey) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(key);
      setSortDesc(key !== 'dorm');
    }
  };

  const headers: Array<{ key: DormSortKey; label: string; align: 'left' | 'right' }> = [
    { key: 'dorm', label: 'Dorm', align: 'left' },
    { key: 'users', label: 'Users', align: 'right' },
    { key: 'actionsThisWeek', label: 'Core actions (7d)', align: 'right' },
  ];

  return (
    <div className="overflow-x-auto">
      <Table className="w-full text-sm">
        <TableHeader className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
          <TableRow>
            <TableHead className="w-10 px-4 py-3 font-medium">
              <span className="sr-only">Activity level</span>
            </TableHead>
            {headers.map((h) => (
              <TableHead
                key={h.key}
                className={`px-4 py-3 font-medium ${h.align === 'right' ? 'text-right' : ''}`}
                aria-sort={sortKey === h.key ? (sortDesc ? 'descending' : 'ascending') : undefined}
              >
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => toggleSort(h.key)}
                  className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 rounded ${h.align === 'right' ? 'justify-end' : ''}`}
                >
                  {h.label}
                  {sortKey === h.key && <span aria-hidden="true">{sortDesc ? '↓' : '↑'}</span>}
                </Button>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className="divide-y divide-border">
          {sorted.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="px-4 py-6 text-center text-sm text-muted-foreground">
                No users yet.
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((row) => {
              const inactive = countOrZero(row.users) === 0;
              return (
              <TableRow key={row.dorm} className={`group ${inactive ? 'bg-muted/40' : ''}`}>
                <TableCell className="px-4 py-3">
                  <ActivityDot users={row.users} />
                </TableCell>
                <TableCell className={`px-4 py-3 ${inactive ? 'text-muted-foreground' : 'text-foreground'}`}>
                  <div className="flex items-center gap-2">
                    <span>{row.dorm}</span>
                    <Link
                      to={`/admin/dorms?q=${encodeURIComponent(row.dorm)}`}
                      className="whitespace-nowrap rounded text-xs font-medium text-malachite-800 opacity-0 transition-opacity hover:underline focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 group-hover:opacity-100 group-focus-within:opacity-100"
                    >
                      View hall →
                    </Link>
                  </div>
                </TableCell>
                <TableCell className={`px-4 py-3 text-right ${inactive ? 'text-muted-foreground' : 'text-foreground'}`}>{displayCount(row.users)}</TableCell>
                <TableCell className={`px-4 py-3 text-right ${inactive ? 'text-muted-foreground' : 'text-foreground'}`}>{displayCount(row.actionsThisWeek)}</TableCell>
              </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}



export default function AdminDashboard() {
  const { user, isAdmin, isSuperAdmin, isLoading: authLoading, profileLoaded } = useAuth();
  const { siloUniversityId, viewAs, effectiveIsSuperAdmin, effectiveIsUniversityAdmin } =
    useAdminUniversitySilo();
  const reduceMotion = useReducedMotion();
  // Data scoping stays on the REAL role; the POV only changes response
  // SHAPING (as_role) and which UI branches render below.
  const siloParam = isSuperAdmin ? siloUniversityId : null;
  const asUniversityAdmin = isSuperAdmin && viewAs === 'university_admin';

  const query = useQuery({
    queryKey: ['admin-metrics', siloUniversityId, viewAs],
    queryFn: () => fetchAdminMetrics(siloParam, asUniversityAdmin),
    enabled: !authLoading && !!user && isAdmin === true && (!isSuperAdmin || !!siloUniversityId),
    retry: false,
    staleTime: 30_000,
    // Self-refresh so an open dashboard stays live. Each tick is an edge-function
    // call, so 60s is the floor. Disabled under reduced motion - no auto-refetch
    // flashing for those users (manual Retry still works).
    refetchInterval: reduceMotion ? false : 60_000,
  });

  if (authLoading || !profileLoaded) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user || !isAdmin) {
    return <Navigate to="/" replace />;
  }

  const forbidden = (query.error as MetricsQueryError | null)?.forbidden === true;
  if (forbidden) {
    return <Navigate to="/" replace />;
  }

  return (
    <TooltipProvider delayDuration={200}>
    <div className="min-h-screen bg-background">
      <PageContainer width="wide" className="px-4 sm:px-6 py-6 pb-16">
        {/* One cohesive dashboard shell: header + every section live inside a single card. */}
        <div className="rounded-2xl border border-border bg-card shadow-raised p-4 sm:p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                aria-label="About this dashboard"
                className="w-10 h-10 rounded-xl bg-malachite-600/15 flex items-center justify-center shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600"
              >
                <ShieldCheck className="w-5 h-5 text-malachite-600" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Operator scorecard: adoption, activation, and pilot health.</TooltipContent>
          </Tooltip>
          <div>
            <h1 className="text-2xl font-bold text-foreground">DormCheck Admin</h1>
            {effectiveIsSuperAdmin && (
              <Link to="/admin/dorms" className="text-sm font-medium text-malachite-800 hover:underline">
                Manage Dorms →
              </Link>
            )}
            <p className="text-sm text-muted-foreground">
              Operator scorecard: adoption, activation funnel, and pilot health.
            </p>
          </div>
          </div>
          <div className="flex items-center gap-3">
            {query.data ? <UpdatedAgo updatedAt={query.dataUpdatedAt} isFetching={query.isFetching} /> : null}
            <Link
              to="/admin/report"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-malachite-800 shadow-raised hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600"
            >
              <FileDown className="h-4 w-4" aria-hidden="true" />
              Download report
            </Link>
          </div>
        </div>

        {query.isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : query.isError ? (
          <Card className="rounded-xl border border-border bg-card shadow-raised p-6 text-center space-y-3">
            <p className="text-sm text-foreground">Couldn't load metrics. Try again.</p>
            <Button variant="outline" onClick={() => query.refetch()}>
              Retry
            </Button>
          </Card>
        ) : query.data ? (
          <>
            <HighlightsStrip data={query.data} />

            <motion.section
              aria-label="Key metrics"
              variants={gridParentVariants}
              initial="hidden"
              animate="visible"
              className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4"
            >
              {[
                {
                  label: 'Total Users',
                  value: query.data.metrics.totalUsers,
                  helperText: 'Everyone with an account',
                  icon: Users,
                  featured: true,
                  // Cumulative signup curve: the picture of "how we got to this total."
                  visual: {
                    kind: 'spark' as const,
                    values: query.data.signupsByWeek.reduce<number[]>((acc, w) => {
                      acc.push((acc[acc.length - 1] ?? 0) + countOrZero(w.count));
                      return acc;
                    }, []),
                  },
                },
                {
                  label: 'New Signups (7d)',
                  value: query.data.deltas.newSignups.current,
                  delta: query.data.deltas.newSignups,
                  helperText: 'Joined in the last 7 days',
                  icon: UserPlus,
                  visual: {
                    kind: 'compare' as const,
                    previous: query.data.deltas.newSignups.previous,
                    current: query.data.deltas.newSignups.current,
                  },
                },
                {
                  label: 'Active (7d)',
                  value: query.data.metrics.activeLast7Days,
                  delta: query.data.deltas.activeUsers,
                  helperText: 'Used the app in the last 7 days',
                  icon: Activity,
                  // Share of everyone with an account who showed up this week.
                  visual: {
                    kind: 'ring' as const,
                    part: query.data.metrics.activeLast7Days,
                    whole: query.data.metrics.totalUsers,
                  },
                },
                {
                  label: 'Core Actions (7d)',
                  value: query.data.deltas.coreActions.current,
                  delta: query.data.deltas.coreActions,
                  helperText: 'Real things students did: listings, messages, checklist',
                  icon: Zap,
                  visual: {
                    kind: 'compare' as const,
                    previous: query.data.deltas.coreActions.previous,
                    current: query.data.deltas.coreActions.current,
                  },
                },
                {
                  label: 'Active Listings',
                  value: query.data.metrics.activeListings,
                  delta: query.data.deltas.listingsCreated,
                  helperText: 'Marketplace items for sale right now',
                  icon: Tag,
                  visual: {
                    kind: 'compare' as const,
                    previous: query.data.deltas.listingsCreated.previous,
                    current: query.data.deltas.listingsCreated.current,
                  },
                },
              ].map((kpi) => (
                <motion.div key={kpi.label} variants={gridChildVariants} className="min-w-0">
                  <MetricCard {...kpi} />
                </motion.div>
              ))}
            </motion.section>

            <motion.div
              variants={listItemVariants}
              initial="hidden"
              animate="visible"
              custom={2}
              className="grid grid-cols-1 gap-4 lg:grid-cols-3"
            >
              <div className="space-y-6 lg:col-span-2">
                <section id="signups" className="scroll-mt-4 space-y-3">
                  <h2 className="text-lg font-semibold text-foreground">Signups per Week</h2>
                  <Card className="rounded-xl border border-border bg-card shadow-raised p-4">
                    <SignupsAreaChart series={query.data.signupsByWeek} />
                  </Card>
                </section>

                <section className="space-y-3">
                  <h2 className="text-lg font-semibold text-foreground">Activation Funnel</h2>
                  <Card className="rounded-xl border border-border bg-card shadow-raised p-4">
                    <FunnelChart funnel={query.data.funnel} steps={FUNNEL_STEPS} />
                  </Card>
                </section>
              </div>

              <div className="space-y-6">
                <section className="space-y-3">
                  <h2 className="text-lg font-semibold text-foreground">Returning Rate</h2>
                  <Card className="rounded-xl border border-border bg-card shadow-raised p-5">
                    <ReturningRateGauge
                      returning={query.data.funnel.returning}
                      signedUp={query.data.funnel.signedUp}
                    />
                  </Card>
                </section>

                <section className="space-y-3">
                  <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label="What needs attention"
                          className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600"
                        >
                          <AlertTriangle className="w-4 h-4 text-amber-600" aria-hidden="true" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Items that may need action: unreviewed reports and stuck users.</TooltipContent>
                    </Tooltip>
                    Needs Attention
                  </h2>
                  <Card className="rounded-xl border border-border bg-card shadow-raised p-4 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">Open reports</p>
                        <p className="text-xs text-muted-foreground">Content + chat-link reports awaiting review</p>
                      </div>
                      <Link
                        to="/admin/reports"
                        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 ${
                          query.data.needsAttention.openReports > 0
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-malachite-600/15 text-malachite-800'
                        }`}
                      >
                        {query.data.needsAttention.openReports > 0 ? (
                          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {query.data.needsAttention.openReports > 0
                          ? `${query.data.needsAttention.openReports} to review →`
                          : 'All clear'}
                      </Link>
                    </div>
                    <div>
                      <div className="flex items-baseline justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">Stuck users</p>
                          <p className="text-xs text-muted-foreground">Signed up 7d+ ago, zero core actions</p>
                        </div>
                        <p className="text-2xl font-bold text-foreground">
                          {displayCount(query.data.needsAttention.stuckUsers.count)}
                        </p>
                      </div>
                      {/* Picture the number: share of all accounts that never got going. Width from countOrZero (no suppression leak). */}
                      {countOrZero(query.data.metrics.totalUsers) > 0 ? (
                        <div className="mt-2">
                          <div aria-hidden="true" className="h-2.5 overflow-hidden rounded-full bg-muted">
                            <motion.div
                              className="h-full rounded-full bg-amber-500"
                              initial={reduceMotion ? false : { width: 0 }}
                              animate={{
                                width: `${Math.min(
                                  100,
                                  (countOrZero(query.data.needsAttention.stuckUsers.count) /
                                    countOrZero(query.data.metrics.totalUsers)) *
                                    100,
                                )}%`,
                              }}
                              transition={reduceMotion ? { duration: 0 } : { duration: 0.5, ease: 'easeOut' }}
                            />
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {Math.min(
                              100,
                              Math.round(
                                (countOrZero(query.data.needsAttention.stuckUsers.count) /
                                  countOrZero(query.data.metrics.totalUsers)) *
                                  100,
                              ),
                            )}
                            % of all accounts haven't done anything yet
                          </p>
                        </div>
                      ) : null}
                      {query.data.needsAttention.stuckUsers.sample.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {query.data.needsAttention.stuckUsers.sample.map((u) => (
                            <li key={u.id} className="group flex items-center gap-2 text-xs text-muted-foreground">
                              <span className="truncate">
                                {u.email ?? u.id} · joined {formatJoined(u.created_at)}
                              </span>
                              <CopyButton value={u.email ?? u.id} label={u.email ? 'Copy email' : 'Copy user ID'} />
                            </li>
                          ))}
                        </ul>
                      ) : effectiveIsUniversityAdmin ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Individual student details are hidden for university admins to protect privacy.
                        </p>
                      ) : null}
                    </div>
                  </Card>
                </section>
              </div>
            </motion.div>

            <motion.section
              variants={listItemVariants}
              initial="hidden"
              animate="visible"
              custom={3}
              aria-label="Data health"
              className="scroll-mt-4"
            >
              <DataHealthCard />
            </motion.section>

            <motion.section
              id="by-dorm"
              variants={listItemVariants}
              initial="hidden"
              animate="visible"
              custom={4}
              className="space-y-3 scroll-mt-4"
            >
              <div>
                <h2 className="text-lg font-semibold text-foreground">By Dorm</h2>
                <p className="text-xs text-muted-foreground">
                  Where your users live and how active each hall is. Green means more than 10 active users this week.
                </p>
              </div>
              <Card className="rounded-xl border border-border bg-card shadow-raised p-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Most active halls this week
                </p>
                <TopHallsBars dorms={query.data.dorms} />
              </Card>
              <Card className="rounded-xl border border-border bg-card shadow-raised overflow-hidden">
                <DormTable dorms={query.data.dorms} />
              </Card>
            </motion.section>

            <motion.section
              variants={listItemVariants}
              initial="hidden"
              animate="visible"
              custom={5}
              className="space-y-3"
            >
              <h2 className="text-lg font-semibold text-foreground">Recent Signups</h2>
              {effectiveIsUniversityAdmin ? (
                <Card className="rounded-xl border border-border bg-card shadow-raised px-4 py-6 text-center text-sm text-muted-foreground">
                  Individual signups are hidden for university admins to protect student privacy.
                  Aggregate signup counts are shown in the metrics above.
                </Card>
              ) : (
              <Card className="rounded-xl border border-border bg-card shadow-raised overflow-hidden">
                <div className="overflow-x-auto">
                  <Table className="w-full text-sm">
                    <TableHeader className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <TableRow>
                        <TableHead className="px-4 py-3 font-medium">Email</TableHead>
                        <TableHead className="px-4 py-3 font-medium">Class Year</TableHead>
                        <TableHead className="px-4 py-3 font-medium">Dorm</TableHead>
                        <TableHead className="px-4 py-3 font-medium">Joined</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y divide-border">
                      {query.data.recentSignups.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="px-4 py-6 text-center text-sm text-muted-foreground">
                            No signups yet.
                          </TableCell>
                        </TableRow>
                      ) : (
                        query.data.recentSignups.map((row) => (
                          <TableRow key={row.id} className="group">
                            <TableCell className="px-4 py-3 text-foreground max-w-[240px]">
                              <div className="flex items-center gap-2">
                                <span className="truncate">{row.email ?? ' - '}</span>
                                {row.email ? <CopyButton value={row.email} label="Copy email" /> : null}
                              </div>
                            </TableCell>
                            <TableCell className="px-4 py-3 text-foreground">
                              {row.class_year != null ? (
                                <Badge variant="secondary" className="font-medium">
                                  {row.class_year}
                                </Badge>
                              ) : (
                                ' - '
                              )}
                            </TableCell>
                            <TableCell className="px-4 py-3 text-foreground">
                              {row.dorm_name ?? ' - '}
                            </TableCell>
                            <TableCell className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                              {formatJoined(row.created_at)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </Card>
              )}
            </motion.section>
          </>
        ) : null}
        </div>
      </PageContainer>
    </div>
    </TooltipProvider>
  );
}
