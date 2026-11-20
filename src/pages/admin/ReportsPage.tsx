import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAdminUniversitySilo } from '@/contexts/AdminUniversityContext';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import type { PostgrestError } from '@supabase/supabase-js';
import { cn } from '@/lib/utils';
import { logAdminAction } from '@/lib/adminAudit';
import { apiPost } from '@/lib/apiPost';
import {
  reportKey,
  type FilterValue,
  type ReportableContentType,
  type UnifiedReport,
} from '@/components/admin/reportsQueue';
import { ReportsQueueList } from '@/components/admin/ReportsQueueList';
import { ReportsQueueDetail } from '@/components/admin/ReportsQueueDetail';
import { AutoHeldListingsPanel } from '@/components/admin/AutoHeldListingsPanel';
import { matchesShortcut } from '@/lib/shortcuts';

/**
 * Reports Queue: two-pane moderation inbox (list left, detail right at md+;
 * single-pane list -> detail below md). Actions are Approve (keep visible,
 * clears the reports) and Hide (soft-hides listings via status='under_review';
 * hard-deletes content types with no status column). Both are optimistic: the
 * row leaves the queue immediately, an undo toast opens a 5s window, and the
 * database write only fires when the window closes.
 */

type QueueAction = 'approve' | 'hide';

const UNDO_WINDOW_MS = 5_000;

type LegacyReportQueryRow = {
  id: string;
  reporter_id: string;
  reason: string | null;
  created_at: string;
  link: {
    id: string;
    url: string;
    platform: string;
    label: string | null;
    building_id: number;
    submitted_by: string | null;
    university_id: string | null;
  };
};

