import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  getTurnstileSiteKey,
  loadTurnstile,
  type TurnstileApi,
} from "@/lib/turnstile";

export interface TurnstileHandle {
  /** Reset the widget so it issues a fresh token (Turnstile tokens are single-use). */
  reset: () => void;
  /** Current response token, if the challenge has been solved. */
  getResponse: () => string | undefined;
}

interface TurnstileWidgetProps {
  /** Fires with the token on solve, and with `null` on expiry/error/reset. */
  onToken: (token: string | null) => void;
  /** Auth page is always light (design system: pre-auth is light). */
  theme?: "light" | "dark" | "auto";
  /** Distinguishes widgets in Cloudflare analytics (e.g. "signup", "login"). */
  action?: string;
  className?: string;
}

/**
 * Cloudflare Turnstile captcha widget. Renders nothing when
 * VITE_TURNSTILE_SITE_KEY is absent (dev without a key) — auth handlers detect
 * this via `isTurnstileConfigured()` and don't block on a token, so flows keep
 * working until Ethan enables Supabase captcha enforcement.
 *
 * Explicit render + imperative `reset()` because Turnstile tokens are single-use:
 * after every auth attempt (success OR failure) the parent resets the widget so
 * a retry gets a fresh token.
 */
export const TurnstileWidget = forwardRef<TurnstileHandle, TurnstileWidgetProps>(
  ({ onToken, theme = "light", action, className }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const apiRef = useRef<TurnstileApi | null>(null);
    // Keep the latest onToken without re-rendering the widget on every parent render.
    const onTokenRef = useRef(onToken);
    onTokenRef.current = onToken;

    useImperativeHandle(
      ref,
      () => ({
        reset: () => {
          if (apiRef.current && widgetIdRef.current) {
            apiRef.current.reset(widgetIdRef.current);
            onTokenRef.current(null);
          }
        },
        getResponse: () =>
          apiRef.current && widgetIdRef.current
            ? apiRef.current.getResponse(widgetIdRef.current)
            : undefined,
      }),
      [],
    );

    useEffect(() => {
      const sitekey = getTurnstileSiteKey();
      if (!sitekey) return; // unconfigured — render nothing

      let cancelled = false;
      loadTurnstile()
        .then((api) => {
          if (cancelled || !containerRef.current) return;
          apiRef.current = api;
          widgetIdRef.current = api.render(containerRef.current, {
            sitekey,
            theme,
            action,
            callback: (token) => onTokenRef.current(token),
            "expired-callback": () => onTokenRef.current(null),
            "error-callback": () => onTokenRef.current(null),
            "timeout-callback": () => onTokenRef.current(null),
          });
        })
        .catch((err) => {
          // Script blocked/offline: leave token null so the parent shows a
          // friendly "couldn't load verification" state rather than hanging.
          console.error("[turnstile] failed to load", err);
        });

      return () => {
        cancelled = true;
        if (apiRef.current && widgetIdRef.current) {
          try {
            apiRef.current.remove(widgetIdRef.current);
          } catch {
            // widget already gone — ignore
          }
        }
        widgetIdRef.current = null;
      };
    }, [theme, action]);

    if (!getTurnstileSiteKey()) return null;

    return <div ref={containerRef} className={className} />;
  },
);

TurnstileWidget.displayName = "TurnstileWidget";
