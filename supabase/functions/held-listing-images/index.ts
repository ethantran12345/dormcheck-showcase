/**
 * Admin access to a held marketplace listing's photos (A2, 20261013000000).
 *
 * moderate-listing moves a held or rejected listing's photos into the PRIVATE
 * images-held bucket at `<listing id>/<source path>` (_shared/heldImages.ts). That
 * bucket has no storage policy, so nothing but the service role can touch it, and
 * this function is the only door an admin has:
 *
 *   sign     → short-lived signed URLs (HELD_SIGNED_URL_TTL_SECONDS) so the
 *              Auto-held panel can show the photos. Never a public URL.
 *   release  → move every held object back to marketplace-images at its original
 *              path, so the listing's stored image_urls work again. The panel calls
 *              this BEFORE it approves; a partial failure is a 500 and the panel
 *              does not approve.
 *   discard  → delete the held objects. Called after a reject; refused while the
 *              listing is live.
 *
 * Who: superadmin for any listing; university_admin for listings of their own
 * school (same rule as admin_list_held_listings). Everyone else is 403.
 *
 * Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALLOWED_ORIGINS.
 * Auth: gateway verify_jwt = true (./config.toml) AND an in-function JWKS check.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as jose from "npm:jose@5.9.6";
import {
  HELD_BUCKET,
  HELD_SIGNED_URL_TTL_SECONDS,
  LISTING_IMAGES_BUCKET,
  sourcePathFromHeld,
} from "../_shared/heldImages.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["sign", "release", "discard"]);
const LIVE_STATUSES = new Set(["available", "pending", "open", "claimed"]);

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

/** Every object under `<listing id>/`, at any depth (Storage list is one level). */
async function listHeld(
  supabase: SupabaseClient,
  listingId: string,
): Promise<string[]> {
  const out: string[] = [];
  const queue = [listingId];
  while (queue.length > 0) {
    const dir = queue.shift()!;
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await supabase.storage
        .from(HELD_BUCKET)
        .list(dir, { limit: 100, offset });
      if (error) throw new Error(`list ${dir}: ${error.message}`);
      const rows = data ?? [];
      for (const row of rows) {
        const full = `${dir}/${row.name}`;
        // A folder has no id in the Storage list API.
        if (row.id == null) queue.push(full);
        else out.push(full);
      }
      if (rows.length < 100) break;
    }
  }
  return out;
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
  if (!supabaseUrl || !serviceRoleKey) {
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
    console.error("[held-listing-images] jwt verify failed:", e);
    return jsonResponse(req, { error: "Invalid or expired token" }, 401);
  }

  let listingId: string;
  let action: string;
  try {
    const body = await req.json();
    listingId = String(body?.listing_id ?? "");
    action = String(body?.action ?? "");
  } catch {
    return jsonResponse(req, { error: "Invalid JSON body" }, 400);
  }
  if (!UUID_PATTERN.test(listingId))
    return jsonResponse(req, { error: "valid listing_id required" }, 400);
  if (!ACTIONS.has(action))
    return jsonResponse(req, { error: "action must be sign, release or discard" }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Role comes from profiles.role (app_role), never the derived is_admin column.
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("role, university_id")
    .eq("id", userId)
    .maybeSingle();
  if (profileErr) {
    console.error("[held-listing-images] profile read failed:", profileErr.message);
    return jsonResponse(req, { error: "Authorization check failed" }, 500);
  }
  const { data: listing, error: listingErr } = await supabase
    .from("marketplace_listings")
    .select("id, university_id, status")
    .eq("id", listingId)
    .maybeSingle();
  if (listingErr) {
    console.error("[held-listing-images] listing read failed:", listingErr.message);
    return jsonResponse(req, { error: "Listing read failed" }, 500);
  }
  const role = profile?.role ?? null;
  const allowed =
    role === "superadmin" ||
    (role === "university_admin" &&
      !!listing &&
      !!profile?.university_id &&
      listing.university_id === profile.university_id);
  if (!allowed) return jsonResponse(req, { error: "Forbidden" }, 403);
  if (!listing) return jsonResponse(req, { error: "Listing not found" }, 404);

  let held: string[];
  try {
    held = await listHeld(supabase, listingId);
  } catch (e) {
    console.error("[held-listing-images] list failed:", e);
    return jsonResponse(req, { error: "Could not list held photos" }, 500);
  }

  if (action === "sign") {
    const images: { path: string; url: string }[] = [];
    for (const path of held) {
      const { data, error } = await supabase.storage
        .from(HELD_BUCKET)
        .createSignedUrl(path, HELD_SIGNED_URL_TTL_SECONDS);
      if (error || !data?.signedUrl) {
        console.error(`[held-listing-images] sign failed for ${path}:`, error?.message);
        continue;
      }
      // Origin-relative: inside the local runtime SUPABASE_URL is the in-network
      // Kong host, which no browser can reach. The client prefixes its own origin.
      const signed = new URL(data.signedUrl);
      images.push({
        path: sourcePathFromHeld(listingId, path) ?? path,
        url: `${signed.pathname}${signed.search}`,
      });
    }
    return jsonResponse(req, { images, expires_in: HELD_SIGNED_URL_TTL_SECONDS }, 200);
  }

  if (action === "release") {
    let released = 0;
    const failed: string[] = [];
    for (const path of held) {
      const source = sourcePathFromHeld(listingId, path);
      if (!source) {
        failed.push(path);
        continue;
      }
      const { error: copyErr } = await supabase.storage
        .from(HELD_BUCKET)
        .copy(path, source, { destinationBucket: LISTING_IMAGES_BUCKET });
      if (copyErr && !/exists/i.test(copyErr.message)) {
        console.error(`[held-listing-images] release copy failed for ${path}:`, copyErr.message);
        failed.push(path);
        continue;
      }
      const { error: rmErr } = await supabase.storage.from(HELD_BUCKET).remove([path]);
      if (rmErr) {
        // The public copy is back; the private one lingering is harmless.
        console.error(`[held-listing-images] released but held remove failed for ${path}:`, rmErr.message);
      }
      released += 1;
    }
    if (failed.length > 0) {
      return jsonResponse(req, { error: "Some photos could not be released", released, failed: failed.length }, 500);
    }
    return jsonResponse(req, { released }, 200);
  }

  // discard
  if (LIVE_STATUSES.has(listing.status)) {
    return jsonResponse(req, { error: "Listing is live; reject it before discarding its photos" }, 409);
  }
  if (held.length === 0) return jsonResponse(req, { discarded: 0 }, 200);
  const { data: removed, error: rmErr } = await supabase.storage.from(HELD_BUCKET).remove(held);
  if (rmErr) {
    console.error("[held-listing-images] discard failed:", rmErr.message);
    return jsonResponse(req, { error: "Discard failed" }, 500);
  }
  return jsonResponse(req, { discarded: Array.isArray(removed) ? removed.length : 0 }, 200);
});
