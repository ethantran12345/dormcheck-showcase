import { Link } from 'react-router';
import { ListChecks, MessageCircle, ShoppingBag } from 'lucide-react';
import type { AppNotification } from '@/lib/notifications';
import { WidgetCard } from './WidgetCard';
import { timeAgo } from './timeAgo';

interface RecentActivityWidgetProps {
  notifications: AppNotification[];
  unreadMessages: number;
  packedItems: number;
  totalItems: number;
  hasChecklistActivity: boolean;
  checklistLoading: boolean;
}

const MARKETPLACE_KINDS = new Set<AppNotification['kind']>([
  'listing',
  'listing-freshness',
  'marketplace-alert',
]);

/**
 * Compact personal activity summary for the current iteration. It reuses the
 * notification and checklist models already loaded by My Home and deliberately
 * returns null when there is nothing meaningful to report.
 */
export function RecentActivityWidget({
  notifications,
  unreadMessages,
  packedItems,
  totalItems,
  hasChecklistActivity,
  checklistLoading,
}: RecentActivityWidgetProps) {
  const marketplaceActivity = notifications.find((item) => MARKETPLACE_KINDS.has(item.kind));
  const hasActivity = unreadMessages > 0 || !!marketplaceActivity || hasChecklistActivity;

  if (checklistLoading || !hasActivity) return null;

  return (
    <WidgetCard title="Recent activity" dense>
      <div className="-mx-2 flex flex-col">
        {unreadMessages > 0 && (
          <ActivityRow
            to="/messages"
            Icon={MessageCircle}
            title={`${unreadMessages} unread ${unreadMessages === 1 ? 'message' : 'messages'}`}
            detail="Open your conversations"
          />
        )}
        {marketplaceActivity && (
          <ActivityRow
            to={marketplaceActivity.to}
            Icon={ShoppingBag}
            title={marketplaceActivity.title}
            detail={timeAgo(marketplaceActivity.createdAt)}
          />
        )}
        {hasChecklistActivity && (
          <ActivityRow
            to="/checklist"
            Icon={ListChecks}
            title={`${packedItems} of ${totalItems} checklist items packed`}
            detail="Keep your checklist moving"
          />
        )}
      </div>
    </WidgetCard>
  );
}

function ActivityRow({
  to,
  Icon,
  title,
  detail,
}: {
  to: string;
  Icon: typeof MessageCircle;
  title: string;
  detail: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-control px-2 py-2.5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-foreground">{title}</span>
        <span className="block truncate text-xs font-medium text-muted-foreground">{detail}</span>
      </span>
    </Link>
  );
}
