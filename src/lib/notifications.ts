/**
 * Typed notifications model for the top-nav bell, backed by the
 * `public.notifications` table (migration 20260713000000).
 *
 * Rows are written server-side only (SECURITY DEFINER triggers); the client
 * reads its own rows via RLS and marks them read through the
 * `mark_notifications_read` RPC (see useNotifications). This module holds the
 * pure row -> display mapping so copy stays editable without migrations:
 * payloads store facts (ids, names, counts), never rendered strings.
 */
export type NotificationKind =
  | 'message'
  | 'listing'
  | 'mention'
  | 'chat-join'
  | 'roommate-invited'
  | 'roommate-confirmed'
  | 'building-residents'
  | 'announcement'
  | 'report-update'
  | 'listing-freshness'
  | 'marketplace-alert';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  /** In-app route the notification links to. */
  to: string;
  createdAt: string;
  read: boolean;
}

/** Shape of a `public.notifications` row as selected by useNotifications. */
export interface NotificationRow {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

/**
 * Map a DB row to the display model, or null for unknown types (an older
 * client seeing a type shipped later should drop it, not crash).
 */
export function toAppNotification(row: NotificationRow): AppNotification | null {
  const payload = row.payload ?? {};
  const base = {
    id: row.id,
    to: '/my-home',
    createdAt: row.created_at,
    read: row.read_at != null,
  };

  switch (row.type) {
    case 'roommate_invited': {
      // Recipient of a pending group invite (migration roommate_invited_notification).
      // Deep-links to /checklist, where ReceivedInvitations surfaces Accept/Decline.
      const actor =
        typeof payload.actor_name === 'string' && payload.actor_name.trim()
          ? payload.actor_name
          : 'A roommate';
      const isRoommate = payload.group_type === 'roommate';
      const groupName =
        typeof payload.group_name === 'string' && payload.group_name.trim()
          ? payload.group_name
          : undefined;
      const dorm =
        typeof payload.dorm_name === 'string' && payload.dorm_name.trim()
          ? payload.dorm_name
          : undefined;
      return {
        ...base,
        to: '/checklist',
        kind: 'roommate-invited',
        title: isRoommate
          ? `${actor} wants to confirm you as a roommate`
          : `${actor} invited you to ${groupName ?? 'a group'}`,
        body: isRoommate ? dorm ?? groupName : groupName,
      };
    }
    case 'roommate_invite_accepted': {
      const actor =
        typeof payload.actor_name === 'string' && payload.actor_name.trim()
          ? payload.actor_name
          : 'A roommate';
      const groupName = typeof payload.group_name === 'string' ? payload.group_name : undefined;
      return {
        ...base,
        kind: 'roommate-confirmed',
        title: `${actor} confirmed you as a roommate`,
        body: groupName,
      };
    }
    case 'building_new_residents': {
      const count = typeof payload.count === 'number' && payload.count > 0 ? payload.count : 1;
      const building =
        typeof payload.building_name === 'string' && payload.building_name.trim()
          ? payload.building_name
          : undefined;
      return {
        ...base,
        kind: 'building-residents',
        title:
          count === 1
            ? '1 new person joined your building'
            : `${count} new people joined your building`,
        body: building,
      };
    }
    case 'admin_announcement': {
      const title =
        typeof payload.title === 'string' && payload.title.trim() ? payload.title : 'Announcement';
      const body = typeof payload.body === 'string' && payload.body.trim() ? payload.body : undefined;
      const to =
        typeof payload.route === 'string' &&
        payload.route.startsWith('/') &&
        !payload.route.startsWith('//')
          ? payload.route
          : '/my-home';
      return { ...base, to, kind: 'announcement', title, body };
    }
    case 'report_resolution': {
      // Reporter feedback (migration 20260712100000): payload stores the
      // moderation action, copy renders here. No admin identity is exposed.
      const body =
        payload.action === 'delete_content'
          ? 'We reviewed your report and removed the content. Thanks for helping keep DormCheck safe.'
          : 'We reviewed your report and found no violation. Thanks for looking out.';
      return { ...base, kind: 'report-update', title: 'Update on your report', body };
    }
    case 'listing_freshness': {
      // "Still available?" nudge (migration 20260713020000); confirming =
      // relisting/editing from My Marketplace, which resets the clock.
      const title =
        typeof payload.title === 'string' && payload.title.trim()
          ? `Still selling "${payload.title}"?`
          : 'Still selling your listing?';
      const days = typeof payload.expires_in_days === 'number' ? payload.expires_in_days : 14;
      return {
        ...base,
        to: '/marketplace/my-items',
        kind: 'listing-freshness',
        title,
        body: `It expires in about ${days} days unless you confirm it's still available.`,
      };
    }
    case 'marketplace_alert': {
      // Saved-search match (migration 20260810000000): a new listing matched
      // one of the user's marketplace alerts. Deep-links via ?listing=, which
      // MarketplaceTab opens as the detail modal.
      const listingTitle =
        typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : 'A new listing';
      const alertName =
        typeof payload.alert_name === 'string' && payload.alert_name.trim()
          ? payload.alert_name.trim()
          : 'your alert';
      const price =
        typeof payload.price === 'number' && Number.isFinite(payload.price)
          ? `$${Math.round(payload.price)}`
          : undefined;
      const listingId = typeof payload.listing_id === 'string' ? payload.listing_id : null;
      return {
        ...base,
        to: listingId
          ? `/marketplace?tab=buy-sell&listing=${listingId}`
          : '/marketplace?tab=buy-sell',
        kind: 'marketplace-alert',
        title: `New match for "${alertName}": ${listingTitle}`,
        body: price ? `Listed at ${price}` : undefined,
      };
    }
    default:
      return null;
  }
}
