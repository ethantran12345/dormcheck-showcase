import { applyCors } from "./_lib/cors.js";
import { enforceRateLimit, requestIp } from "./_lib/rateLimit.js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

type AuthMethodsResponse = {
  exists: boolean;
  hasPassword: boolean;
  providers: string[];
};

// Preserve the established client contract without telling an unauthenticated
// caller whether an account exists or which provider owns it. OAuth buttons are
// already offered from the selected university configuration, and password
// sign-in supplies the same generic failure for an unknown account.
const GENERIC_SIGN_IN_METHODS: AuthMethodsResponse = {
  exists: true,
  hasPassword: true,
  providers: [],
};

/**
 * Compatibility endpoint for identifier-first sign-in. It deliberately returns
 * one generic shape for every valid email: exposing account existence or an
 * OAuth provider lets unauthenticated callers enumerate students and their
 * identity-provider use. The client still renders its school-configured OAuth
 * buttons and the password path, both of which handle failures generically.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const ip = requestIp(req);
    if (
      !(await enforceRateLimit({
        res,
        action: "auth-methods",
        userId: ip,
        max: 30,
        windowSeconds: 600,
      }))
    ) {
      return;
    }

    const { email: rawEmail } = (req.body ?? {}) as { email?: string };
    const email = rawEmail?.trim().toLowerCase() ?? "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return res.status(400).json({ error: "A valid email is required" });
    }

    // Do not call the historical service-role provider lookup here. A stable
    // response prevents account and provider enumeration even when an attacker
    // rotates IPs around this route's rate limit.
    return res.status(200).json(GENERIC_SIGN_IN_METHODS);
  } catch (err) {
    console.error("auth-methods handler error:", err);
    return res.status(200).json(GENERIC_SIGN_IN_METHODS);
  }
}
