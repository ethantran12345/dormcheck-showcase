import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import type { AppNotification } from '@/lib/notifications';
import { notificationIcon, notificationRelativeTime } from './notificationDisplay';

interface NotificationItemProps {
  notification: AppNotification;
  /** Fired when the row is tapped, before navigation (e.g. mark-all-read). */
  onNavigate?: () => void;
  className?: string;
}

/**
 * One notification row, tappable through to its deep link (`notification.to`).
 * Shared by the full /notifications center and the /my-home preview card so
 * both render identically. Theme-aware (works pre-auth-light and dark).
 */
export function NotificationItem({ notification, onNavigate, className }: NotificationItemProps) {
  const Icon = notificationIcon(notification.kind);
  return (
    <Link
      to={notification.to}
      onClick={onNavigate}
      className={cn(
        'flex items-start gap-3 rounded-xl px-3 py-3 transition-colors',
        'hover:bg-muted/60 active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600',
        !notification.read && 'bg-primary/5',
        className,
      )}
    >
      <span
        aria-hidden
        className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-full bg-primary/10 text-primary"
      >
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1 leading-snug">
        <span
          className={cn(
            'block text-sm text-foreground',
            notification.read ? 'font-semibold' : 'font-bold',
          )}
        >
          {notification.title}
        </span>
        {notification.body && (
          <span className="mt-0.5 block truncate text-xs font-semibold text-muted-foreground">
            {notification.body}
          </span>
        )}
        <span className="mt-0.5 block text-xs font-medium text-muted-foreground/80">
          {notificationRelativeTime(notification.createdAt)}
        </span>
      </span>
      {!notification.read && (
        <span aria-hidden className="mt-2 h-2 w-2 flex-none rounded-full bg-primary" />
      )}
    </Link>
  );
}
