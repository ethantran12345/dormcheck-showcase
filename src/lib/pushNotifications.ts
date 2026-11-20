import { Capacitor } from '@capacitor/core';
import {
  PushNotifications,
  type Token,
  type PushNotificationSchema,
  type ActionPerformed,
} from '@capacitor/push-notifications';
import { Badge } from '@capawesome/capacitor-badge';
import { supabase } from '@/integrations/supabase/client';
import { devLog } from '@/lib/utils';

const isNative = Capacitor.isNativePlatform();
// iOS registers against APNs; Android against FCM (needs google-services.json
// in the Android build — without it registration errors and we just log it).
// send-push branches per device_tokens.platform on delivery.
const platform = Capacitor.getPlatform();
const isAndroid = platform === 'android';

/**
 * Reset the app-icon badge to zero and clear the delivered-notification tray.
 *
 * send-push stamps every APNs payload with `badge: 1` but nothing ever resets
 * it, so the red dot stuck to the icon forever. We clear it whenever the user
 * has plausibly seen their notifications: on app resume and when the in-app
 * notification center opens / is marked read. Safe to call on web (no-op) and
 * best-effort - a failed clear must never surface to the user.
 */
export async function clearAppBadge(): Promise<void> {
  if (!isNative) return;
  try {
    await Badge.clear();
  } catch (e) {
    console.warn('[pushNotifications] clear badge failed:', e);
  }
  try {
    await PushNotifications.removeAllDeliveredNotifications();
  } catch {
    // tray clear is a nicety; ignore failures
  }
}

// localStorage key holding the push token most recently registered on THIS device.
// On unregister we only delete that specific token row - never every iOS row for
// the user (other devices may still be subscribed under the same account).
const DEVICE_TOKEN_STORAGE_KEY = 'dc_device_push_token';

let listenersAttached = false;
let lastTokenForUserId: string | null = null;

// Payload contract: every push carries data: { type, route, ...facts } where
// route is an in-app path ('/messages/abc', '/checklist?confirmRoommates=1').
// Documented in docs/audits/push-notifications.md.
export const PUSH_NAV_EVENT = 'dc:push-nav';
export const PUSH_FOREGROUND_EVENT = 'dc:push-foreground';

// A tap on a push can arrive before React mounts (cold start from a killed
// app). Stash the route here; PushNavGate consumes it on mount.
let pendingPushRoute: string | null = null;

export function consumePendingPushRoute(): string | null {
  const route = pendingPushRoute;
  pendingPushRoute = null;
  return route;
}

/** Only allow relative in-app paths — never absolute/protocol URLs. */
export function isSafePushRoute(route: unknown): route is string {
  return typeof route === 'string' && route.startsWith('/') && !route.startsWith('//');
}

function readStoredToken(): string | null {
  try {
    return typeof localStorage !== 'undefined'
      ? localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY)
      : null;
  } catch {
    return null;
  }
}

function writeStoredToken(token: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, token);
    }
  } catch {
    // ignore
  }
}

function clearStoredToken(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(DEVICE_TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

async function persistToken(userId: string, token: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from('device_tokens')
    .upsert(
      {
        user_id: userId,
        token,
        platform: isAndroid ? 'android' : 'ios',
        device_name: isAndroid ? 'Android device' : 'iPhone',
        last_used_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'token' },
    );
  if (error) {
    console.warn('[pushNotifications] upsert device_token failed:', error.message);
    return;
  }
  writeStoredToken(token);
  devLog('[pushNotifications] device token saved');
}

function attachListenersOnce(getUserId: () => string | null): void {
  if (listenersAttached) return;
  listenersAttached = true;

  PushNotifications.addListener('registration', (token: Token) => {
    const userId = getUserId();
    devLog('[pushNotifications] registration token received');
    if (!userId) {
      console.warn('[pushNotifications] no user_id at registration time; skipping persist');
      return;
    }
    void persistToken(userId, token.value);
  });

  PushNotifications.addListener('registrationError', (err) => {
    console.warn('[pushNotifications] registration error:', err);
  });

  PushNotifications.addListener(
    'pushNotificationReceived',
    (notification: PushNotificationSchema) => {
      // iOS suppresses banners while the app is foregrounded, so surface the
      // push in-app. PushNavGate (App.tsx) listens and shows a toast.
      const data = (notification.data ?? {}) as Record<string, unknown>;
      const route = isSafePushRoute(data.route) ? data.route : null;
      window.dispatchEvent(
        new CustomEvent(PUSH_FOREGROUND_EVENT, {
          detail: { title: notification.title ?? '', body: notification.body ?? '', route },
        }),
      );
    },
  );

  PushNotifications.addListener(
    'pushNotificationActionPerformed',
    (action: ActionPerformed) => {
      const data = (action.notification.data ?? {}) as Record<string, unknown>;
      if (!isSafePushRoute(data.route)) return;
      // Stash first (cold start: this can fire before React mounts), then
      // notify a mounted PushNavGate, which consumes the pending route.
      pendingPushRoute = data.route;
      window.dispatchEvent(
        new CustomEvent(PUSH_NAV_EVENT, { detail: { route: data.route } }),
      );
    },
  );
}

export async function registerPushNotifications(userId: string): Promise<void> {
  if (!isNative) return;
  if (!userId) return;

  // Track latest userId so the 'registration' listener (resolved async) attaches
  // to the right user - important if a user logs out and back in.
  lastTokenForUserId = userId;
  attachListenersOnce(() => lastTokenForUserId);

  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') {
      devLog('[pushNotifications] permission not granted:', perm.receive);
      return;
    }
    if (isAndroid) {
      // FCM drops notifications without a channel on Android 8+. Matches the
      // default_notification_channel_id meta-data in AndroidManifest.xml.
      await PushNotifications.createChannel({
        id: 'default',
        name: 'Notifications',
        importance: 4,
      });
    }
    await PushNotifications.register();
  } catch (e) {
    console.warn('[pushNotifications] register failed:', e);
  }
}

export async function unregisterPushNotifications(userId: string): Promise<void> {
  if (!isNative) return;
  if (!userId) return;

  // Only delete the token tied to THIS device (stored in localStorage at
  // registration time). Deleting all rows for the user would unsubscribe other
  // devices on the same account.
  const token = readStoredToken();
  lastTokenForUserId = null;

  if (!token) {
    devLog('[pushNotifications] no stored device token to remove');
    return;
  }

  try {
    const { error } = await supabase
      .from('device_tokens')
      .delete()
      .eq('token', token)
      .eq('user_id', userId);
    if (error) {
      console.warn('[pushNotifications] delete device_token failed:', error.message);
    } else {
      devLog('[pushNotifications] device token removed');
    }
  } catch (e) {
    console.warn('[pushNotifications] delete threw:', e);
  } finally {
    clearStoredToken();
  }
}
