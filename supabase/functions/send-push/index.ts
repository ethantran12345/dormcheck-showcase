/**
 * Internal push dispatcher - iOS via APNs, Android via FCM HTTP v1.
 *
 * Android needs the FCM_SERVICE_ACCOUNT_JSON secret (Firebase service-account
 * JSON; project id read from its project_id). If unset, Android tokens are
 * skipped with a log - iOS delivery is unaffected.
 *
 * Security: Bearer SEND_PUSH_AUTH_TOKEN (callers / DB triggers). SUPABASE_SERVICE_ROLE_KEY
 * is used only for the Supabase client (device_tokens queries). Not for request auth.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as jose from "npm:jose@5.9.6";
import { isWithinQuietHours } from "../_shared/quietHours.ts";
import { fetchWithTimeout } from "../_shared/fetchWithTimeout.ts";
import { timingSafeEqual } from "../_shared/timingSafeEqual.ts";

// Upper bounds on each vendor round trip (BA-06). The per-device loops below are
// sequential, so before this one slow APNs or FCM answer stalled every device
// queued behind it until the runtime killed the function; the OAuth mint gated
// every Android send the same way. A timeout surfaces as a thrown TimeoutError,
// which each call site already treats as "this send failed, move on".
const VENDOR_OAUTH_TIMEOUT_MS = 8_000;
const VENDOR_SEND_TIMEOUT_MS = 10_000;

const APNS_HOST_PRODUCTION = "https://api.push.apple.com";
const APNS_HOST_SANDBOX = "https://api.sandbox.push.apple.com";

// The three vendor endpoints, overridable by env. They exist for ONE reason: the
// driven gate (scripts/test-edge-push.sh) points them at a stub container on the
// Supabase docker network, because a probe that needs a real APNs key + a real
// Firebase project is a probe that gets skipped in CI and rots. Unset in every
// deployed environment, which is why each falls back to the real host. Exactly the
// seam moderate-listing already uses for OPENAI_MODERATIONS_URL /
// ANTHROPIC_MESSAGES_URL — delivery is the INPUT to the fan-out logic under test,
// not the logic itself.
const APNS_HOST_OVERRIDE = Deno.env.get("APNS_HOST_URL")?.trim();
const FCM_BASE_URL = Deno.env.get("FCM_BASE_URL")?.trim() || "https://fcm.googleapis.com";
const GOOGLE_OAUTH_TOKEN_URL =
  Deno.env.get("GOOGLE_OAUTH_TOKEN_URL")?.trim() || "https://oauth2.googleapis.com/token";

// Per-invocation trace (token minting, host selection, per-token outcomes). Off
// by default: every push wrote ~6 lines, which buried the errors that matter in
// the function log. Set SEND_PUSH_DEBUG=1 to turn it back on while debugging
// delivery. Errors, warnings and the one-line "done" summary always print.
const DEBUG = Deno.env.get("SEND_PUSH_DEBUG") === "1";
function debugLog(...args: unknown[]): void {
  if (DEBUG) console.log(...args);
}

function resolveApnsHost(): { host: string; env: "production" | "sandbox" | "override" } {
  if (APNS_HOST_OVERRIDE) {
    return { host: APNS_HOST_OVERRIDE, env: "override" };
  }
  const raw = (Deno.env.get("APNS_ENV") ?? "sandbox").trim().toLowerCase();
  if (raw === "production" || raw === "prod") {
    return { host: APNS_HOST_PRODUCTION, env: "production" };
  }
  return { host: APNS_HOST_SANDBOX, env: "sandbox" };
}

type PushRequestBody = {
  user_id?: unknown;
  title?: unknown;
  body?: unknown;
  data?: unknown;
};

type TokenResult = {
  /** Redacted token prefix; full device tokens never leave this function. */
  token: string;
  success: boolean;
  status?: number;
  error?: string;
};

function redactToken(token: string): string {
  return `${token.slice(0, 8)}…`;
}

type CachedApnsJwt = {
  jwt: string;
  expiresAtMs: number;
};

