import { useCallback, useRef, useState } from "react";
import type { AuthError } from "@supabase/supabase-js";
import type { TurnstileHandle } from "@/components/auth/TurnstileWidget";
import { isTurnstileConfigured } from "@/lib/turnstile";

/**
 * Owns the Turnstile token lifecycle for one auth form. Pair with a
 * <TurnstileWidget ref={turnstile.ref} onToken={turnstile.setToken} />.
 *
 * Usage in a submit handler:
 *   const { error } = await supabase.auth.signUp({
 *     email, password,
 *     options: { emailRedirectTo, captchaToken: turnstile.captchaToken },
 *   });
 *   turnstile.reset();                       // tokens are single-use
 *   if (isCaptchaError(error)) { ...friendly copy... }
 *
 * Gate submit with `disabled={!turnstile.ready}`.
 */
export function useTurnstile() {
  const ref = useRef<TurnstileHandle>(null);
  const [token, setToken] = useState<string | null>(null);
  const configured = isTurnstileConfigured();

  const reset = useCallback(() => {
    ref.current?.reset();
    setToken(null);
  }, []);

  return {
    /** Attach to <TurnstileWidget ref={...}>. */
    ref,
    /** Pass to <TurnstileWidget onToken={...}>. */
    setToken,
    /** Current token (null until solved). */
    token,
    /** Reset the widget for a fresh single-use token — call after every attempt. */
    reset,
    /** True when Turnstile is set up for this build. */
    configured,
    /**
     * Whether submit should be allowed. When Turnstile is unconfigured (dev
     * without a key) this is always true so flows aren't blocked before Ethan
     * enables Supabase enforcement; when configured, requires a solved token.
     */
    ready: !configured || token !== null,
    /** Value for `options.captchaToken`; undefined when unconfigured. */
    captchaToken: token ?? undefined,
  };
}

/**
 * True when a Supabase auth error is a captcha rejection — i.e. the token was
 * missing, already used, or invalid ("captcha protection: request disallowed").
 * Handlers show a friendly retry message and auto-reset the widget on this.
 */
export function isCaptchaError(error: AuthError | null | undefined): boolean {
  if (!error) return false;
  const msg = error.message?.toLowerCase() ?? "";
  return msg.includes("captcha");
}

/** User-facing copy for a captcha failure (no em dashes — repo copy rule). */
export const CAPTCHA_ERROR_MESSAGE =
  "Couldn't verify you're human. Please complete the check and try again.";
