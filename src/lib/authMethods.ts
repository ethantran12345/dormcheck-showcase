import { resolveApiUrl } from '@/lib/apiPost';
import type { AuthMethod } from '@/config/universities';

/**
 * Server-side sign-in-method detection. Given an email, the rate-limited
 * /api/auth-methods endpoint reports whether the account exists, whether it has
 * a password, and which OAuth providers it uses - so the auth page can hide the
 * password field for OAuth-only accounts and steer them to their provider.
 *
 * This is the one place we ask the server about an email's providers (see the
 * note in lastAuthMethod.ts): the enumeration surface is confined to that
 * throttled endpoint. Everything here fails OPEN to the password field so a
 * real user is never locked out.
 */

export type AuthMethodsLookup = {
  exists: boolean;
  hasPassword: boolean;
  /** Supabase provider strings, e.g. 'email', 'google', 'azure'. */
  providers: string[];
};

export async function resolveAuthMethods(email: string): Promise<AuthMethodsLookup | null> {
  const trimmed = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  try {
    const resp = await fetch(resolveApiUrl('/api/auth-methods'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: trimmed }),
    });
    if (!resp.ok) return null;
    const data = (await resp.json().catch(() => null)) as Partial<AuthMethodsLookup> | null;
    if (!data) return null;
    return {
      exists: data.exists ?? true,
      hasPassword: data.hasPassword ?? true,
      providers: Array.isArray(data.providers) ? data.providers : [],
    };
  } catch {
    return null;
  }
}

export type SignInStage = {
  mode: 'password' | 'oauth-only' | 'oauth-unavailable' | 'signup';
  /**
   * Set when mode is 'oauth-only' (the provider to push the user toward) or
   * 'oauth-unavailable' (the provider this account uses, which this shell
   * cannot offer).
   */
  oauthMethod?: AuthMethod;
};

/** Supabase provider string -> the app's per-school AuthMethod vocabulary. */
function providerToAuthMethod(provider: string): AuthMethod | null {
  if (provider === 'google') return 'google';
  if (provider === 'azure' || provider === 'microsoft') return 'microsoft';
  return null; // 'email' and anything else are not OAuth buttons
}

/**
 * Map a lookup result to the sign-in UI stage. Pure - unit-tested.
 *
 * - lookup unavailable (null: network failure / endpoint absent) -> password:
 *   fail SAFE to sign-IN, never auto-offer create-account for an email we can't
 *   prove is brand new (an existing password user can still sign in; a Google
 *   user's attempt fails with the "use Google" hint).
 * - server positively says no account (exists === false) -> signup (legit new
 *   registration; the only path to the create-password stage).
 * - has a password -> password field
 * - OAuth-only, and that provider is offered by the school -> push to it
 * - OAuth-only but no offered provider matches (edge: seeded account) ->
 *   fall to the password field; the generic failure messaging still applies
 */
export function deriveSignInStage(
  lookup: AuthMethodsLookup | null,
  offeredMethods: readonly AuthMethod[],
): SignInStage {
  if (!lookup) return { mode: 'password' };
  if (!lookup.exists) return { mode: 'signup' };
  if (lookup.hasPassword) return { mode: 'password' };
  for (const provider of lookup.providers) {
    const method = providerToAuthMethod(provider);
    if (method && offeredMethods.includes(method)) {
      return { mode: 'oauth-only', oauthMethod: method };
    }
  }
  return { mode: 'password' };
}

/**
 * Which SSO buttons a given shell may render, out of the school's offered
 * methods. Pure - unit-tested, because this is the App Store compliance gate
 * and a silent regression here is a rejected build.
 *
 * - **iOS hides Google.** Guideline 4.8: an app offering a third-party login
 *   must also offer a privacy-preserving equivalent (Sign in with Apple),
 *   UNLESS it uses its own account system exclusively. Build 30 was rejected;
 *   we take the exclusivity exemption, so email + password is the only iOS
 *   sign-in method. Re-showing Google re-opens the rejection.
 * - **Android hides Microsoft:** its deep-link return has no custom-scheme
 *   intent filter there yet.
 * - `'email'` is never an SSO button, so it is always filtered out.
 *
 * Mobile Chrome reports platform 'web', so responsive web keeps every method -
 * this is a shell presentation gate, not a change to the tenant registry
 * (`src/config/universities.ts` still lists 'google' for Pitt).
 */
export function visibleSsoMethodsFor(
  offeredMethods: readonly AuthMethod[],
  platform: string,
): AuthMethod[] {
  return offeredMethods.filter(
    (m) =>
      m !== 'email' &&
      !(platform === 'android' && m === 'microsoft') &&
      !(platform === 'ios' && m === 'google'),
  );
}

/**
 * Shell-aware wrapper over `deriveSignInStage`. Pure - unit-tested.
 *
 * A school can OFFER a provider that the current shell does not SHOW. The iOS
 * app is the live case: App Store guideline 4.8 makes us either add a
 * privacy-preserving login or use our own account system exclusively, and we
 * chose the latter, so the iOS shell hides Google (see Auth.tsx).
 *
 * Without this, an existing Google-only user opening the iOS app derived
 * 'oauth-only', found no Google button, and fell through to a password field
 * for a password they never set - a hard lockout. `'oauth-unavailable'` is that
 * dead end made explicit, so the UI can offer a set-a-password path instead.
 *
 * `visibleOAuthMethods` is what this shell actually renders; on web it equals
 * the school's methods and this function is a pass-through.
 */
export function deriveShellSignInStage(
  lookup: AuthMethodsLookup | null,
  offeredMethods: readonly AuthMethod[],
  visibleOAuthMethods: readonly AuthMethod[],
): SignInStage {
  const stage = deriveSignInStage(lookup, offeredMethods);
  if (
    stage.mode === 'oauth-only' &&
    stage.oauthMethod &&
    !visibleOAuthMethods.includes(stage.oauthMethod)
  ) {
    return { mode: 'oauth-unavailable', oauthMethod: stage.oauthMethod };
  }
  return stage;
}
