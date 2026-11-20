import type { AuthMethod } from '@/config/universities';

/**
 * "Last used" login method - device-local, Wispr Flow-style.
 *
 * Records which method the student last used to sign in ON THIS DEVICE so the
 * auth screen can surface a "Last used" hint. This is a device-local hint only.
 *
 * Provider *detection* (does this email have a password / which OAuth providers)
 * now lives server-side in `src/lib/authMethods.ts` via the rate-limited
 * /api/auth-methods endpoint - a deliberate, throttled enumeration surface added
 * so OAuth-only accounts can be routed to their provider instead of failing a
 * password attempt. This module stays a pure device-local convenience.
 *
 * Storage vocabulary is the app's own method names ('google' | 'microsoft' |
 * 'password'), which map cleanly onto `AuthMethod` for button gating. Note the
 * Supabase provider strings differ ('azure' for Microsoft, 'email' for
 * password) - callers translate at the auth-handler boundary, so this module
 * only ever sees the normalized value.
 */

export type LastAuthMethod = 'google' | 'microsoft' | 'password';

const KEY = 'dc_last_auth_method';

function isLastAuthMethod(v: unknown): v is LastAuthMethod {
  return v === 'google' || v === 'microsoft' || v === 'password';
}

export function getLastAuthMethod(): LastAuthMethod | null {
  try {
    const raw = localStorage.getItem(KEY);
    return isLastAuthMethod(raw) ? raw : null;
  } catch {
    return null; // private mode / storage disabled / WKWebView restriction
  }
}

export function setLastAuthMethod(method: LastAuthMethod): void {
  try {
    localStorage.setItem(KEY, method);
  } catch {
    // ignore (private mode / storage disabled)
  }
}

export function clearLastAuthMethod(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** Bridge to the per-school `authMethods` vocabulary used for button gating. */
export function toAuthMethod(method: LastAuthMethod): AuthMethod {
  return method === 'password' ? 'email' : method; // google->google, microsoft->microsoft
}

/** Human-facing label for hint copy. No em dashes (repo copy rule). */
export function lastMethodLabel(method: LastAuthMethod): string {
  if (method === 'google') return 'Google';
  if (method === 'microsoft') return 'Microsoft';
  return 'email & password';
}

/** True for OAuth providers (the case where email+password will silently fail). */
export function isOAuthMethod(method: LastAuthMethod): boolean {
  return method !== 'password';
}
