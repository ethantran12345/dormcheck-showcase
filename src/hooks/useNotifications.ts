import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { devLog } from '@/lib/utils';
import { clearAppBadge } from '@/lib/pushNotifications';
import { toAppNotification, type AppNotification, type NotificationRow } from '@/lib/notifications';

const DEFAULT_FETCH_LIMIT = 20;

// Each hook instance subscribes under a distinct channel name. The bell (native
// top bar), the /my-home card, and the /notifications page can all be mounted at
// once; sharing one channel topic risks a duplicate-join on the realtime socket.
let channelSeq = 0;

/**
 * Live view over the caller's `public.notifications` rows (RLS scopes the
 * select). Same shape as useUnreadMessages: fetch + postgres_changes channel
 * with a debounced refetch, so state is always rebuilt from a query rather
 * than accumulated from event payloads.
 *
 * `limit` caps how many recent rows to hold (the top-bar bell wants ~20, the
 * full notification center wants more).
 */
export function useNotifications(options?: { limit?: number }) {
  const limit = options?.limit ?? DEFAULT_FETCH_LIMIT;
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const instanceId = useRef<number>(++channelSeq);

  const fetchNotifications = useCallback(async () => {
    if (!user?.id) {
      setNotifications([]);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, type, payload, read_at, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) {
        devLog('[useNotifications] fetch error:', error.message);
        return;
      }
      setNotifications(
        ((data ?? []) as NotificationRow[])
          .map(toAppNotification)
          .filter((n): n is AppNotification => n !== null)
      );
    } catch (err) {
      devLog('[useNotifications] fetch threw:', err);
    }
  }, [user?.id, limit]);

  // Coalesce bursts of realtime events into a single refetch.
  const scheduleFetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      fetchNotifications();
    }, 400);
  }, [fetchNotifications]);

  const markAllRead = useCallback(async () => {
    if (!user?.id) return;
    // Optimistic: clear locally, reconcile from the server on failure.
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    // The user has seen these - drop the stuck app-icon badge too (native).
    void clearAppBadge();
    const { error } = await supabase.rpc('mark_notifications_read');
    if (error) {
      devLog('[useNotifications] markAllRead error:', error.message);
      fetchNotifications();
    }
  }, [user?.id, fetchNotifications]);

  useEffect(() => {
    if (!user?.id) {
      setNotifications([]);
      return;
    }

    fetchNotifications();

    // No recipient_id filter on purpose: realtime applies the table's RLS per
    // subscriber (verified locally: another recipient's insert delivers no
    // event), so an unfiltered subscription already sees only the caller's own
    // rows. The local realtime container (v2.108.0) also silently drops every
    // filtered postgres_changes subscription, so a filter breaks local dev.
    const ch = supabase
      .channel(`notifications-${user.id}-${instanceId.current}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications' },
        () => scheduleFetch()
      );
    ch.subscribe();
    channelRef.current = ch;

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user?.id, fetchNotifications, scheduleFetch]);

  const unreadNotificationCount = notifications.filter((n) => !n.read).length;

  return { notifications, unreadNotificationCount, markAllRead, refresh: fetchNotifications };
}