let cachedApnsJwt: CachedApnsJwt | null = null;
let cachedSigningKey: CryptoKey | null = null;

// ---------------------------------------------------------------------------
// FCM (Android)

type FcmServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

let cachedFcmAccessToken: { token: string; expiresAtMs: number } | null = null;
let cachedFcmSigningKey: CryptoKey | null = null;

function readFcmServiceAccount(): FcmServiceAccount | null {
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.project_id && parsed.client_email && parsed.private_key) {
      return parsed as FcmServiceAccount;
    }
  } catch {
    // fall through
  }
  console.error("[send-push] FCM_SERVICE_ACCOUNT_JSON is set but invalid");
  return null;
}

async function getFcmAccessToken(account: FcmServiceAccount): Promise<string> {
  const nowMs = Date.now();
  if (cachedFcmAccessToken && cachedFcmAccessToken.expiresAtMs > nowMs + 60_000) {
    return cachedFcmAccessToken.token;
  }
  if (!cachedFcmSigningKey) {
    cachedFcmSigningKey = await jose.importPKCS8(
      normalizePrivateKeyPem(account.private_key),
      "RS256",
    );
  }
  const assertion = await new jose.SignJWT({
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(account.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(cachedFcmSigningKey);

  const res = await fetchWithTimeout(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  }, VENDOR_OAUTH_TIMEOUT_MS);
  if (!res.ok) {
    throw new Error(`FCM OAuth token exchange failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedFcmAccessToken = {
    token: json.access_token,
    expiresAtMs: nowMs + (json.expires_in ?? 3600) * 1000,
  };
  debugLog("[send-push] minted new FCM access token");
  return json.access_token;
}

async function sendToFcm(
  deviceToken: string,
  accessToken: string,
  projectId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; error?: string; unregistered?: boolean }> {
  // FCM data values must be strings.
  const stringData: Record<string, string> = {};
  if (data) {
    for (const [k, v] of Object.entries(data)) {
      stringData[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
  }
  const res = await fetchWithTimeout(
    `${FCM_BASE_URL}/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          notification: { title, body },
          data: stringData,
          android: { notification: { channel_id: "default" } },
        },
      }),
    },
    VENDOR_SEND_TIMEOUT_MS,
  );
  if (res.ok) return { ok: true, status: res.status };

  let errorText = res.statusText;
  try {
    const text = await res.text();
    if (text) errorText = text;
  } catch {
    // ignore body read errors
  }
  // Stale/uninstalled tokens: 404 with errorCode UNREGISTERED (FCM's analog of
  // APNs 410).
  const unregistered = res.status === 404 || errorText.includes("UNREGISTERED");
  return { ok: false, status: res.status, error: errorText, unregistered };
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function bearer(req: Request): string | null {
  const h = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!h || !/^Bearer\s+/i.test(h)) return null;
  const t = h.replace(/^Bearer\s+/i, "").trim();
  return t.length > 0 ? t : null;
}

function normalizePrivateKeyPem(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("\\n")) {
    return trimmed.replace(/\\n/g, "\n");
  }
  return trimmed;
}

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v?.trim()) {
    throw new Error(`Missing env: ${name}`);
  }
  return v.trim();
}

async function getApnsSigningKey(privateKeyPem: string): Promise<CryptoKey> {
  if (cachedSigningKey) return cachedSigningKey;
  const key = await jose.importPKCS8(normalizePrivateKeyPem(privateKeyPem), "ES256");
  cachedSigningKey = key;
  return key;
}

async function getApnsJwt(
  keyId: string,
  teamId: string,
  privateKeyPem: string,
): Promise<string> {
  const nowMs = Date.now();
  if (cachedApnsJwt && cachedApnsJwt.expiresAtMs > nowMs + 60_000) {
    return cachedApnsJwt.jwt;
  }

  const signingKey = await getApnsSigningKey(privateKeyPem);
  const jwt = await new jose.SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt()
    .sign(signingKey);

  cachedApnsJwt = { jwt, expiresAtMs: nowMs + 3_600_000 };
  debugLog("[send-push] minted new APNs provider JWT");
  return jwt;
}

