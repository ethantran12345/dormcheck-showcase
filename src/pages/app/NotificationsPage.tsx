import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, BellOff } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/card';
import { useNotifications } from '@/hooks/useNotifications';
import { NotificationItem } from '@/components/notifications/NotificationItem';
import { PageContainer } from '@/components/ui/page-container';

/**
 * The in-app notification center (`/notifications`). Native users have no
 * desktop bell dropdown, so this is where every persisted notification is read.
 *
 * Opening the center counts as seeing them: on mount we mark all read (which
 * also clears the stuck iOS app-icon badge via clearAppBadge in the hook), so
 * the count resets everywhere. New rows that stream in while the page is open
 * re-surface the "Mark all read" button.
 */
export default function NotificationsPage() {
  const { t } = useTranslation();
  const { notifications, unreadNotificationCount, markAllRead } = useNotifications({ limit: 50 });
  const didMarkOnOpen = useRef(false);

  useEffect(() => {
    if (didMarkOnOpen.current) return;
    didMarkOnOpen.current = true;
    void markAllRead();
  }, [markAllRead]);

  const isEmpty = notifications.length === 0;

  return (
    <PageContainer width="content" className="space-y-5 px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-malachite-600/15">
            <Bell className="h-5 w-5 text-malachite-600" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{t('misc:notifications.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('misc:notifications.pageSubtitle')}</p>
          </div>
        </div>
        {unreadNotificationCount > 0 && (
          <button
            type="button"
            onClick={() => void markAllRead()}
            className="shrink-0 rounded-lg px-2 py-1 text-sm font-bold text-malachite-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600"
          >
            {t('misc:notifications.markAllRead')}
          </button>
        )}
      </header>

      {isEmpty ? (
        <Card className="rounded-2xl border-border">
          <EmptyState
            icon={BellOff}
            title={t('misc:notifications.allCaughtUp')}
            description={t('misc:notifications.emptyHint')}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden rounded-2xl border-border p-1">
          {notifications.map((n) => (
            <NotificationItem key={n.id} notification={n} />
          ))}
        </Card>
      )}
    </PageContainer>
  );
}
