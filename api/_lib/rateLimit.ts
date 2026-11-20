import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase } from "./supabase.js";

/**
 * Caller IP for rate-limit bucketing. The FIRST x-forwarded-for entry is
 * client-controlled (Vercel appends the real IP rather than replacing the
 * header), so a spoofed header used to grant a fresh bucket per request.
 * Prefer x-vercel-forwarded-for (set by the platform); fall back to the LAST
 * x-forwarded-for entry, which is the hop Vercel itself recorded.
 */
export function requestIp(req: VercelRequest): string {
  const vercel = req.headers["x-vercel-forwarded-for"];
  const vercelIp = (Array.isArray(vercel) ? vercel[0] : vercel)
    ?.split(",")[0]
    ?.trim();
  if (vercelIp) return vercelIp;
  const forwarded = req.headers["x-forwarded-for"];
  const parts = (
    (Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? ""
  ).split(",");
  return parts[parts.length - 1]?.trim() || "unknown";
}

/**
 * Per-caller fixed-window rate limit for the email-sending endpoints (SEC-3).
 *
 * Backed by the `check_rate_limit` SECURITY DEFINER RPC so the throttle is
 * persistent and atomic across stateless serverless invocations.
 *
 * Returns true when the request may proceed. When the limit is exceeded it
 * writes a 429 response and returns false - the handler should `return`.
 *
 * Fails CLOSED: an unavailable limiter must not turn public capture, account
 * lookup, or notification routes into an unbounded email/billing surface. The
 * caller gets a retryable 503 and the failure is logged for alerting.
 */
export async function enforceRateLimit(opts: {
  res: VercelResponse;
  /** Unique action name, e.g. 'feedback' or 'ranking-invite'. */
  action: string;
  /** Per-user identifier (the authenticated user id). */
  userId: string;
  /** Max requests allowed within the window. */
  max: number;
  /** Window length in seconds. */
  windowSeconds: number;
}): Promise<boolean> {
  const { res, action, userId, max, windowSeconds } = opts;
  if (!supabase) {
    console.error(
      `[rateLimit:${action}] service client unavailable; denying request`
    );
    res.status(503).json({
      error:
        "Request protection is temporarily unavailable. Please try again shortly.",
    });
    return false;
  }

  try {
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_bucket_key: `${action}:${userId}`,
      p_max_requests: max,
      p_window_seconds: windowSeconds,
    });

    if (error) {
      console.error(
        `[rateLimit:${action}] check failed; denying request:`,
        error.message
      );
      res.status(503).json({
        error:
          "Request protection is temporarily unavailable. Please try again shortly.",
      });
      return false;
    }

    if (data === false) {
      res.status(429).json({
        error: "Too many requests. Please slow down and try again later.",
      });
      return false;
    }

    return true;
  } catch (err) {
    console.error(`[rateLimit:${action}] threw; denying request:`, err);
    res.status(503).json({
      error:
        "Request protection is temporarily unavailable. Please try again shortly.",
    });
    return false;
  }
}
