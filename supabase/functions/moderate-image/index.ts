/**
 * Image-only safety screen for every upload path that is NOT a marketplace
 * listing (Supabase Edge Function).
 *
 * `moderate-listing` already ran the free OpenAI omni-moderation screen over
 * listing text + photos, but it was invoked from exactly one of seven image
 * upload call sites. The other six — profile photos, DM photos, roommate post
 * photos, room-setup photos, business logos/banners, admin dorm photos — landed
 * unscreened in buckets that are public-read, i.e. retrievable by URL with no
 * authentication. This function closes that gap: same screen, same category
 * buckets, same fail-closed posture, addressable by any caller that has an
 * uploaded object and needs a verdict before the image becomes visible.
 *
 * It is deliberately thin. It takes storage URLs and returns approve/hold/reject
 * and nothing else — never the raw provider payload, which would leak per-category
 * scores to the client.
 *
 * Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY, ALLOWED_ORIGINS.
 *
 * Auth: JWT-verified in-function against the project JWKS, AND pinned at the
 * gateway by ./config.toml (`verify_jwt = true`). Both, on purpose — an image
 * endpoint that fetches URLs on the caller's behalf must never become reachable
 * unauthenticated if a deploy flag regresses.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as jose from "npm:jose@5.9.6";
import { MAX_IMAGES, screenWithOpenAI } from "../_shared/omniModeration.ts";
import {
  QUARANTINE_BUCKET,
  imageDisposition,
  parsePublicStorageUrl,
  preserveUntil,
  quarantinePathFor,
} from "../_shared/quarantine.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Per-user fixed window. A profile save with five photos is two batched calls,
// so this is generous for real use and tight enough that the endpoint is not a
// free image-fetch amplifier.
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_SECONDS = 300;

/**
 * Which surface the image belongs to. Doubles as `moderation_actions.content_type`
 * on a reject, so this list and the CHECK in
 * 20260916000000_moderation_actions_automated_image_screen.sql must stay in sync.
 */
const CONTEXTS = new Set([
  "profile_photo",
  "dm_photo",
  "roommate_post_photo",
  "setup_photo",
  "business_image",
  "dorm_photo",
]);

const allowedOrigins = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ?? Deno.env.get("ALLOWED_ORIGIN") ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0)
);

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  return {
    ...(origin && allowedOrigins.has(origin)
      ? { "Access-Control-Allow-Origin": origin }
      : {}),
    Vary: "Origin",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

function jsonResponse(req: Request, body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersFor(req) },
  });
}

function extractBearerJwt(req: Request): string | null {
  const h =
    req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!h || !/^Bearer\s+/i.test(h)) return null;
  const token = h.replace(/^Bearer\s+/i, "").trim();
  return token.length > 0 ? token : null;
}

/**
 * SSRF guard. OpenAI fetches every URL we hand it, so an unrestricted
 * `image_urls` would turn an authenticated endpoint into a fetch-anything proxy
 * pointed at internal hosts. Only this project's PUBLIC storage prefix is
 * accepted — which is exactly what every caller uploads to first.
 *
 * The local runtime sees `SUPABASE_URL` as the in-network Kong host while the
 * browser holds `127.0.0.1:54321`, so the loopback prefixes are allowed only
 * when the runtime is itself local (same test as the JWT issuer allowlist).
 */
