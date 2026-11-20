// Cloudflare Turnstile — script loader + config helpers.
//
// Supabase Auth's "Enable Captcha protection" is GLOBAL across auth endpoints:
// once Ethan flips it on (Dashboard → Authentication → Attack Protection,
// provider = Turnstile), every signUp / signInWithPassword / signInWithOtp /
// resetPasswordForEmail / resend call MUST carry `options.captchaToken` or it
// fails. This module owns the one-time load of Cloudflare's widget script; the
// token lifecycle lives in `TurnstileWidget` + `useTurnstile`.
//
// The site key is PUBLIC and ships in the client bundle (VITE_TURNSTILE_SITE_KEY).
// The secret goes ONLY in the Supabase dashboard — never the repo or Vercel.
//
// Loads in both surfaces: web (Vercel CSP allows challenges.cloudflare.com — see
// vercel.json) and the Capacitor iOS webview (no meta-CSP; ATS permits HTTPS).

// Cloudflare's explicit-render script. `render=explicit` means we control when
// each widget mounts (so we can reset single-use tokens after every attempt).
const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export interface TurnstileRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  "error-callback"?: () => void;
  "expired-callback"?: () => void;
  "timeout-callback"?: () => void;
  theme?: "light" | "dark" | "auto";
  appearance?: "always" | "execute" | "interaction-only";
  size?: "normal" | "flexible" | "compact";
  action?: string;
}

export interface TurnstileApi {
  render: (el: HTMLElement, opts: TurnstileRenderOptions) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
  getResponse: (widgetId?: string) => string | undefined;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** The public site key, or `undefined` when unconfigured (dev without a key). */
export function getTurnstileSiteKey(): string | undefined {
  const key = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
  return key && key.trim().length > 0 ? key.trim() : undefined;
}

/**
 * Whether a captcha widget should render at all. When false, auth handlers must
 * NOT block on a token — this keeps dev environments (and any build missing the
 * key) working while Supabase enforcement is still OFF. Once Ethan enables
 * enforcement, the key must be present in every environment or auth will fail.
 */
export function isTurnstileConfigured(): boolean {
  return getTurnstileSiteKey() !== undefined;
}

let loadPromise: Promise<TurnstileApi> | null = null;

/** Idempotently load the Turnstile script and resolve once `window.turnstile` is ready. */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Turnstile can only load in the browser"));
  }
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const finish = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("Turnstile script loaded but window.turnstile is missing"));
    };

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src^="https://challenges.cloudflare.com/turnstile/"]`,
    );
    if (existing) {
      if (window.turnstile) return finish();
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener("error", () => reject(new Error("Turnstile script failed to load")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", finish, { once: true });
    script.addEventListener(
      "error",
      () => {
        loadPromise = null; // allow a later retry
        reject(new Error("Turnstile script failed to load"));
      },
      { once: true },
    );
    document.head.appendChild(script);
  });

  return loadPromise;
}
