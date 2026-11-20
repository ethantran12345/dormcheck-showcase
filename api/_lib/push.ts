import { fetchWithTimeout, isTimeoutError } from './fetchWithTimeout.js';

type PushData = Record<string, unknown>;

/**
 * Upper bound on the round trip to send-push. Thirteen notify-* and cron handlers
 * call this on the request path; before BA-06 (docs/audits/backend-audit-2026-09-06.md)
 * a stalled edge runtime held every one of them open until Vercel killed the lambda.
 * Push is best-effort here — a timeout is logged and the caller's own response goes out.
 */
export const PUSH_TIMEOUT_MS = 10_000;

export async function sendPush(
  userId: string,
  title: string,
  body: string,
  data?: PushData,
): Promise<void> {
  const base = process.env.SUPABASE_URL?.trim();
  const token = process.env.SEND_PUSH_AUTH_TOKEN?.trim();
  if (!base || !token) {
    console.warn('[push] SUPABASE_URL or SEND_PUSH_AUTH_TOKEN not set; skipping push');
    return;
  }
  if (!userId || !title || !body) return;
  try {
    const res = await fetchWithTimeout(
      `${base}/functions/v1/send-push`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: userId, title, body, ...(data ? { data } : {}) }),
      },
      PUSH_TIMEOUT_MS,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('[push] send-push failed', res.status, text);
    }
  } catch (e) {
    if (isTimeoutError(e)) {
      console.warn(`[push] send-push timed out after ${PUSH_TIMEOUT_MS}ms`);
      return;
    }
    console.warn('[push] send-push threw', e);
  }
}
