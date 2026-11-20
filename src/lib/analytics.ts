/**
 * Shared analytics helpers. Behavior is intentionally minimal: the two
 * debounced `useAnalytics.track` keeps its own insert call (it needs the timer
 * and the admin-skip re-check at flush time).
 *
 * `trackEventImmediate` below is the delivery path for anything that must not be
 * lost: it awaits the insert, so it survives an immediate navigation/unmount. It
 * backs `useAnalytics().trackAction` (every discrete user action) and is called
 * directly from flows that navigate on success (onboarding finish, message-seller).
 * Prefer `trackAction` from inside a component - it reads `isAdmin`/`user` for you.
 */

import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';

export const ANALYTICS_SESSION_STORAGE_KEY = 'dc_session_id';

/**
 * Read the per-tab analytics session id, generating one with `crypto.randomUUID()`
 * and persisting to `sessionStorage` under {@link ANALYTICS_SESSION_STORAGE_KEY}
 * when missing. Returns `null` if `sessionStorage` is unavailable or a storage
 * / crypto call throws (e.g. private mode quota, disabled Web Crypto).
 */
export function getOrCreateSessionId(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    let id = sessionStorage.getItem(ANALYTICS_SESSION_STORAGE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(ANALYTICS_SESSION_STORAGE_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

/**
 * Insert an analytics event without the `useAnalytics` debounce, awaiting the
 * insert so it survives an immediate navigation/unmount. Mirrors the same
 * admin-skip contract: pass `isAdmin` from `useAuth()` and admin sessions are
 * dropped. Never throws - analytics must not break the calling flow.
 */
export async function trackEventImmediate(
  userId: string | undefined,
  isAdmin: boolean,
  eventName: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  if (!userId) return;
  if (isAdmin) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console -- guarded by import.meta.env.DEV above.
      console.log('[analytics] trackEventImmediate skipped (admin user)', { eventName, properties });
    }
    return;
  }
  try {
    const { error } = await supabase.from('analytics_events').insert({
      user_id: userId,
      event_name: eventName,
      event_properties: properties as Json,
      session_id: getOrCreateSessionId(),
    });
    if (error && import.meta.env.DEV) {
      console.warn('[analytics] trackEventImmediate insert failed', { eventName, error });
    }
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[analytics] trackEventImmediate threw', { eventName, err });
    }
  }
}
