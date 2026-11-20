import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import type { AppNotification } from '@/lib/notifications';
import { NotificationItem } from '@/components/notifications/NotificationItem';
import { WidgetCard } from './WidgetCard';

interface NotificationsWidgetProps {
  notifications: AppNotification[];
  unreadCount: number;
}

const PREVIEW_COUNT = 3;

/**
 * My Home card: the three most recent notifications with an unread count and a
 * link into the full /notifications center. The parent (MyHomePage) already
 * holds the live list via useNotifications and only renders this widget when
 * there's at least one row, so an empty state isn't needed here.
 */
export function NotificationsWidget({ notifications, unreadCount }: NotificationsWidgetProps) {
  const { t } = useTranslation();
  const preview = notifications.slice(0, PREVIEW_COUNT);

  const seeAll = (
    <Link
      to="/notifications"
      className="inline-flex items-center gap-0.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600"
    >
      {t('misc:notifications.seeAll')}
      <ChevronRight className="h-4 w-4" aria-hidden />
    </Link>
  );

  return (
    <WidgetCard
      title={t('misc:notifications.title')}
      action={unreadCount > 0 ? (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1.5 text-[11px] font-extrabold leading-none text-background">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      ) : seeAll}
      dense
    >
      <div className="-mx-3 flex flex-col">
        {preview.map((n) => (
          <NotificationItem key={n.id} notification={n} />
        ))}
      </div>
      <Link
        to="/notifications"
        className="mt-2 inline-flex items-center justify-center gap-0.5 self-start rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 lg:hidden"
      >
        {t('misc:notifications.seeAll')}
        <ChevronRight className="h-4 w-4" aria-hidden />
      </Link>
    </WidgetCard>
  );
}
