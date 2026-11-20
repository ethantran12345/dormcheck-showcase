import { parseSafeRedirectParam } from '@/lib/authRedirects';

/**
 * Hosts whose https links the native apps claim as Universal Links (iOS) /
 * App Links (Android). Keep in sync with:
 *   - Associated Domains entitlement — ios/App/App/App.entitlements +
 *     AppRelease.entitlements (`applinks:dormcheck.com`, `applinks:www…`)
 *   - Android intent-filter — android/app/src/main/AndroidManifest.xml
 *   - Association files — public/.well-known/apple-app-site-association +
 *     assetlinks.json
 */
export const DEEP_LINK_HOSTS = ['dormcheck.com', 'www.dormcheck.com'] as const;

/**
 * Canonical set of deep-linkable content paths the native apps intercept. These
 * are the shared / actionable destinations that appear in transactional emails
 * and invite links (see api/_lib/notifications.ts + api/og-invite.ts). The AASA
 * `components` and the Android intent-filter mirror this list; DO NOT let them
 * drift.
 *
 * The in-app handler (`universalLinkToPath`) is intentionally a SUPERSET — it
 * accepts ANY same-origin path — so that once a link has already opened the app,
 * in-app navigation and server-side redirects to other routes still resolve.
 * The AASA/intent-filter allowlist is what actually gates which taps open the
 * app in the first place.
 */
export const DEEP_LINK_PATHS = [
  '/rankings/invite/*', // ranking group invite
  '/roommates/invite/*', // roommate group invite
  '/messages', // direct messages / open conversation (?conversation=…)
  '/marketplace', // shared marketplace listing (?listing=…)
] as const;

/**
 * Parse an incoming Universal Link / App Link (https://[www.]dormcheck.com/…)
 * into a safe in-app path (pathname + query), or `null` if it isn't one of our
 * hosts or fails the open-redirect sanitizer. Reuses `parseSafeRedirectParam`
 * so the same-origin-only guarantees stay in one place.
 */
export function universalLinkToPath(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (!(DEEP_LINK_HOSTS as readonly string[]).includes(host)) return null;
  // pathname always starts with '/'; keep the query so ?conversation=… survives.
  return parseSafeRedirectParam(`${u.pathname}${u.search}`);
}
