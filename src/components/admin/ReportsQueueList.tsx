import { formatDistanceToNow } from 'date-fns';
import { Flag } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  FILTER_LABELS,
  TYPE_ICONS,
  TYPE_LABELS,
  reportKey,
  type FilterValue,
  type UnifiedReport,
} from '@/components/admin/reportsQueue';

/**
 * Left pane of the Reports Queue inbox: filter pills + open-report rows,
 * newest first. Selection is owned by ReportsPage (which also drives j/k
 * keyboard nav against the same list).
 */
export function ReportsQueueList({
  reports,
  filter,
  onFilterChange,
  selectedKey,
  onSelect,
  getTitle,
}: {
  reports: UnifiedReport[];
  filter: FilterValue;
  onFilterChange: (f: FilterValue) => void;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  getTitle: (report: UnifiedReport) => string;
}) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap gap-2 px-4 pb-3 pt-4">
        {(Object.keys(FILTER_LABELS) as FilterValue[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onFilterChange(key)}
            aria-pressed={filter === key}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600',
              filter === key
                ? 'bg-malachite-800 text-white'
                : 'border border-stone-200 bg-white text-stone-700 hover:bg-stone-100',
            )}
          >
            {FILTER_LABELS[key]}
          </button>
        ))}
      </div>

      {reports.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-16 text-center">
          <Flag className="mb-3 h-10 w-10 text-stone-300" strokeWidth={1.5} aria-hidden />
          <p className="text-sm font-semibold text-stone-900">
            Queue clear, nothing needs your review.
          </p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Open reports">
          {reports.map((report) => {
            const key = reportKey(report);
            const selected = key === selectedKey;
            const Icon = TYPE_ICONS[report.content_type];
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => onSelect(key)}
                  aria-current={selected ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-start gap-3 border-b border-stone-100 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-malachite-600',
                    selected ? 'bg-malachite-50' : 'hover:bg-stone-50',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 rounded-lg p-1.5',
                      selected ? 'bg-malachite-100' : 'bg-stone-100',
                    )}
                  >
                    <Icon
                      className={cn('h-4 w-4', selected ? 'text-malachite-800' : 'text-stone-500')}
                      aria-hidden
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-stone-500">
                        {TYPE_LABELS[report.content_type]}
                      </span>
                      <OpenForBadge reportedAt={report.reported_at} />
                    </span>
                    <span className="mt-0.5 block truncate text-sm font-semibold text-stone-900">
                      {getTitle(report)}
                    </span>
                    <span className="block truncate text-xs text-stone-500">
                      Reported by {report.reporter_name ?? 'unknown'}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const SLA_AMBER_MS = 48 * 60 * 60 * 1000;

/** Time a report has been open; amber once it crosses the 48h SLA. */
function OpenForBadge({ reportedAt }: { reportedAt: string }) {
  const ageMs = Date.now() - new Date(reportedAt).getTime();
  const overSla = Number.isFinite(ageMs) && ageMs > SLA_AMBER_MS;
  return (
    <span
      className={cn(
        'text-xs',
        overSla
          ? 'inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-800'
          : 'text-stone-600',
      )}
    >
      open {formatDistanceToNow(new Date(reportedAt))}
    </span>
  );
}
