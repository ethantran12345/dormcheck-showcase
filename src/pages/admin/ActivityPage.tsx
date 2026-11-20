import { useState } from 'react';
import { Navigate } from 'react-router';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Loader2, History, Download } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useAdminUniversitySilo } from '@/contexts/AdminUniversityContext';
import { logAdminAction } from '@/lib/adminAudit';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PageContainer } from '@/components/ui/page-container';

const ACTION_FILTERS = [
  { key: 'all', label: 'All actions' },
  { key: 'dorm', label: 'Dorm edits' },
  { key: 'reports', label: 'Moderation' },
  { key: 'team', label: 'Team' },
  { key: 'resources', label: 'Resources' },
] as const;
type ActionFilterKey = (typeof ACTION_FILTERS)[number]['key'];

const DATE_FILTERS = [
  { key: 0, label: 'All time' },
  { key: 7, label: 'Last 7 days' },
  { key: 30, label: 'Last 30 days' },
] as const;

const PAGE_SIZE = 50;

type AuditRow = {
  id: string;
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  university_id: string | null;
  created_at: string;
};

type ActorMap = Record<string, string>;

/** Humanize namespaced action strings for the feed. */
function describeAction(action: string, targetType: string): string {
  const fixed: Record<string, string> = {
    'admin.grant': 'granted admin access',
    'admin.invite_accepted': 'accepted an admin invitation',
    'admin.invite': 'invited a new admin',
    'admin.invite_resent': 'resent an admin invitation',
    'admin.invite_revoked': 'canceled an admin invitation',
    'admin.revoke': 'revoked admin access',
    'admin.role_change': 'changed an admin role',
    dismiss_report: 'dismissed a report',
    escalate_report: 'escalated a report to DormCheck',
    delete_content: 'removed reported content',
    'resource.create': 'added a resource link',
    'resource.update': 'edited a resource link',
    'resource.delete': 'deleted a resource link',
    'resource.reorder': 'reordered resource links',
    'resource.activate': 'made a resource link visible',
    'resource.deactivate': 'hid a resource link',
    'university.activate': 'activated a university',
    'university.deactivate': 'deactivated a university',
    'admin.view_as.user': 'switched to the student point of view',
    'admin.view_as.university_admin': 'switched to the university admin point of view',
    'admin.view_as.superadmin': 'returned to the superadmin point of view',
    'export.audit_log': 'exported the audit log',
    'listing_verification.approve': 'approved a listing verification',
    'listing_verification.reject': 'declined a listing verification',
  };
  if (fixed[action]) return fixed[action];
  if (action.startsWith('dorm_edit.')) {
    const field = action.slice('dorm_edit.'.length).replace(/_/g, ' ');
    return `edited dorm ${field}`;
  }
  return `${action.replace(/[._]/g, ' ')} (${targetType})`;
}

/** Hard ceiling on export size; RLS + the silo filter bound the rows anyway. */
const EXPORT_MAX_ROWS = 10_000;
const EXPORT_CHUNK = 1_000;

