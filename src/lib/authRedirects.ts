import { supabase } from '@/integrations/supabase/client';

const ONBOARDING_INTRO = '/onboarding/intro';
const HOME = '/';

/**
 * Sanitize `?redirect=` after login (open-redirect safe).
 * Allows only in-app paths: single leading slash, not `//`, no URL schemes.
 */
export function parseSafeRedirectParam(raw: string | null): string | null {
  if (raw == null || raw === '') return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const t = decoded.trim();
  if (!t.startsWith('/')) return null;
  if (t.includes('//')) return null;
  if (t.includes('\\')) return null; // backslash can be normalized to `/` by the browser (e.g. `/\evil.com`)
  if (/^https?:/i.test(t)) return null;
  if (t.includes('://')) return null;
  return t;
}

/**
 * Build the `emailRedirectTo` for signup / resend confirmation emails.
 *
 * The post-confirmation destination must survive the email round-trip. A new
 * user who confirms via the email link opens a FRESH browser context, so the
 * `auth_redirect` value we stash in sessionStorage is gone. To avoid losing the
 * invite, we carry the sanitized in-app path INSIDE the confirmation URL as a
 * `?redirect=` query param, which `AuthCallback` reads back after the session
 * is established.
 *
 * The base (`${SITE_URL}/auth/v1/callback`) is already covered by Supabase's
 * allowed redirect list (`https://dormcheck.com/**`), so the query-param
 * variant is allowed too. `raw` is sanitized to a same-origin app path.
 */
export function buildSignupEmailRedirectTo(raw: string | null): string {
  const base = `${import.meta.env.VITE_SITE_URL ?? window.location.origin}/auth/v1/callback`;
  const safe = parseSafeRedirectParam(raw);
  return safe ? `${base}?redirect=${encodeURIComponent(safe)}` : base;
}

/**
 * Build the `redirectTo` for a password-reset email.
 *
 * Same reasoning as the signup redirect, plus one native-only trap: inside the
 * iOS WKWebView `window.location.origin` is `capacitor://localhost`, which is
 * not a URL anyone's mail client can open. The reset link must always point at
 * the real site, where /auth reads the recovery hash and shows the set-password
 * form; the user then returns to the app and signs in with the new password.
 */
export function buildPasswordResetRedirectTo(): string {
  return `${import.meta.env.VITE_SITE_URL ?? window.location.origin}/auth`;
}

/**
 * Resolve where to redirect the user after successful sign-in.
 *
 * Onboarding is only ever the answer when we have READ a profile row and its
 * `has_completed_onboarding` is false. An unreadable profile is NOT an
 * un-onboarded one, and conflating the two is what trapped users in an
 * inescapable onboarding loop:
 *
 * RLS on `profiles` is `id = auth.uid()`, so a read made without a valid access
 * token comes back as ZERO ROWS AND NO ERROR — indistinguishable, to the old
 * `data?.has_completed_onboarding === true`, from a user who genuinely has not
 * onboarded. The everyday trigger is app start, where a persisted session yields
 * a `user` object while the access token is still refreshing. The user was sent
 * to onboarding, finished it, wrote a flag that was already true, came back to
 * the home page, failed the read again, and went straight back to onboarding.
 *
 * "No row" cannot mean "new user" here: prod has 84 auth users and 74 profiles,
 * and all 10 without a row are unconfirmed and have never signed in. Every user
 * who can reach this function has a profile row, so a missing one means the read
 * failed. The old code also discarded `error` entirely (`const { data }`), so a
 * hard failure was silently indistinguishable from a `false` flag too.
 *
 * On any uncertainty we send the user HOME. That is the recoverable direction:
 * the app's own guards handle a genuinely incomplete profile, whereas a wrong
 * turn into onboarding is a loop with no way out.
 */
export async function getPostLoginRedirect(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from('profiles')
    .select('has_completed_onboarding')
    .eq('id', userId)
    .maybeSingle();

  // Read failed outright, or RLS/an invalid token hid the row. Either way we do
  // not know, and "do not know" must never route into onboarding.
  if (error || data == null) return HOME;

  // Row in hand: anything other than an explicit `true` means onboarding is
  // outstanding. The column is nullable with a `false` default, so `!== true`
  // rather than `=== false` — the distinction that matters is whether we READ a
  // row, not which falsy value it holds.
  return data.has_completed_onboarding === true ? HOME : ONBOARDING_INTRO;
}
