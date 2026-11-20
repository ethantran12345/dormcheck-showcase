import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { getOrCreateSessionId, trackEventImmediate } from '@/lib/analytics';

export type AnalyticsEventProperties = Record<string, unknown>;

const DEBOUNCE_MS = 500;

/**
 * Pilot / product analytics helper. Mirrors the admin notify-skip pattern: when
 * `profiles.is_admin` is true (`useAuth().isAdmin`), both verbs do nothing so QA
 * and admin sessions do not pollute student metrics.
 *
 * TWO VERBS - pick by what triggers the event, not by taste:
 *
 * - `track(...)`   VIEWS / effect- or render-driven events (`dorm_viewed`,
 *                  `my_home_viewed`). Debounced 500 ms per `{ eventName, properties }`
 *                  to collapse React StrictMode double-invocations into one row.
 *                  Fire-and-forget: the timer is CLEARED on unmount.
 * - `trackAction(...)` DISCRETE USER ACTIONS (`listing_created`, `message_sent`,
 *                  `handoff_completed`). Awaited, never debounced.
 *
 * Using `track` for an action loses the event two ways, and both bit us:
 *  1. the flow navigates on success, unmounting the caller before the 500 ms
 *     timer flushes (this is why `listing_created` had 0 rows against real creates);
 *  2. two identical actions inside 500 ms collapse into a single row, because the
 *     debounce key is the event name plus properties and carries no row id.
 * `trackAction` has neither failure mode. Await it BEFORE navigating.
 */
export function useAnalytics() {
  const { isAdmin, user } = useAuth();
  const isAdminRef = useRef(isAdmin);
  const userIdRef = useRef(user?.id);
  isAdminRef.current = isAdmin;
  userIdRef.current = user?.id;

  const debouncersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timers = debouncersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const track = useCallback((eventName: string, properties?: AnalyticsEventProperties) => {
    if (isAdminRef.current) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console -- guarded by import.meta.env.DEV above.
        console.log('[useAnalytics] skipped (admin user)', { eventName, properties });
      }
      return;
    }
    if (!userIdRef.current) return;

    const props = properties ?? {};
    const key = JSON.stringify({ eventName, properties: props });
    const existing = debouncersRef.current.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      debouncersRef.current.delete(key);
      if (isAdminRef.current) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console -- guarded by import.meta.env.DEV above.
          console.log('[useAnalytics] skipped (admin user, debounced flush)', { eventName, properties: props });
        }
        return;
      }
      const uid = userIdRef.current;
      if (!uid) return;

      const sessionId = getOrCreateSessionId();
      void supabase
        .from('analytics_events')
        .insert({
          user_id: uid,
          event_name: eventName,
          event_properties: props as Json,
          session_id: sessionId,
        })
        .then(({ error }) => {
          if (error && import.meta.env.DEV) {
            console.warn('[useAnalytics] insert failed', error);
          }
        });
    }, DEBOUNCE_MS);

    debouncersRef.current.set(key, timer);
  }, []);

  /**
   * Awaited, non-debounced insert for discrete user actions. Reads the same refs
   * as `track` so the admin-skip and auth gate stay identical, and delegates to
   * `trackEventImmediate`, which never throws - analytics must not break a flow.
   */
  const trackAction = useCallback(
    (eventName: string, properties?: AnalyticsEventProperties): Promise<void> =>
      trackEventImmediate(userIdRef.current, isAdminRef.current, eventName, properties ?? {}),
    [],
  );

  return { track, trackAction };
}