function csvCell(value: string | null): string {
  const v = value ?? '';
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function downloadBlob(content: string, mime: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const TARGET_LABELS: Record<string, string> = {
  profile: 'admin account',
  admin_invitation: 'invitation',
  master_housing: 'dorm record',
  universities: 'university',
  marketplace_listing: 'marketplace listing',
  roommate_post: 'roommate post',
  building_chat_link: 'chat link',
  user: 'user account',
  seller_rating: 'seller rating',
};

export default function ActivityPage() {
  const { user, isAdmin, isSuperAdmin, isLoading: authLoading, profileLoaded } = useAuth();
  const { siloUniversityId, effectiveIsSuperAdmin } = useAdminUniversitySilo();
  const [page, setPage] = useState(0);
  // Superadmin: explicit silo filter (RLS shows them every school otherwise).
  // University_admin: the audit-log RLS policy already scopes to their school.
  const siloFilter = isSuperAdmin ? siloUniversityId : null;
  const [actionFilter, setActionFilter] = useState<ActionFilterKey>('all');
  const [actorFilter, setActorFilter] = useState<string>('all');
  const [sinceDays, setSinceDays] = useState<number>(0);
  const [exporting, setExporting] = useState<'csv' | 'json' | null>(null);

  const resetPageAnd = <T,>(setter: (v: T) => void) => (v: T) => {
    setPage(0);
    setter(v);
  };

  const query = useQuery({
    queryKey: ['admin-activity', page, siloUniversityId, actionFilter, actorFilter, sinceDays],
    enabled: !authLoading && !!user && isAdmin === true && (!isSuperAdmin || !!siloUniversityId),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ rows: AuditRow[]; actors: ActorMap; total: number }> => {
      const from = page * PAGE_SIZE;
      let q = supabase
        .from('admin_audit_log')
        .select('id, actor_id, action, target_type, target_id, university_id, created_at', { count: 'exact' });
      if (actionFilter === 'dorm') q = q.like('action', 'dorm_edit.%');
      else if (actionFilter === 'reports') q = q.in('action', ['dismiss_report', 'delete_content']);
      else if (actionFilter === 'team') q = q.like('action', 'admin.%');
      else if (actionFilter === 'resources') q = q.like('action', 'resource.%');
      if (actorFilter !== 'all') q = q.eq('actor_id', actorFilter);
      if (sinceDays > 0) {
        q = q.gte('created_at', new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString());
      }
      if (siloFilter) q = q.eq('university_id', siloFilter);
      const { data, error, count } = await q
        .order('created_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      const rows = (data ?? []) as AuditRow[];

      const actorIds = [...new Set(rows.map((r) => r.actor_id))];
      const actors: ActorMap = {};
      if (actorIds.length > 0) {
        // Admin names via the scoped team RPC (profiles SELECT is self-only).
        // No silo param here: an actor can be a superadmin outside the silo,
        // and the RPC is clamped server-side for non-superadmins anyway.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not yet in generated types (migration 20260721000000)
        const { data: admins } = await (supabase as any).rpc('get_university_admins');
        for (const a of (admins ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
          actors[a.id] = a.full_name || a.email || 'An admin';
        }
      }
      return { rows, actors, total: count ?? rows.length };
    },
  });

  /**
   * Export the audit log (current filters, all pages) as CSV or JSON.
   * Tenant isolation is the same as the feed: RLS scopes university_admins,
   * and the superadmin silo filter is applied explicitly. The export itself
   * is an audited action.
   */
  const handleExport = async (format: 'csv' | 'json') => {
    if (exporting) return;
    setExporting(format);
    try {
      const all: AuditRow[] = [];
      for (let from = 0; from < EXPORT_MAX_ROWS; from += EXPORT_CHUNK) {
        let q = supabase
          .from('admin_audit_log')
          .select('id, actor_id, action, target_type, target_id, university_id, created_at');
        if (actionFilter === 'dorm') q = q.like('action', 'dorm_edit.%');
        else if (actionFilter === 'reports') q = q.in('action', ['dismiss_report', 'delete_content']);
        else if (actionFilter === 'team') q = q.like('action', 'admin.%');
        else if (actionFilter === 'resources') q = q.like('action', 'resource.%');
        if (actorFilter !== 'all') q = q.eq('actor_id', actorFilter);
        if (sinceDays > 0) {
          q = q.gte('created_at', new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString());
        }
        if (siloFilter) q = q.eq('university_id', siloFilter);
        const { data, error } = await q
          .order('created_at', { ascending: false })
          .range(from, from + EXPORT_CHUNK - 1);
        if (error) throw error;
        const chunk = (data ?? []) as AuditRow[];
        all.push(...chunk);
        if (chunk.length < EXPORT_CHUNK) break;
      }

      const actors = query.data?.actors ?? {};
      const stamp = new Date().toISOString().slice(0, 10);
      if (format === 'csv') {
        const header = 'id,created_at,actor_id,actor_name,action,target_type,target_id,university_id';
        const lines = all.map((r) =>
          [r.id, r.created_at, r.actor_id, actors[r.actor_id] ?? '', r.action, r.target_type, r.target_id, r.university_id]
            .map((v) => csvCell(v ?? null))
            .join(','),
        );
        downloadBlob([header, ...lines].join('\n'), 'text/csv;charset=utf-8', `dormcheck-audit-log-${stamp}.csv`);
      } else {
        const rowsWithNames = all.map((r) => ({ ...r, actor_name: actors[r.actor_id] ?? null }));
        downloadBlob(JSON.stringify(rowsWithNames, null, 2), 'application/json', `dormcheck-audit-log-${stamp}.json`);
      }

      await logAdminAction('export.audit_log', 'admin_audit_log', null, siloFilter ?? undefined);
      toast.success('Export ready', {
        description:
          all.length >= EXPORT_MAX_ROWS
            ? `Downloaded the ${EXPORT_MAX_ROWS.toLocaleString()} most recent entries (limit reached). Narrow the date filter for older rows.`
            : `Downloaded ${all.length.toLocaleString()} audit entries.`,
      });
    } catch {
      toast.error('Export failed', { description: 'Please try again.' });
    } finally {
      setExporting(null);
    }
  };

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

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-background">
      <PageContainer width="wide" className="px-4 sm:px-6 py-6 pb-16 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-malachite-600/15 flex items-center justify-center shrink-0">
            <History className="w-5 h-5 text-malachite-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Activity</h1>
            <p className="text-sm text-muted-foreground">
              {effectiveIsSuperAdmin
                ? 'Every admin action in this school, newest first.'
                : 'Admin actions for your school, newest first.'}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport('csv')}
              disabled={exporting !== null}
            >
              {exporting === 'csv' ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <Download className="h-4 w-4 mr-1.5" />
              )}
              CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport('json')}
              disabled={exporting !== null}
            >
              {exporting === 'json' ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <Download className="h-4 w-4 mr-1.5" />
              )}
              JSON
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by action type">
            {ACTION_FILTERS.map((f) => (
              <FilterChip
                key={f.key}
                label={f.label}
                active={actionFilter === f.key}
                onClick={() => resetPageAnd(setActionFilter)(f.key)}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by date">
            {DATE_FILTERS.map((f) => (
              <FilterChip
                key={f.key}
                label={f.label}
                active={sinceDays === f.key}
                onClick={() => resetPageAnd(setSinceDays)(f.key)}
              />
            ))}
            <label className="ml-auto flex items-center gap-2 text-xs font-medium text-muted-foreground">
              Admin
              <select
                value={actorFilter}
                onChange={(e) => resetPageAnd(setActorFilter)(e.target.value)}
                className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600"
              >
                <option value="all">All admins</option>
                {Object.entries(query.data?.actors ?? {}).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <section className="rounded-xl border border-border bg-card shadow-raised overflow-hidden">
          {query.isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading activity" />
            </div>
          ) : query.isError ? (
            <div className="px-4 py-6 text-center text-sm text-foreground">Couldn't load activity.</div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              {actionFilter !== 'all' || actorFilter !== 'all' || sinceDays > 0
                ? 'Nothing matches the current filters.'
                : 'No admin activity recorded yet. Actions like dorm edits, report decisions, and team changes will appear here.'}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <li key={row.id} className="px-4 py-3 flex items-baseline justify-between gap-4">
                  <p className="text-sm text-foreground">
                    <span className="font-medium">{query.data?.actors[row.actor_id] ?? 'An admin'}</span>{' '}
                    {describeAction(row.action, row.target_type)}
                    {TARGET_LABELS[row.target_type] && !row.action.startsWith('dorm_edit.') ? (
                      <span className="text-muted-foreground"> · {TARGET_LABELS[row.target_type]}</span>
                    ) : null}
                  </p>
                  <time
                    dateTime={row.created_at}
                    className="text-xs text-muted-foreground whitespace-nowrap"
                    title={new Date(row.created_at).toLocaleString()}
                  >
                    {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>

        {totalPages > 1 && (
          <nav className="flex items-center justify-between" aria-label="Activity pagination">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Newer
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Older
            </Button>
          </nav>
        )}
      </PageContainer>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1',
        active
          ? 'border-malachite-600 bg-malachite-50 text-malachite-800'
          : 'border-border bg-card text-stone-600 hover:bg-stone-100',
      )}
    >
      {label}
    </button>
  );
}