function buildApnsPayload(
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    aps: {
      alert: { title, body },
      sound: "default",
      badge: 1,
    },
  };
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const [k, v] of Object.entries(data)) {
      if (k !== "aps") payload[k] = v;
    }
  }
  return payload;
}

async function sendToApns(
  deviceToken: string,
  apnsJwt: string,
  bundleId: string,
  payload: Record<string, unknown>,
  apnsHost: string,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const url = `${apnsHost}/3/device/${deviceToken}`;
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      authorization: `bearer ${apnsJwt}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  }, VENDOR_SEND_TIMEOUT_MS);

  if (res.ok) {
    return { ok: true, status: res.status };
  }

  let errorText = res.statusText;
  try {
    const text = await res.text();
    if (text) errorText = text;
  } catch {
    // ignore body read errors
  }
  return { ok: false, status: res.status, error: errorText };
}

async function removeStaleToken(
  supabase: SupabaseClient,
  token: string,
): Promise<void> {
  const { error } = await supabase.from("device_tokens").delete().eq("token", token);
  if (error) {
    console.warn("[send-push] failed to delete stale token:", token.slice(0, 8), error.message);
  } else {
    debugLog("[send-push] removed stale token:", token.slice(0, 8));
  }
}

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const { host: apnsHost, env: apnsEnv } = resolveApnsHost();
  debugLog("[send-push] APNs host:", apnsEnv, apnsHost);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[send-push] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return jsonResponse({ error: "Server configuration error" }, 500);
  }

  const expectedAuthToken = Deno.env.get("SEND_PUSH_AUTH_TOKEN");
  if (!expectedAuthToken) {
    console.error("[send-push] missing SEND_PUSH_AUTH_TOKEN");
    return jsonResponse({ error: "Server configuration error" }, 500);
  }
  // Constant-time compare (BA-05): this bearer check is the function's ENTIRE gate
  // (verify_jwt is off), and `!==` returns at the first differing byte.
  const authToken = bearer(req);
  if (!authToken || !timingSafeEqual(authToken, expectedAuthToken)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let apnsKeyId: string;
  let apnsTeamId: string;
  let apnsBundleId: string;
  let apnsPrivateKey: string;
  try {
    apnsKeyId = requireEnv("APNS_KEY_ID");
    apnsTeamId = requireEnv("APNS_TEAM_ID");
    apnsBundleId = requireEnv("APNS_BUNDLE_ID");
    apnsPrivateKey = requireEnv("APNS_PRIVATE_KEY");
  } catch (e) {
    console.error("[send-push]", e);
    return jsonResponse({ error: "APNs not configured" }, 500);
  }

  let body: PushRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const pushBody = typeof body.body === "string" ? body.body.trim() : "";
  if (!userId || !title || !pushBody) {
    return jsonResponse({ error: "user_id, title, and body are required" }, 400);
  }

  let customData: Record<string, unknown> | undefined;
  if (body.data !== undefined && body.data !== null) {
    if (typeof body.data !== "object" || Array.isArray(body.data)) {
      return jsonResponse({ error: "data must be a JSON object" }, 400);
    }
    customData = body.data as Record<string, unknown>;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Quiet hours (R7): suppress PUSH when the recipient's local time is inside their
  // Do Not Disturb window. This is the single choke point every push converges on
  // (Vercel /api senders and the private.dispatch_push() DB triggers all POST here),
  // so gating once here covers every path. It is category-independent - email is
  // untouched (that gating lives upstream). Fails OPEN on any error so a bad config
  // or a not-yet-migrated project never breaks delivery.
  try {
    const { data: qh } = await supabase
      .from("profiles")
      .select("quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_timezone")
      .eq("id", userId)
      .maybeSingle();
    if (
      qh &&
      isWithinQuietHours(
        {
          enabled: qh.quiet_hours_enabled as boolean | null,
          start: qh.quiet_hours_start as string | null,
          end: qh.quiet_hours_end as string | null,
          timezone: qh.quiet_hours_timezone as string | null,
        },
        Date.now(),
      )
    ) {
      debugLog("[send-push] suppressed by quiet hours for user:", userId);
      return jsonResponse({ sent: 0, failed: 0, suppressed: "quiet_hours", results: [] }, 200);
    }
  } catch (e) {
    console.warn("[send-push] quiet-hours check failed; sending anyway:", e);
  }

  const { data: rows, error: tokensError } = await supabase
    .from("device_tokens")
    .select("token, platform")
    .eq("user_id", userId)
    .in("platform", ["ios", "android"]);

  if (tokensError) {
    console.error("[send-push] device_tokens query failed:", tokensError.message);
    return jsonResponse({ error: "Failed to load device tokens" }, 500);
  }

  const iosTokens: string[] = [];
  const androidTokens: string[] = [];
  for (const r of rows ?? []) {
    const t = typeof r.token === "string" ? r.token : "";
    if (!t) continue;
    if (r.platform === "android") androidTokens.push(t);
    else iosTokens.push(t);
  }

  if (iosTokens.length === 0 && androidTokens.length === 0) {
    debugLog("[send-push] no device tokens for user:", userId);
    return jsonResponse({ sent: 0, failed: 0, results: [] }, 200);
  }

  const results: TokenResult[] = [];

  if (iosTokens.length > 0) {
    let apnsJwt: string;
    try {
      apnsJwt = await getApnsJwt(apnsKeyId, apnsTeamId, apnsPrivateKey);
    } catch (e) {
      console.error("[send-push] APNs JWT signing failed:", e);
      return jsonResponse({ error: "APNs JWT signing failed" }, 500);
    }

    const apnsPayload = buildApnsPayload(title, pushBody, customData);

    for (const token of iosTokens) {
      try {
        const outcome = await sendToApns(token, apnsJwt, apnsBundleId, apnsPayload, apnsHost);
        if (outcome.ok) {
          results.push({ token: redactToken(token), success: true, status: outcome.status });
          continue;
        }

        if (outcome.status === 410) {
          await removeStaleToken(supabase, token);
        }

        results.push({
          token: redactToken(token),
          success: false,
          status: outcome.status,
          error: outcome.error,
        });
        console.warn(
          "[send-push] APNs error",
          token.slice(0, 8),
          outcome.status,
          outcome.error,
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        results.push({ token: redactToken(token), success: false, error: message });
        console.error("[send-push] send threw for token", token.slice(0, 8), e);
      }
    }
  }

  if (androidTokens.length > 0) {
    const fcmAccount = readFcmServiceAccount();
    if (!fcmAccount) {
      console.warn(
        "[send-push] FCM_SERVICE_ACCOUNT_JSON not configured; skipping",
        androidTokens.length,
        "android token(s)",
      );
    } else {
      let fcmAccessToken: string | null = null;
      try {
        fcmAccessToken = await getFcmAccessToken(fcmAccount);
      } catch (e) {
        console.error("[send-push] FCM access token failed:", e);
      }
      if (fcmAccessToken) {
        for (const token of androidTokens) {
          try {
            const outcome = await sendToFcm(
              token,
              fcmAccessToken,
              fcmAccount.project_id,
              title,
              pushBody,
              customData,
            );
            if (outcome.ok) {
              results.push({ token: redactToken(token), success: true, status: outcome.status });
              continue;
            }

            if (outcome.unregistered) {
              await removeStaleToken(supabase, token);
            }

            results.push({
              token: redactToken(token),
              success: false,
              status: outcome.status,
              error: outcome.error,
            });
            console.warn(
              "[send-push] FCM error",
              token.slice(0, 8),
              outcome.status,
              outcome.error,
            );
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            results.push({ token: redactToken(token), success: false, error: message });
            console.error("[send-push] FCM send threw for token", token.slice(0, 8), e);
          }
        }
      }
    }
  }

  const sent = results.filter((r) => r.success).length;
  const failed = results.length - sent;
  console.log("[send-push] done", {
    userId,
    sent,
    failed,
    ios: iosTokens.length,
    android: androidTokens.length,
  });

  return jsonResponse({ sent, failed, results }, 200);
});
