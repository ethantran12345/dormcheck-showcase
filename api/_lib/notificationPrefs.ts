// Per-category notification preference gating.
// profiles.email_notifications stays the master email kill-switch;
// notification_prefs jsonb refines it per category. Missing key = enabled.
// Push is intentionally NOT gated by the email master switch.
// Admin and waitlist emails are exempt from all of this - never gate them here.

export const NOTIFICATION_CATEGORIES = [
  'messages',
  'message_requests',
  'roommate_invites',
  'ranking_invites',
  'housing_groups',
  'marketplace',
  'movein',
  'announcements',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Human labels for server-rendered surfaces (unsubscribe confirmation page).
 *  Keep in step with NOTIFICATION_CATEGORY_META in src/lib/notificationPrefs.ts. */
export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  messages: 'Direct messages',
  message_requests: 'Message requests',
  roommate_invites: 'Roommate invites',
  ranking_invites: 'Ranking invites',
  housing_groups: 'Housing groups',
  marketplace: 'Marketplace',
  movein: 'Move-in',
  announcements: 'Announcements',
};

export type NotificationChannelPrefs = Partial<Record<NotificationCategory, boolean>>;

export interface NotificationPrefs {
  email?: NotificationChannelPrefs | null;
  push?: NotificationChannelPrefs | null;
}

export interface NotificationProfile {
  email_notifications?: boolean | null;
  notification_prefs?: NotificationPrefs | null;
}

export function shouldSendEmail(
  profile: NotificationProfile | null | undefined,
  category: NotificationCategory,
): boolean {
  if (!profile) return false;
  if (profile.email_notifications === false) return false;
  return profile.notification_prefs?.email?.[category] !== false;
}

export function shouldSendPush(
  profile: NotificationProfile | null | undefined,
  category: NotificationCategory,
): boolean {
  if (!profile) return false;
  return profile.notification_prefs?.push?.[category] !== false;
}
