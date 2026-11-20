import { Capacitor } from '@capacitor/core';

/**
 * A SYNCHRONOUS, best-effort answer to "does this browser already hold a
 * session?" — used only to get the app shell's *box* right on the very first
 * frame. It is deliberately not an auth check and grants nothing.
 *
 * Why this exists (queue item 8b): the web chrome in `LayoutWrapper` branches on
 * `user` from `useAuth()`, which is `null` until `supabase.auth.getSession()`
 * resolves a tick after mount. So a signed-in user's first painted frame is the
 * *marketing* tree — `MarketingTopNav` plus its `h-[84px]` in-flow spacer, and a
 * `<main>` with neither `pt-12` nor `md:pl-[220px]`. When auth lands the tree is
 * swapped for the app shell, whose chrome is all `position: fixed` (zero layout
 * space), so `<main>` snaps up and right. The audit crawl measured exactly that:
 * `main` moving `dy -80` (~0.1699 CLS) on nearly every authed route, plus a
 * `dx 220` that is `md:pl-[220px]` landing late. Anonymous visitors never swap
 * trees and correctly scored 0.
 *
 * The fix is to reserve the right box on frame one rather than to defer the
 * chrome, so this reads the persisted session synchronously and lets the layout
 * start in the shape it is about to settle into.
 *
 * Scope and safety:
 *  - **Layout only.** Callers must keep gating real access on `user`. A stale or
 *    forged localStorage entry can only make the first frame reserve sidebar
 *    space; it cannot reveal data or authorize anything.
 *  - **Web only.** On native the session lives in the Keychain behind an async
 *    API, so there is nothing to read synchronously — and native never takes
 *    these branches anyway (both are gated on `!isNative`).
 *  - **Expiry-aware.** An expired token reads as "no session", so a returning
 *    user with a dead token still starts in the marketing shape they will land
 *    in rather than flashing a shell they cannot have.
 */
function readPersistedSession(): boolean {
  if (Capacitor.isNativePlatform()) return false;
  try {
    // supabase-js derives its storage key from the project ref
    // (`sb-<ref>-auth-token`) and we never override it, so match the shape
    // rather than hard-coding a ref that changes between local, staging and prod.
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !/^sb-.+-auth-token$/.test(key)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { access_token?: string; refresh_token?: string; expires_at?: number };
      // `expires_at` is seconds since epoch. Treat an expired access token as no
      // session: the refresh may well succeed, but betting on it would trade a
      // shift for signed-in users for a shift for lapsed ones.
      if (typeof parsed?.expires_at === 'number' && parsed.expires_at * 1000 <= Date.now()) continue;
      if (parsed?.access_token || parsed?.refresh_token) return true;
    }
  } catch {
    // Private mode, disabled storage, or a malformed entry. "No session" is the
    // safe answer: it reproduces today's behaviour instead of inventing a shift.
  }
  return false;
}

/**
 * Evaluated once at module load — the answer describes the first frame, and
 * recomputing it per render would only add work while returning the same value.
 * Sign-in and sign-out both resolve `isLoading` to `false`, after which callers
 * use the real `user` and this constant is inert.
 */
export const HAD_PERSISTED_SESSION_AT_BOOT = readPersistedSession();
