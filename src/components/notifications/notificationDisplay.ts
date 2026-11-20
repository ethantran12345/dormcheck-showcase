import type { LucideIcon } from 'lucide-react';
import {
  Bell,
  BellRing,
  Building2,
  Megaphone,
  MessageSquare,
  ShieldCheck,
  Tag,
  UserCheck,
  Users,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { NotificationKind } from '@/lib/notifications';

/**
 * Icon per notification kind, shared by the /notifications center and the home
 * card so a given kind always reads the same. Falls back to a bell for kinds a
 * newer server might ship before this map catches up.
 */
export const NOTIFICATION_KIND_ICON: Record<NotificationKind, LucideIcon> = {
  message: MessageSquare,
  listing: Tag,
  mention: Bell,
  'chat-join': Users,
  'roommate-invited': Users,
  'roommate-confirmed': UserCheck,
  'building-residents': Building2,
  announcement: Megaphone,
  'report-update': ShieldCheck,
  'listing-freshness': Tag,
  'marketplace-alert': BellRing,
};

export function notificationIcon(kind: NotificationKind): LucideIcon {
  return NOTIFICATION_KIND_ICON[kind] ?? Bell;
}

export function notificationRelativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
}
