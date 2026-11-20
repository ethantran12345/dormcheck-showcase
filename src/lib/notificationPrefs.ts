// UI-side mirror of api/_lib/notificationPrefs.ts. The category keys must
// match the server list exactly - src/test/notificationPrefs.test.ts asserts
// the two stay in sync.

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

export type NotificationChannelPrefs = Partial<Record<NotificationCategory, boolean>>;

export interface NotificationPrefs {
  email?: NotificationChannelPrefs | null;
  push?: NotificationChannelPrefs | null;
}

export const NOTIFICATION_CATEGORY_META: Record<
  NotificationCategory,
  { label: string; description: string }
> = {
  messages: {
    label: 'Direct messages',
    description: 'New messages in your conversations',
  },
  message_requests: {
    label: 'Message requests',
    description: 'New requests to connect and accepted requests',
  },
  roommate_invites: {
    label: 'Roommate invites',
    description: 'Invitations to join a roommate group',
  },
  ranking_invites: {
    label: 'Ranking invites',
    description: 'Invitations to collaborate on dorm rankings',
  },
  housing_groups: {
    label: 'Housing groups',
    description: 'Activity in your housing groups',
  },
  marketplace: {
    label: 'Marketplace',
    description: 'Inquiries about your marketplace listings',
  },
  movein: {
    label: 'Move-in',
    description: 'Roommate confirmations, new building residents, and move-in countdown',
  },
  announcements: {
    label: 'Announcements',
    description: 'Occasional updates from the DormCheck team',
  },
};