function storagePrefixes(supabaseUrl: string): string[] {
  const origin = supabaseUrl.replace(/\/$/, "");
  const isLocalRuntime =
    /^https?:\/\/(kong|localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?$/i.test(
      origin
    );
  const origins = [
    origin,
    ...(isLocalRuntime
      ? ["http://127.0.0.1:54321", "http://localhost:54321", "http://kong:8000"]
      : []),
  ];
  return origins.map((o) => `${o}/storage/v1/object/public/`);
}

type ServiceClient = SupabaseClient;

/**
 * Move each object into the private quarantine bucket. Returns the destination
 * paths of the ones actually preserved. A failed copy leaves the object where it
 * was and is logged loudly; the response's `quarantined` count says how many made it.
 */
async function quarantineObjects(
  supabase: ServiceClient,
  imageUrls: string[],
  context: string,
  now: Date,
): Promise<string[]> {
  const paths: string[] = [];
  for (const url of imageUrls) {
    const ref = parsePublicStorageUrl(url);
    if (!ref) continue;
    const dest = quarantinePathFor(ref, context, now);
    const { error: copyErr } = await supabase.storage
      .from(ref.bucket)
      .copy(ref.path, dest, { destinationBucket: QUARANTINE_BUCKET });
    if (copyErr) {
      console.error(
        `[moderate-image] QUARANTINE FAILED for ${ref.bucket}/${ref.path}: ${copyErr.message} — object was NOT preserved`,
      );
      continue;
    }
    const { error: rmErr } = await supabase.storage.from(ref.bucket).remove([ref.path]);
    if (rmErr) {
      // Copied but not removed: the public copy is still there. The caller's
      // delete normally finishes the job; say so if it did not.
      console.error(`[moderate-image] quarantined but source remove failed for ${ref.bucket}/${ref.path}: ${rmErr.message}`);
    }
    paths.push(dest);
  }
  return paths;
}

/** Delete held objects from their public bucket. Returns how many were removed. */
async function deleteObjects(supabase: ServiceClient, imageUrls: string[]): Promise<number> {
  const byBucket = new Map<string, string[]>();
  for (const url of imageUrls) {
    const ref = parsePublicStorageUrl(url);
    if (!ref) continue;
    byBucket.set(ref.bucket, [...(byBucket.get(ref.bucket) ?? []), ref.path]);
  }
  let removed = 0;
  for (const [bucket, paths] of byBucket) {
    const { data, error } = await supabase.storage.from(bucket).remove(paths);
    if (error) {
      console.error(`[moderate-image] held-object delete failed for ${bucket}: ${error.message}`);
      continue;
    }
    removed += Array.isArray(data) ? data.length : 0;
  }
  return removed;
}

async function recordAction(
  supabase: ServiceClient,
  row: {
    action: "auto_reject_image" | "auto_hold_image";
    context: string;
    contentId: string;
    reason: string;
    quarantinePath: string | null;
    preserveUntil: string | null;
  },
): Promise<string | null> {
  const { data, error } = await supabase.from("moderation_actions").insert({
    admin_id: null, // automated actor, not a human moderator
    action: row.action,
    content_type: row.context,
    content_id: row.contentId,
    reason: row.reason.slice(0, 500),
    quarantine_path: row.quarantinePath,
    preserve_until: row.preserveUntil,
  }).select("id").maybeSingle();
  if (error) {
    // The verdict still stands — an audit-write failure must never turn a
    // refusal into an approval.
    console.error("[moderate-image] audit insert failed:", error.message);
    return null;
  }
  return (data as { id?: string } | null)?.id ?? null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        ...corsHeadersFor(req),
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }
  if (req.method !== "POST")
    return jsonResponse(req, { error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!supabaseUrl || !serviceRoleKey || !openaiKey) {
    return jsonResponse(req, { error: "Server configuration error" }, 500);
  }

  const jwt = extractBearerJwt(req);
  if (!jwt)
    return jsonResponse(req, { error: "Missing Authorization header" }, 401);

  const authOrigin = supabaseUrl.replace(/\/$/, "");
  const JWKS = jose.createRemoteJWKSet(
    new URL(`${authOrigin}/auth/v1/.well-known/jwks.json`)
  );
  const isLocalRuntime =
    /^https?:\/\/(kong|localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?$/i.test(
      authOrigin
    );
  const allowedIssuers = [
    `${authOrigin}/auth/v1`,
    ...(isLocalRuntime
      ? ["http://127.0.0.1:54321/auth/v1", "http://localhost:54321/auth/v1"]
      : []),
  ];

  let userId: string;
  try {
    const { payload } = await jose.jwtVerify(jwt, JWKS, {
      issuer: allowedIssuers,
      audience: "authenticated",
    });
    if (typeof payload.sub !== "string" || !payload.sub) {
      return jsonResponse(req, { error: "Invalid token" }, 401);
    }
    userId = payload.sub;
  } catch (e) {
    console.error("[moderate-image] jwt verify failed:", e);
    return jsonResponse(req, { error: "Invalid or expired token" }, 401);
  }

  let imageUrls: string[];
  let context: string;
  let contentId: string;
  try {
    const body = await req.json();
    const raw = body?.image_urls;
    if (!Array.isArray(raw) || raw.length === 0) {
      return jsonResponse(req, { error: "image_urls required" }, 400);
    }
    // Batching is the caller's job: silently dropping the images past the cap
    // would report "approved" for a set we never actually screened.
    if (raw.length > MAX_IMAGES) {
      return jsonResponse(
        req,
        { error: `at most ${MAX_IMAGES} image_urls per call` },
        400
      );
    }
    imageUrls = raw.map((u: unknown) => String(u ?? ""));
    const prefixes = storagePrefixes(supabaseUrl);
    if (!imageUrls.every((u) => prefixes.some((p) => u.startsWith(p)))) {
      return jsonResponse(
        req,
        { error: "image_urls must be public storage URLs of this project" },
        400
      );
    }
    context = String(body?.context ?? "");
    if (!CONTEXTS.has(context)) {
      return jsonResponse(req, { error: "valid context required" }, 400);
    }
    // The audit row needs a uuid. Callers that screen before their row exists
    // (a profile photo, a DM photo) have nothing to point at yet, so the
    // uploader is the subject — which is the useful key for that trail anyway.
    const rawId = String(body?.content_id ?? "");
    contentId = UUID_PATTERN.test(rawId) ? rawId : userId;
  } catch {
    return jsonResponse(req, { error: "Invalid JSON body" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: withinLimit, error: rateErr } = await supabase.rpc(
    "check_rate_limit",
    {
      p_bucket_key: `moderate-image:${userId}`,
      p_max_requests: RATE_LIMIT_MAX,
      p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
    }
  );
  if (rateErr) {
    // Fail closed: if we cannot prove the caller is under the limit, we do not
    // screen and the caller does not get an approval.
    console.error("[moderate-image] rate limit check failed:", rateErr.message);
    return jsonResponse(req, { error: "Rate limit check failed" }, 500);
  }
  if (withinLimit === false) {
    return jsonResponse(req, { error: "Too many requests" }, 429);
  }

  // Fail-CLOSED, exactly like moderate-listing stage 1: a provider error holds.
  // The caller must treat any non-approve as "do not publish".
  let screen: { severity: string; categories: string[] };
  let unavailable = false;
  try {
    screen = await screenWithOpenAI("", imageUrls, openaiKey, "moderate-image");
  } catch (e) {
    console.error("[moderate-image] openai screen failed, holding:", e);
    screen = { severity: "moderate", categories: [] };
    unavailable = true;
  }

  const decision: "approve" | "hold" | "reject" =
    screen.severity === "severe"
      ? "reject"
      : screen.severity === "moderate"
      ? "hold"
      : "approve";

  // WHAT HAPPENS TO THE OBJECTS (A2, 20261013000000; quarantine.ts):
  //   reject, or a hold carrying sexual/minors → PRESERVE: moved into the private
  //     quarantine bucket under the one-year clock, BEFORE the caller's own delete
  //     can reach it (BA-07; 18 U.S.C. § 2258A(h) as amended by the REPORT Act).
  //   any other hold (including "screen unavailable") → DELETED here, server-side.
  //     Until this change only the client deleted a held object, so a timed-out or
  //     crashed client left it at a public URL indefinitely.
  // Either way an audit row records it. The caller (src/lib/imageModeration.ts)
  // still deletes on any non-approve; after this that delete finds nothing.
  const disposition = imageDisposition(decision, screen.categories);
  const now = new Date();
  let quarantined = 0;
  if (disposition === "quarantine") {
    const paths = await quarantineObjects(supabase, imageUrls, context, now);
    quarantined = paths.length;
    const actionId = await recordAction(supabase, {
      action: decision === "reject" ? "auto_reject_image" : "auto_hold_image",
      context,
      contentId,
      reason: `Automated image screen ${decision === "reject" ? "rejected" : "held"} an upload by ${userId}: ${
        screen.categories.join(", ") || "policy violation"
      }`,
      quarantinePath: paths.length ? paths.join("\n") : null,
      preserveUntil: paths.length ? preserveUntil(now).toISOString() : null,
    });
  } else if (disposition === "delete") {
    const removed = await deleteObjects(supabase, imageUrls);
    await recordAction(supabase, {
      action: "auto_hold_image",
      context,
      contentId,
      reason: `Automated image screen held an upload by ${userId} and deleted ${removed} object(s): ${
        unavailable ? "screen unavailable" : screen.categories.join(", ") || "flagged"
      }`,
      quarantinePath: null,
      preserveUntil: null,
    });
  }

  if (unavailable) {
    return jsonResponse(
      req,
      {
        decision: "hold",
        reason:
          "Automated safety review was unavailable; the photo was not published.",
      },
      200
    );
  }

  return jsonResponse(
    req,
    {
      decision,
      reason:
        decision === "reject"
          ? "This photo violates the content policy and was not published."
          : decision === "hold"
          ? "This photo was flagged for review and was not published."
          : "",
      ...(disposition === "quarantine" ? { quarantined } : {}),
    },
    200
  );
});
