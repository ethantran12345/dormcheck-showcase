import { supabase } from './supabase.js';
import { sendPush } from './push.js';
import { shouldSendPush, type NotificationProfile } from './notificationPrefs.js';

// Shared broadcast machinery used by both the interactive endpoint
// (api/admin/broadcast.ts) and the scheduled dispatcher cron
// (api/cron/dispatch-broadcasts.ts), so a scheduled send runs the exact same
// audience resolution + push fan-out + in-app bell path as an immediate one.

export const EVERYONE_CAP = 2000;
const CONCURRENCY = 10;

export type Audience =
  | { kind: 'user'; userId?: string; email?: string }
  | { kind: 'building'; universityId: string; building: string }
  | { kind: 'university'; universityId: string }
  | { kind: 'everyone' };

export type Recipient = NotificationProfile & { id: string; university_id: string | null };

export function parseAudience(raw: unknown): Audience | null {
  const a = raw as {
    kind?: string;
    userId?: string;
    email?: string;
    universityId?: string;
    building?: string;
  };
  if (a?.kind === 'user') {
    if (typeof a.userId === 'string' && a.userId.trim()) return { kind: 'user', userId: a.userId.trim() };
    if (typeof a.email === 'string' && a.email.trim()) {
      return { kind: 'user', email: a.email.trim().toLowerCase() };
    }
    return null;
  }
  if (
    a?.kind === 'building' &&
    typeof a.universityId === 'string' && a.universityId.trim() &&
    typeof a.building === 'string' && a.building.trim()
  ) {
    return { kind: 'building', universityId: a.universityId.trim(), building: a.building.trim() };
  }
  if (a?.kind === 'university' && typeof a.universityId === 'string' && a.universityId.trim()) {
    return { kind: 'university', universityId: a.universityId.trim() };
  }
  if (a?.kind === 'everyone') return { kind: 'everyone' };
  return null;
}

/** Audience → the audience_type + audience_detail persisted on push_broadcasts. */
export function serializeAudience(audience: Audience): { audience_type: string; audience_detail: Record<string, unknown> } {
  const audience_detail =
    audience.kind === 'user'
      ? (audience.userId ? { user_id: audience.userId } : { email: audience.email })
      : audience.kind === 'building'
        ? { university_id: audience.universityId, building: audience.building }
        : audience.kind === 'university'
          ? { university_id: audience.universityId }
          : { cap: EVERYONE_CAP };
  return { audience_type: audience.kind, audience_detail };
}

/** Reconstruct an Audience from a persisted push_broadcasts row (used by the cron). */
export function deserializeAudience(
  audienceType: string,
  detail: Record<string, unknown> | null | undefined,
): Audience | null {
  const d = detail ?? {};
  if (audienceType === 'user') {
    if (typeof d.user_id === 'string') return { kind: 'user', userId: d.user_id };
    if (typeof d.email === 'string') return { kind: 'user', email: d.email };
    return null;
  }
  if (audienceType === 'building' && typeof d.university_id === 'string' && typeof d.building === 'string') {
    return { kind: 'building', universityId: d.university_id, building: d.building };
  }
  if (audienceType === 'university' && typeof d.university_id === 'string') {
    return { kind: 'university', universityId: d.university_id };
  }
  if (audienceType === 'everyone') return { kind: 'everyone' };
  return null;
}

export async function resolveRecipients(audience: Audience): Promise<Recipient[] | null> {
  if (!supabase) return null;
  const cols = 'id, notification_prefs, email_notifications, university_id';
  if (audience.kind === 'user') {
    const query = supabase.from('profiles').select(cols);
    const { data, error } = audience.userId
      ? await query.eq('id', audience.userId)
      : await query.ilike('email', audience.email!);
    return error ? null : ((data ?? []) as Recipient[]);
  }
  if (audience.kind === 'building') {
    const { data, error } = await supabase
      .from('profiles')
      .select(cols)
      .eq('university_id', audience.universityId)
      .ilike('current_dorm', audience.building);
    return error ? null : ((data ?? []) as Recipient[]);
  }
  if (audience.kind === 'university') {
    const { data, error } = await supabase
      .from('profiles')
      .select(cols)
      .eq('university_id', audience.universityId)
      .limit(EVERYONE_CAP);
    return error ? null : ((data ?? []) as Recipient[]);
  }
  const { data, error } = await supabase.from('profiles').select(cols).limit(EVERYONE_CAP);
  return error ? null : ((data ?? []) as Recipient[]);
}

export interface DispatchResult {
  resolved: number;
  eligible: number;
  sent: number;
  failed: number;
}

/**
 * Fan out one broadcast to already-resolved recipients: push to everyone who
 * hasn't turned off the 'announcements' category, plus an in-app bell for every
 * resolved recipient (so students without push still see it). Never throws on an
 * individual failure; the bell insert is best-effort.
 */
export async function dispatchToRecipients(
  recipients: Recipient[],
  content: { title: string; body: string; route?: string | null },
): Promise<DispatchResult> {
  const { title, body } = content;
  const route = content.route ?? null;

  const eligible = recipients.filter((r) => shouldSendPush(r, 'announcements'));
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < eligible.length; i += CONCURRENCY) {
    const batch = eligible.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((r) =>
        sendPush(r.id, title, body, {
          type: 'broadcast',
          ...(route ? { route } : {}),
        }),
      ),
    );
    for (const result of results) {
      if (result.status === 'fulfilled') sent++;
      else failed++;
    }
  }

  if (supabase && recipients.length > 0) {
    const { error: bellError } = await supabase.from('notifications').insert(
      recipients.map((r) => ({
        recipient_id: r.id,
        type: 'admin_announcement',
        payload: { title, body, ...(route ? { route } : {}) },
        university_id: r.university_id,
      })),
    );
    if (bellError) console.error('[broadcastCore] bell insert failed', bellError.message);
  }

  return { resolved: recipients.length, eligible: eligible.length, sent, failed };
}

/** Only relative in-app routes are deliverable deep links. */
export function cleanRoute(route: unknown): string | null {
  return typeof route === 'string' && route.startsWith('/') && !route.startsWith('//')
    ? route.trim()
    : null;
}
