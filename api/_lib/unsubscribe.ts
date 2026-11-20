import { createHmac, timingSafeEqual } from 'crypto';
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from './notificationPrefs.js';

/**
 * Signed one-click-unsubscribe tokens (P0.4). The token is the only auth on
 * /api/unsubscribe - it encodes (userId, category) and is HMAC-signed with a
 * server secret, so a link in a delivered email can flip that one preference
 * and nothing else. No expiry: an unsubscribe link at the bottom of an old
 * email must keep working (CAN-SPAM expects >=30 days; we just never expire).
 */

function secret(): string {
  const s = process.env.UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error('UNSUBSCRIBE_SECRET / SUPABASE_SERVICE_ROLE_KEY not configured');
  return s;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sign(payload: string): string {
  return b64url(createHmac('sha256', secret()).update(payload).digest());
}

export function signUnsubscribeToken(userId: string, category: NotificationCategory): string {
  const payload = `${userId}:${category}`;
  return `${b64url(Buffer.from(payload, 'utf8'))}.${sign(payload)}`;
}

export function verifyUnsubscribeToken(
  token: string,
): { userId: string; category: NotificationCategory } | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  let payload: string;
  try {
    payload = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(token.slice(dot + 1));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const sep = payload.lastIndexOf(':');
  if (sep <= 0) return null;
  const userId = payload.slice(0, sep);
  const category = payload.slice(sep + 1) as NotificationCategory;
  if (!/^[0-9a-f-]{36}$/.test(userId)) return null;
  if (!NOTIFICATION_CATEGORIES.includes(category)) return null;
  return { userId, category };
}

export function unsubscribeUrl(userId: string, category: NotificationCategory): string {
  return `https://dormcheck.com/api/unsubscribe?t=${encodeURIComponent(signUnsubscribeToken(userId, category))}`;
}
