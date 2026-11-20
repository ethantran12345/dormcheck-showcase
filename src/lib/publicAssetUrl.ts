import { Capacitor } from '@capacitor/core';

/**
 * Host that serves bundled `/public` assets (PDFs, maps) when the app runs as a
 * native shell. On the web these assets are same-origin, so a relative path is
 * correct. On native the webview origin is `capacitor://localhost`, which the OS
 * can't hand off to an external viewer (`Failed to open URL capacitor://…` /
 * LSApplicationWorkspaceErrorDomain 115) - so we point bundled-asset links at the
 * deployed site instead. Mirrors the API base in `apiPost.ts`.
 */
const nativeAssetBase =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'https://dormcheck.com';

/**
 * Resolve a bundled `/public` asset path to a URL safe to open in a new tab or
 * external viewer: relative on the web, absolute https on native.
 */
export function publicAssetUrl(path: string): string {
  if (!Capacitor.isNativePlatform()) return path;
  const base = nativeAssetBase.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