export default function ReportsPage() {
  const queryClient = useQueryClient();
  const { user, isAdmin, isSuperAdmin, universityId } = useAuth();
  const { siloUniversityId } = useAdminUniversitySilo();
  // Superadmin: explicit silo filter (RLS lets them see everything otherwise).
  // University_admin: null - the RPC clamps them to their own school and the
  // legacy chat-link join is scoped by the parent link's tenant RLS.
  const siloFilter = isSuperAdmin ? siloUniversityId : null;
  const queriesEnabled = !!isAdmin && (!isSuperAdmin || !!siloUniversityId);
  /** Top-level view: the reports inbox vs. the auto-moderator's held queue. */
  const [view, setView] = useState<'reports' | 'held'>('reports');
  const [filter, setFilter] = useState<FilterValue>('all');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /** Keys optimistically removed from the queue (undo window open or write in flight). */
  const [removedKeys, setRemovedKeys] = useState<ReadonlySet<string>>(new Set());
  const undoTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** Mobile only: whether the detail pane is showing (list -> detail flow). */
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  // Query 1: content_reports via RPC (p_university_id is clamped server-side:
  // honored for superadmins, ignored for everyone else)
  const contentReportsQuery = useQuery({
    queryKey: ['admin-content-reports', filter, siloUniversityId],
    queryFn: async (): Promise<UnifiedReport[]> => {
      const typeFilter = filter === 'all' ? null : filter === 'building_chat_link' ? null : filter;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC param not yet in generated types (migration 20260728000000)
      const { data, error } = await (supabase as any).rpc('get_content_reports', {
        content_type_filter: typeFilter,
        p_university_id: siloFilter,
      });
      if (error) throw error;
      return (data ?? []).map((r): UnifiedReport => ({
        report_id: r.report_id,
        content_type: r.content_type as ReportableContentType,
        content_id: r.content_id,
        reporter_id: r.reporter_id,
        reporter_name: r.reporter_name,
        reason: r.reason,
        category: r.category ?? null,
        escalated_at: r.escalated_at ?? null,
        reported_at: r.reported_at,
        preview_title: r.content_preview_title,
        preview_body: r.content_preview_body,
        content_owner_id: r.content_owner_id,
        content_context: r.content_context,
        source: 'content_reports',
      }));
    },
    enabled: queriesEnabled,
    staleTime: 15_000,
  });

  // Query 2: legacy building_chat_link_reports
  // Only fetch when filter is 'all' or 'building_chat_link'
  const legacyReportsQuery = useQuery({
    queryKey: ['admin-legacy-chat-link-reports', filter, siloUniversityId],
    queryFn: async (): Promise<UnifiedReport[]> => {
      let legacyQuery = supabase
        .from('building_chat_link_reports')
        .select(`
          id,
          reporter_id,
          reason,
          created_at,
          link:building_chat_links!inner(
            id,
            url,
            platform,
            label,
            building_id,
            submitted_by,
            university_id
          )
        `)
        .order('created_at', { ascending: false });
      // Superadmin silo: scope through the parent link's school. University
      // admins are already scoped by building_chat_links tenant RLS.
      if (siloFilter) legacyQuery = legacyQuery.eq('building_chat_links.university_id', siloFilter);
      const { data, error } = await legacyQuery;

      if (error) throw error;
      const rows = (data ?? []) as unknown as LegacyReportQueryRow[];
      if (rows.length === 0) return [];

      const reporterIds = Array.from(new Set(rows.map((r) => r.reporter_id)));
      const buildingIds = Array.from(
        new Set(rows.map((r) => r.link.building_id).filter((id): id is number => id != null)),
      );

      const [profilesRes, housingRes] = await Promise.all([
        reporterIds.length > 0
          ? supabase.from('public_profiles').select('id, full_name').in('id', reporterIds)
          : Promise.resolve({ data: [] as { id: string; full_name: string | null }[], error: null }),
        buildingIds.length > 0
          ? supabase.from('master_housing').select('id, residence_hall').in('id', buildingIds)
          : Promise.resolve({ data: [] as { id: number; residence_hall: string | null }[], error: null }),
      ]);

      if (profilesRes.error) throw profilesRes.error;
      if (housingRes.error) throw housingRes.error;

      const profileMap = new Map(
        (profilesRes.data ?? []).map((p) => [p.id, p.full_name] as const),
      );
      const housingMap = new Map(
        (housingRes.data ?? []).map((h) => [h.id, h.residence_hall] as const),
      );

      return rows.map((r): UnifiedReport => {
        const link = r.link;
        return {
          report_id: r.id,
          content_type: 'building_chat_link',
          content_id: link.id,
          reporter_id: r.reporter_id,
          reporter_name: profileMap.get(r.reporter_id) ?? null,
          reason: r.reason,
          category: null,
          escalated_at: null,
          reported_at: r.created_at,
          preview_title: link.label ?? 'Chat link',
          preview_body: link.url,
          content_owner_id: link.submitted_by,
          content_context: housingMap.get(link.building_id) ?? null,
          source: 'building_chat_link_reports',
        };
      });
    },
    enabled: queriesEnabled && (filter === 'all' || filter === 'building_chat_link'),
    staleTime: 15_000,
  });

  // Merge, filter, and drop rows optimistically removed by Approve/Hide
  const visibleReports = useMemo<UnifiedReport[]>(() => {
    const contentR = contentReportsQuery.data ?? [];
    const legacyR = legacyReportsQuery.data ?? [];
    let merged = [...contentR, ...legacyR];
    if (filter !== 'all') {
      merged = merged.filter((r) => r.content_type === filter);
    }
    merged = merged.filter((r) => !removedKeys.has(reportKey(r)));
    // Escalated reports move to superadmin triage: they leave the
    // university_admin queue and stay visible (badged) for superadmins.
    if (!isSuperAdmin) merged = merged.filter((r) => !r.escalated_at);
    // SLA ordering: oldest open report first, so nothing quietly ages out of view.
    merged.sort((a, b) => new Date(a.reported_at).getTime() - new Date(b.reported_at).getTime());
    return merged;
  }, [contentReportsQuery.data, legacyReportsQuery.data, filter, removedKeys, isSuperAdmin]);

  const reportedUserIds = useMemo(() => {
    const ids = new Set<string>();
    for (const report of visibleReports) {
      if (report.content_type === 'user') ids.add(report.content_id);
    }
    return Array.from(ids);
  }, [visibleReports]);

  const reportedUsersQuery = useQuery({
    queryKey: ['admin-reported-user-profiles', reportedUserIds],
    queryFn: async (): Promise<Map<string, { full_name: string | null; avatar_url: string | null }>> => {
      const { data, error } = await supabase
        .from('public_profiles')
        .select('id, full_name, avatar_url')
        .in('id', reportedUserIds);
      if (error) throw error;
      return new Map(
        (data ?? []).map((p) => [p.id, { full_name: p.full_name, avatar_url: p.avatar_url }] as const),
      );
    },
    enabled: !!isAdmin && reportedUserIds.length > 0,
    staleTime: 15_000,
  });

  const reportedUsersData = reportedUsersQuery.data;
  const reportedUsersMap = useMemo(
    () => reportedUsersData ?? new Map<string, { full_name: string | null; avatar_url: string | null }>(),
    [reportedUsersData],
  );

  const getReportTitle = useCallback(
    (report: UnifiedReport): string => {
      if (report.content_type === 'user') {
        const profile = reportedUsersMap.get(report.content_id);
        const name = profile?.full_name?.trim();
        if (name) return name;
        return report.content_id.slice(0, 8) || 'User';
      }
      return report.preview_title || 'Untitled';
    },
    [reportedUsersMap],
  );

  const isLoading = contentReportsQuery.isLoading || legacyReportsQuery.isLoading;
  const error = contentReportsQuery.error ?? legacyReportsQuery.error;

  const selectedReport =
    visibleReports.find((r) => reportKey(r) === selectedKey) ?? visibleReports[0] ?? null;

  // Keep selectedKey pointing at a real row (first row by default, e.g. after
  // the selected report is actioned away or the filter changes).
  useEffect(() => {
    const first = visibleReports[0];
    if (!selectedKey || !visibleReports.some((r) => reportKey(r) === selectedKey)) {
      setSelectedKey(first ? reportKey(first) : null);
    }
  }, [visibleReports, selectedKey]);

  // Mutations

  // Append-only moderation audit trail. The moderation action itself is the
  // source of truth; there is no client-side transaction, so a transient audit
  // failure is logged but does not block or reverse the action. Every action
  // dual-writes both trails: moderation_actions (legacy, content-scoped) and
  // admin_audit_log (tiered RBAC, university-scoped — for the University Partner
  // Console). The moderation_actions action CHECK allows dismiss_report /
  // delete_content / restore_listing only, so Approve logs dismiss_report and
  // Hide logs delete_content (with a reason note when soft-hidden rather than
  // deleted). moderation_actions is not yet in the generated Supabase types
  // (migration 20260630010000); the `as any` goes when types regenerate.
  const logModerationAction = async (
    report: UnifiedReport,
    action: 'dismiss_report' | 'delete_content' | 'escalate_report',
    reason: string | null = null,
  ): Promise<void> => {
    if (!user?.id) return;
    const row = {
      admin_id: user.id,
      action,
      content_type: report.content_type,
      content_id: report.content_id,
      report_id: report.report_id,
      reason,
    };
    // reporter_id (migration 20260712100000) feeds the reporter-feedback
    // notification trigger; retry without it if prod lacks the column yet
    // (PGRST204) so the audit row itself is never lost.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- moderation_actions not yet in generated types (migration 20260630010000)
    const table = () => (supabase as any).from('moderation_actions');
    let { error: auditErr } = await table().insert({ ...row, reporter_id: report.reporter_id });
    if (auditErr?.code === 'PGRST204') {
      ({ error: auditErr } = await table().insert(row));
    }
    if (auditErr) console.error('[moderation audit] failed to log', action, auditErr);

    await logAdminAction(action, report.content_type, report.content_id, universityId);
  };

  const clearReportRows = async (report: UnifiedReport): Promise<void> => {
    if (report.source === 'building_chat_link_reports') {
      const { error: delErr } = await supabase
        .from('building_chat_link_reports')
        .delete()
        .eq('link_id', report.content_id);
      if (delErr) throw delErr;
    } else {
      const { error: delErr } = await supabase
        .from('content_reports')
        .delete()
        .eq('content_type', report.content_type)
        .eq('content_id', report.content_id);
      if (delErr) throw delErr;
    }
  };

  // Approve (keep visible): clear the report rows; restore auto-hidden listings.
  const approveMutation = useMutation({
    mutationFn: async (report: UnifiedReport): Promise<void> => {
      await clearReportRows(report);
      // If reports had auto-hidden this listing, approving restores it to the feed.
      if (report.source === 'content_reports' && report.content_type === 'marketplace_listing') {
        // .select() so we know whether a hidden listing actually came back -
        // only a real restore emails the seller "your listing is live".
        const { data: restored, error: restoreErr } = await supabase
          .from('marketplace_listings')
          .update({ status: 'available' })
          .eq('id', report.content_id)
          .eq('status', 'under_review')
          .select('id');
        if (restoreErr) throw restoreErr;
        if (restored && restored.length > 0) {
          void apiPost('/api/notify-listing-status', {
            listingId: report.content_id,
            action: 'approved',
          }).catch((err) => console.error('notify-listing-status (approved) failed', err));
        }
      }
      await logModerationAction(report, 'dismiss_report');
    },
    onSettled: (_data, _err, report) => finishRemoval(report),
    onError: (e: Error) => {
      toast.error('Could not approve', { description: e.message });
    },
  });

  // Escalate to DormCheck (P1.8): the report row stays (badged for superadmin
  // triage) but leaves the university_admin queue. Not optimistic - it is a
  // one-click handoff with no undo window needed.
  const escalateMutation = useMutation({
    mutationFn: async (report: UnifiedReport): Promise<void> => {
      if (!user?.id || report.source !== 'content_reports') return;
      const { error } = await supabase
        .from('content_reports')
        .update({ escalated_at: new Date().toISOString(), escalated_by: user.id } as never)
        .eq('id', report.report_id);
      if (error) throw error;
      await logModerationAction(report, 'escalate_report');
      toast('Escalated to DormCheck', { description: 'The DormCheck team will review this report.' });
    },
    onSettled: (_data, _err, report) => finishRemoval(report),
    onError: (e: Error) => {
      toast.error('Could not escalate', { description: e.message });
    },
  });

  // Hide: soft-hide listings (status flip students cannot undo); hard-delete
  // content types that have no status column. The undo window has already
  // passed by the time this runs.
  const hideMutation = useMutation({
    mutationFn: async (report: UnifiedReport): Promise<void> => {
      if (report.content_type === 'marketplace_listing') {
        // .select() so an RLS zero-row no-op surfaces as an error instead of a
        // false "Hidden" toast (requires the own-or-admin UPDATE policy from
        // migration 20260715000000).
        const { data: hidden, error: hideErr } = await supabase
          .from('marketplace_listings')
          .update({ status: 'under_review' })
          .eq('id', report.content_id)
          .select('id');
        if (hideErr) throw hideErr;
        if (!hidden || hidden.length === 0) {
          throw new Error('Listing was not updated (missing admin permission or already removed).');
        }
        await clearReportRows(report);
        await logModerationAction(
          report,
          'delete_content',
          'soft-hide: listing status set to under_review (content preserved)',
        );
        // Seller-trust email: an admin removal is a rejection, not a silent
        // disappearance. Fire-and-forget; the moderation write already landed.
        void apiPost('/api/notify-listing-status', {
          listingId: report.content_id,
          action: 'rejected',
        }).catch((err) => console.error('notify-listing-status (rejected) failed', err));
        return;
      }

      let delError: PostgrestError | null = null;
      switch (report.content_type) {
        case 'roommate_post': {
          const { error } = await supabase.from('roommate_search_posts').delete().eq('id', report.content_id);
          delError = error;
          break;
        }
        case 'building_chat_link': {
          const { error } = await supabase.from('building_chat_links').delete().eq('id', report.content_id);
          delError = error;
          break;
        }
        case 'seller_rating': {
          const { error } = await supabase.from('seller_ratings').delete().eq('id', report.content_id);
          delError = error;
          break;
        }
        case 'group_message': {
          // Hard delete via the RA/admin-gated RPC (migration 20260816000000);
          // types.ts lags, hence the cast.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not yet in generated types
          const { error } = await (supabase as any).rpc('delete_group_message', {
            p_message_id: report.content_id,
          });
          delError = error;
          break;
        }
        case 'dm_message': {
          // There is no delete path for a DM yet: `delete_group_message` is
          // group-scoped, and a unilateral admin delete inside a private
          // 1:1 thread is a bigger policy call than this queue should make.
          // Failing loudly beats falling through the switch, which would clear
          // the report row and report success without deleting anything.
          throw new Error(
            'Direct messages cannot be deleted from here yet. Act on the sender (report the user) or escalate.',
          );
        }
        case 'student_setup': {
          // Soft-hide: keep the row (audit trail) but drop it from every
          // gallery query via the is_hidden moderation flag.
          const { error } = await supabase
            .from('student_setups')
            .update({ is_hidden: true })
            .eq('id', Number(report.content_id));
          delError = error;
          break;
        }
      }
      if (delError) throw delError;

      if (report.source === 'content_reports') {
        await clearReportRows(report);
      }
      await logModerationAction(report, 'delete_content');
    },
    onSettled: (_data, _err, report) => finishRemoval(report),
    onError: (e: Error) => {
      toast.error('Could not hide content', { description: e.message });
    },
  });

  /** After the write settles: refetch queues + badge and drop the local tombstone. */
  const finishRemoval = (report: UnifiedReport | undefined) => {
    void queryClient
      .invalidateQueries({ queryKey: ['admin-content-reports'] })
      .then(() => queryClient.invalidateQueries({ queryKey: ['admin-legacy-chat-link-reports'] }))
      .then(() => queryClient.invalidateQueries({ queryKey: ['admin-pending-reports-count'] }))
      .then(() => queryClient.invalidateQueries({ queryKey: ['building-chat-links'] }))
      .then(() => {
        if (!report) return;
        const key = reportKey(report);
        undoTimersRef.current.delete(key);
        setRemovedKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      });
  };

  const undoRemoval = useCallback((key: string) => {
    const timer = undoTimersRef.current.get(key);
    if (!timer) return; // window already closed, write is committed
    clearTimeout(timer);
    undoTimersRef.current.delete(key);
    setRemovedKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setSelectedKey(key);
  }, []);

  /**
   * Optimistic action: remove the row from the queue now, advance selection,
   * and only fire the database write once the 5s undo window closes.
   */
  const queueAction = useCallback(
    (report: UnifiedReport, action: QueueAction) => {
      if (action === 'hide' && report.content_type === 'user') return;
      const key = reportKey(report);
      if (removedKeys.has(key)) return;

      // Auto-advance: next item after this one, else the previous one.
      const idx = visibleReports.findIndex((r) => reportKey(r) === key);
      const next = visibleReports[idx + 1] ?? visibleReports[idx - 1] ?? null;
      setSelectedKey(next ? reportKey(next) : null);
      if (!next) setMobileDetailOpen(false);

      setRemovedKeys((prev) => new Set(prev).add(key));
      const timer = setTimeout(() => {
        if (action === 'approve') approveMutation.mutate(report);
        else hideMutation.mutate(report);
      }, UNDO_WINDOW_MS);
      undoTimersRef.current.set(key, timer);

      toast(action === 'approve' ? 'Approved' : 'Hidden', {
        description:
          action === 'approve'
            ? 'Content stays visible; reports cleared.'
            : 'The content is no longer visible to students.',
        action: {
          label: 'Undo',
          onClick: () => undoRemoval(key),
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutations are stable
    [removedKeys, visibleReports, undoRemoval],
  );

  // Flush pending writes if the admin leaves the page before a window closes,
  // so an action taken is never silently lost.
  const queueActionRef = useRef<{ approve: typeof approveMutation.mutate; hide: typeof hideMutation.mutate; reports: UnifiedReport[] } | undefined>(undefined);
  queueActionRef.current = {
    approve: approveMutation.mutate,
    hide: hideMutation.mutate,
    reports: [...(contentReportsQuery.data ?? []), ...(legacyReportsQuery.data ?? [])],
  };
  const pendingActionsRef = useRef(new Map<string, { report: UnifiedReport; action: QueueAction }>());
  useEffect(() => {
    const timers = undoTimersRef.current;
    const pending = pendingActionsRef.current;
    return () => {
      for (const [key, timer] of timers) {
        clearTimeout(timer);
        const entry = pending.get(key);
        if (entry) {
          if (entry.action === 'approve') queueActionRef.current?.approve(entry.report);
          else queueActionRef.current?.hide(entry.report);
        }
      }
      timers.clear();
      pending.clear();
    };
  }, []);
  // Track what each open timer would do, for the unmount flush above.
  const queueActionTracked = useCallback(
    (report: UnifiedReport, action: QueueAction) => {
      pendingActionsRef.current.set(reportKey(report), { report, action });
      queueAction(report, action);
    },
    [queueAction],
  );

  // Keyboard nav: j/k move, a approve, h hide — keys from the shortcut registry
  // (src/lib/shortcuts.ts), so the "?" sheet lists exactly these. Skips when focus
  // is in a form control or a dialog; the matcher rejects modifier chords.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.closest('input, textarea, select, [contenteditable="true"]') ||
          target.closest('[role="dialog"]'))
      ) {
        return;
      }
      const current = visibleReports.findIndex(
        (r) => reportKey(r) === (selectedReport ? reportKey(selectedReport) : null),
      );
      const next = matchesShortcut(e, 'reportsNext');
      if (next || matchesShortcut(e, 'reportsPrev')) {
        const nextIdx = next ? current + 1 : current - 1;
        const target = visibleReports[nextIdx];
        if (target) setSelectedKey(reportKey(target));
        e.preventDefault();
      } else if (matchesShortcut(e, 'reportsApprove') && selectedReport) {
        queueActionTracked(selectedReport, 'approve');
        e.preventDefault();
      } else if (matchesShortcut(e, 'reportsHide') && selectedReport && selectedReport.content_type !== 'user') {
        queueActionTracked(selectedReport, 'hide');
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visibleReports, selectedReport, queueActionTracked]);

  const selectedTitle = selectedReport ? getReportTitle(selectedReport) : '';

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col">
      <div className="border-b border-stone-200 bg-white px-5 py-4">
        <h1 className="text-xl font-bold text-stone-900">Reports Queue</h1>
        <p className="text-sm text-stone-500">Flagged content from students.</p>
        <div className="mt-3 inline-flex rounded-lg bg-stone-100 p-0.5" role="tablist" aria-label="Reports view">
          {([
            ['reports', 'Reported'],
            ['held', 'Auto-held'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              onClick={() => setView(value)}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                view === value ? 'bg-white text-stone-900 shadow-raised' : 'text-stone-500 hover:text-stone-700',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === 'held' ? (
        <AutoHeldListingsPanel
          siloUniversityId={siloFilter}
          enabled={queriesEnabled}
          universityId={universityId}
        />
      ) : isLoading ? (
        <div className="flex items-center justify-center py-12 text-stone-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
          Loading reports…
        </div>
      ) : error ? (
        <div className="m-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Could not load reports: {(error as Error).message}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* List pane */}
          <div
            className={cn(
              'min-h-0 w-full flex-col border-r border-stone-200 bg-white md:flex md:w-[360px] md:flex-none',
              mobileDetailOpen && selectedReport ? 'hidden' : 'flex',
            )}
          >
            <ReportsQueueList
              reports={visibleReports}
              filter={filter}
              onFilterChange={setFilter}
              selectedKey={selectedReport ? reportKey(selectedReport) : null}
              onSelect={(key) => {
                setSelectedKey(key);
                setMobileDetailOpen(true);
              }}
              getTitle={getReportTitle}
            />
          </div>

          {/* Detail pane */}
          <div
            className={cn(
              'min-h-0 w-full flex-1 flex-col bg-stone-50 md:flex',
              mobileDetailOpen && selectedReport ? 'flex' : 'hidden',
            )}
          >
            {selectedReport ? (
              <ReportsQueueDetail
                report={selectedReport}
                title={selectedTitle}
                reportedUser={
                  selectedReport.content_type === 'user'
                    ? reportedUsersMap.get(selectedReport.content_id)
                    : undefined
                }
                onApprove={() => queueActionTracked(selectedReport, 'approve')}
                onHide={() => queueActionTracked(selectedReport, 'hide')}
                onEscalate={
                  !isSuperAdmin &&
                  selectedReport.source === 'content_reports' &&
                  !selectedReport.escalated_at
                    ? () => escalateMutation.mutate(selectedReport)
                    : undefined
                }
                onBack={() => setMobileDetailOpen(false)}
                actionsDisabled={
                  approveMutation.isPending || hideMutation.isPending || escalateMutation.isPending
                }
              />
            ) : (
              <div className="hidden flex-1 items-center justify-center text-sm text-stone-600 md:flex">
                Select a report to review it.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
