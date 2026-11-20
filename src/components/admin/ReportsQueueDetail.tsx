import { formatDistanceToNow } from 'date-fns';
import { ArrowLeft, ArrowUpRight, Check, ExternalLink, EyeOff } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { REPORT_CATEGORY_LABELS, type ReportCategory } from '@/hooks/useContentReports';
import {
  TYPE_ICONS,
  TYPE_LABELS,
  type UnifiedReport,
} from '@/components/admin/reportsQueue';

/**
 * Right pane of the Reports Queue inbox: the flagged content, reporter
 * context, and the inline Approve / Hide actions. Actions are optimistic with
 * an undo window; ReportsPage owns that machinery.
 */
export function ReportsQueueDetail({
  report,
  title,
  reportedUser,
  onApprove,
  onHide,
  onEscalate,
  onBack,
  actionsDisabled,
}: {
  report: UnifiedReport;
  title: string;
  reportedUser?: { full_name: string | null; avatar_url: string | null };
  onApprove: () => void;
  onHide: () => void;
  /** Hand the report to DormCheck (superadmin triage); absent for superadmins,
   *  legacy chat-link reports, and already-escalated rows. */
  onEscalate?: () => void;
  /** Mobile single-pane: return to the list. Hidden at md+. */
  onBack: () => void;
  actionsDisabled: boolean;
}) {
  const Icon = TYPE_ICONS[report.content_type];
  const canHide = report.content_type !== 'user';

  return (
    <div
      role="region"
      aria-label={`Report details: ${title}`}
      className="flex min-h-0 flex-col overflow-y-auto"
    >
      <div className="flex items-center gap-2 px-4 pt-4 md:hidden">
        <Button type="button" variant="ghost" size="icon" onClick={onBack} aria-label="Back to reports list">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <span className="text-sm font-semibold text-stone-600">Back to queue</span>
      </div>

      {/* Flagged content */}
      <div className="px-5 pt-5">
        <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-raised">
          <div className="flex items-start gap-3">
            {report.content_type === 'user' && reportedUser?.avatar_url ? (
              <Avatar className="h-10 w-10 shrink-0">
                <AvatarImage src={reportedUser.avatar_url} alt={title} />
                <AvatarFallback>{title.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
            ) : (
              <div className="shrink-0 rounded-lg bg-stone-100 p-2">
                <Icon className="h-5 w-5 text-stone-500" aria-hidden />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">
                  {TYPE_LABELS[report.content_type]}
                </span>
                {report.content_context && (
                  <span className="text-xs text-stone-500">{report.content_context}</span>
                )}
              </div>
              <p className="mt-1 text-base font-semibold text-stone-900">{title}</p>
              {report.preview_body && (
                <p className="mt-1 break-words text-sm text-stone-600">{report.preview_body}</p>
              )}
              {report.content_type === 'building_chat_link' && report.preview_body && (
                <Button type="button" variant="outline" size="sm" className="mt-3" asChild>
                  <a href={report.preview_body} target="_blank" rel="noopener noreferrer">
                    Open link <ExternalLink className="ml-1 h-3.5 w-3.5" aria-hidden />
                  </a>
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Reporter context */}
      <div className="px-5 pt-4">
        <h3 className="text-xs font-extrabold uppercase tracking-[0.12em] text-stone-500">Report</h3>
        <div className="mt-2 rounded-xl border border-stone-200 bg-white p-4 shadow-raised">
          <div className="flex items-center gap-2 text-xs text-stone-500">
            <span className="font-medium text-stone-900">
              {report.reporter_name ?? 'Unknown reporter'}
            </span>
            <span aria-hidden>·</span>
            <span>{formatDistanceToNow(new Date(report.reported_at), { addSuffix: true })}</span>
          </div>
          {report.category ? (
            <Badge variant="secondary" className="mt-2">
              {REPORT_CATEGORY_LABELS[report.category as ReportCategory] ?? report.category}
            </Badge>
          ) : null}
          {report.escalated_at ? (
            <Badge className="mt-2 ml-1.5 bg-amber-100 text-amber-800 hover:bg-amber-100">
              Escalated to DormCheck
            </Badge>
          ) : null}
          <p className="mt-1 text-sm text-stone-900">
            {report.reason?.trim() ? (
              report.reason
            ) : (
              <span className="italic text-stone-500">No reason provided</span>
            )}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-stone-200 bg-white px-5 py-4">
        {onEscalate && (
          <Button
            type="button"
            variant="outline"
            onClick={onEscalate}
            disabled={actionsDisabled}
            className="mr-auto"
          >
            <ArrowUpRight className="mr-1.5 h-4 w-4" aria-hidden />
            Escalate to DormCheck
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={onApprove}
          disabled={actionsDisabled}
        >
          <Check className="mr-1.5 h-4 w-4" aria-hidden />
          Approve (keep visible)
        </Button>
        {canHide && (
          <Button
            type="button"
            onClick={onHide}
            disabled={actionsDisabled}
            className="bg-malachite-800 text-white hover:bg-malachite-900"
          >
            <EyeOff className="mr-1.5 h-4 w-4" aria-hidden />
            Hide
          </Button>
        )}
      </div>
      <p className="px-5 pb-4 pt-2 text-right text-xs text-stone-600">
        Shortcuts: j/k to move, a to approve, h to hide
      </p>
    </div>
  );
}
