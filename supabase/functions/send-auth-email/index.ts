/**
 * Supabase `send_email` Auth Hook - renders EVERY auth email (signup
 * confirmation, magic link / email OTP, recovery, email change, invite,
 * reauthentication) through the shared DormCheck chrome
 * (../_shared/emailTemplate.ts - same template as the /api transactional
 * emails) and sends via Resend, so all DormCheck email is one brand.
 *
 * Security: requests are signed by Supabase Auth (standardwebhooks) with
 * SEND_EMAIL_HOOK_SECRET; unsigned/mis-signed requests are rejected. JWT
 * verification is off (config.toml) because Auth posts with a webhook
 * signature, not a JWT.
 */
import { Webhook } from "npm:standardwebhooks@1.0.0";
import { getEmailHtml } from "../_shared/emailTemplate.ts";
import { fetchWithTimeout, isTimeoutError } from "../_shared/fetchWithTimeout.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
// Overridable for ONE reason: scripts/test-edge-functions.sh points it at the
// vendor stub on the Supabase docker network so the signed-webhook path can be
// driven end to end without a real Resend key. Unset in every deployed
// environment — the same seam send-push uses for APNS_HOST_URL / FCM_BASE_URL.
const RESEND_API_URL = Deno.env.get("RESEND_API_URL")?.trim() || "https://api.resend.com/emails";
// Upper bound on the Resend round trip (BA-06). This hook sits on the signup,
// magic-link and recovery path; a stalled vendor used to hold the whole auth
// flow open until the runtime killed the function.
const RESEND_TIMEOUT_MS = 8_000;
const HOOK_SECRET = (Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "").replace(
  /^v1,whsec_/,
  "",
);
const FROM = "DormCheck <noreply@dormcheck.com>";
const REPLY_TO = "support@dormcheck.com";

interface AuthEmailData {
  token: string;
  token_hash: string;
  redirect_to: string;
  email_action_type: string;
  site_url: string;
  token_new?: string;
  token_hash_new?: string;
}

interface HookPayload {
  user: { email: string; new_email?: string };
  email_data: AuthEmailData;
}

function verifyUrl(tokenHash: string, type: string, redirectTo: string): string {
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  const u = new URL(`${base}/auth/v1/verify`);
  u.searchParams.set("token", tokenHash);
  u.searchParams.set("type", type);
  u.searchParams.set("redirect_to", redirectTo || "https://dormcheck.com");
  return u.toString();
}

interface RenderedEmail {
  subject: string;
  headline: string;
  body: string;
  buttonText: string; // empty string = no CTA button (code-only email)
  buttonUrl: string;
  code?: string;
}

function renderAuthEmail(payload: HookPayload): RenderedEmail {
  const d = payload.email_data;
  const t = d.email_action_type;
  switch (t) {
    case "signup":
      return {
        subject: "Confirm your DormCheck email",
        headline: "Confirm your email",
        body: "Welcome to DormCheck! Enter this code in the app to confirm your email address, or use the button below. This code expires in 1 hour. If you didn't sign up, you can ignore this email.",
        buttonText: "Confirm Email",
        buttonUrl: verifyUrl(d.token_hash, "signup", d.redirect_to),
        code: d.token,
      };
    case "magiclink":
      return {
        subject: "Your DormCheck sign-in link",
        headline: "Sign in to DormCheck",
        body: "Use the button below to sign in, or enter this code in the app. This link and code expire in 1 hour. If you didn't request this, you can ignore this email.",
        buttonText: "Sign In",
        buttonUrl: verifyUrl(d.token_hash, "magiclink", d.redirect_to),
        code: d.token,
      };
    case "recovery":
      return {
        subject: "Reset your DormCheck password",
        headline: "Reset your password",
        body: "Use the button below to set a new password for your DormCheck account. This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email - your password won't change.",
        buttonText: "Reset Password",
        buttonUrl: verifyUrl(d.token_hash, "recovery", d.redirect_to),
      };
    case "invite":
      return {
        subject: "You're invited to DormCheck",
        headline: "You've been invited to DormCheck",
        body: "You've been invited to join DormCheck. Use the button below to accept the invite and create your account.",
        buttonText: "Accept Invite",
        buttonUrl: verifyUrl(d.token_hash, "invite", d.redirect_to),
      };
    case "email_change": {
      // Secure email change sends one email to the current address
      // (token/token_hash) and one to the new address (token_new/token_hash_new).
      const isNewAddress = Boolean(d.token_hash_new && !d.token_hash);
      const tokenHash = d.token_hash || d.token_hash_new || "";
      return {
        subject: "Confirm your DormCheck email change",
        headline: "Confirm your email change",
        body: `Confirm changing your DormCheck account email${payload.user.new_email ? ` to ${payload.user.new_email}` : ""}. If you didn't request this change, don't click the button and contact support@dormcheck.com.`,
        buttonText: "Confirm Email Change",
        buttonUrl: verifyUrl(tokenHash, "email_change", d.redirect_to),
        code: isNewAddress ? d.token_new || undefined : d.token || undefined,
      };
    }
    case "reauthentication":
      return {
        subject: "Your DormCheck verification code",
        headline: "Verify it's you",
        body: "Enter this code in the app to confirm this action on your DormCheck account. The code expires shortly. If you didn't request it, you can ignore this email.",
        buttonText: "",
        buttonUrl: "",
        code: d.token,
      };
    default:
      // Unknown/future auth email type - still send branded rather than fail.
      return {
        subject: "Your DormCheck verification code",
        headline: "Your verification code",
        body: "Use this code to continue in DormCheck. If you didn't request it, you can ignore this email.",
        buttonText: "",
        buttonUrl: "",
        code: d.token,
      };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  try {
    const rawBody = await req.text();
    const wh = new Webhook(HOOK_SECRET);
    const payload = wh.verify(
      rawBody,
      Object.fromEntries(req.headers.entries()),
    ) as HookPayload;

    const spec = renderAuthEmail(payload);
    const supabaseHost = new URL(Deno.env.get("SUPABASE_URL") ?? "https://dormcheck.com").hostname;
    const to =
      payload.email_data.email_action_type === "email_change" &&
      payload.email_data.token_hash_new && !payload.email_data.token_hash &&
      payload.user.new_email
        ? payload.user.new_email
        : payload.user.email;

    const html = getEmailHtml(
      spec.headline,
      spec.body,
      spec.buttonText,
      spec.buttonUrl,
      undefined, // auth/security emails never carry an unsubscribe link
      { code: spec.code, extraButtonHosts: [supabaseHost] },
    );

    // The send has its own catch: the outer one below answers 401 "invalid
    // signature" for anything thrown, and a vendor timeout is not a bad signature.
    let res: Response;
    try {
      res = await fetchWithTimeout(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM,
          to,
          reply_to: REPLY_TO,
          subject: spec.subject,
          html,
        }),
      }, RESEND_TIMEOUT_MS);
    } catch (e) {
      console.error(
        "[send-auth-email] Resend unreachable:",
        isTimeoutError(e) ? `timed out after ${RESEND_TIMEOUT_MS}ms` : (e instanceof Error ? e.message : e),
      );
      return new Response(
        JSON.stringify({ error: { http_code: 500, message: "email send failed" } }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    if (!res.ok) {
      const err = await res.text();
      console.error("[send-auth-email] Resend error:", res.status, err);
      return new Response(
        JSON.stringify({ error: { http_code: 500, message: "email send failed" } }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({}), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[send-auth-email] rejected:", e instanceof Error ? e.message : e);
    return new Response(
      JSON.stringify({ error: { http_code: 401, message: "invalid signature" } }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }
});
