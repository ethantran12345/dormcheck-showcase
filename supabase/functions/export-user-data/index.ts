// Personal data export (GDPR/CCPA-style "download my data").
//
// Returns the AUTHENTICATED caller's own data as a single JSON document:
// profile, their marketplace listings, their roommate posts, the conversations
// they participate in, the messages they authored, and their saved dorms.
//
// Security model (two independent guarantees):
//   1. JWT is verified inside the function (jose + JWKS, ES256) - mirrors
//      delete-user-account. The caller's id is ALWAYS `payload.sub`; a user id
//      is never accepted from the client.
//   2. All reads run through a USER-SCOPED client (anon key + the caller's JWT
//      forwarded as Authorization), so Postgres RLS enforces row isolation at
//      the database. Even a filter bug here cannot return another user's rows.
//      The explicit `.eq(...)` / participant filters are defense-in-depth on
//      top of RLS, not the primary boundary.
//
// Contact columns (`phone_number`, `instagram_handle`/`instagram`,
// `snapchat_handle`/`snapchat`) on marketplace_listings and
// roommate_search_posts are NOT granted to the `authenticated` role (SEC-6 /
// roommate contact grants), so they are intentionally omitted from those
// sections. The caller's canonical phone still exports via `profile.phone_number`.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as jose from "npm:jose@5.9.6";

// Mirror api/_lib/cors.ts / delete-user-account exactly: reflect a known origin,
// never a wildcard. Reached from web app + Capacitor native shell.
const ALLOWED_ORIGINS = new Set([
  "capacitor://localhost",
  "https://localhost",
  "http://localhost:8080",
  "http://localhost:8081",
  "https://dormcheck.com",
  "https://www.dormcheck.com",
]);
const FALLBACK_ORIGIN = "https://dormcheck.com";

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? req.headers.get("origin") ?? "";
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : FALLBACK_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

function jsonResponse(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function bearer(req: Request): string | null {
  const h = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!h || !/^Bearer\s+/i.test(h)) return null;
  const t = h.replace(/^Bearer\s+/i, "").trim();
  return t.length > 0 ? t : null;
}

// Non-contact columns only. Contact fields are ungrantable to `authenticated`
// (SEC-6 / roommate grants) and would 42501 a select; excluded by design.
const LISTING_COLUMNS = [
  "id", "user_id", "title", "description", "price", "category", "image_url",
  "image_urls", "created_at", "is_sublease", "sublease_start", "sublease_end",
  "building_name", "condition", "meetup_location", "show_instagram",
  "show_snapchat", "show_phone", "utilities", "is_furnished", "has_parking",
  "house_rules", "included_utilities", "additional_rules", "parking", "status",
  "gender_preference", "latitude", "longitude", "price_negotiable",
  "payment_methods", "university_id", "verified_at", "last_confirmed_at",
].join(", ");

const ROOMMATE_COLUMNS = [
  "id", "user_id", "post_type", "content", "budget_max", "preferred_areas",
  "move_in_semester", "spots_total", "spots_filled", "is_active",
  "interest_count", "created_at", "updated_at", "address", "housing_type",
  "utilities_included", "is_furnished", "parking_available", "gender_preference",
  "additional_details", "photos", "show_instagram", "show_snapchat",
  "show_phone", "room_type", "lease_length", "pets_allowed", "smoking_allowed",
  "laundry", "bathroom",
  // NOTE: university_id is deliberately excluded - unlike marketplace_listings,
  // roommate_search_posts does NOT grant university_id to `authenticated`
  // (verified against column_privileges), so selecting it 42501s.
].join(", ");

serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { ...corsHeaders, "Access-Control-Allow-Methods": "POST, OPTIONS" },
    });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    console.error("[export-user-data] missing env vars");
    return jsonResponse({ error: "Server configuration error" }, 500, corsHeaders);
  }

  // JWT verification (mirrors admin-metrics / delete-user-account).
  const jwt = bearer(req);
  if (!jwt) {
    return jsonResponse({ error: "Missing or invalid Authorization header" }, 401, corsHeaders);
  }

  const authOrigin = supabaseUrl.replace(/\/$/, "");
  const JWKS = jose.createRemoteJWKSet(new URL(`${authOrigin}/auth/v1/.well-known/jwks.json`));
  // Same issuer allowlist as admin-metrics / moderate-image: inside the local edge runtime
  // SUPABASE_URL is the in-network Kong host while GoTrue mints tokens with the browser's
  // 127.0.0.1:54321 issuer. Only widened when the runtime is itself local; in prod the
  // single production issuer is the whole list. Without this the function could not be
  // driven locally at all (scripts/test-edge-functions.sh), which is how it stayed untested.
  const isLocalRuntime =
    /^https?:\/\/(kong|localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?$/i.test(authOrigin);
  const allowedIssuers = [
    `${authOrigin}/auth/v1`,
    ...(isLocalRuntime ? ["http://127.0.0.1:54321/auth/v1", "http://localhost:54321/auth/v1"] : []),
  ];

  let userId: string;
  let userEmail: string | null = null;
  try {
    const { payload } = await jose.jwtVerify(jwt, JWKS, {
      issuer: allowedIssuers,
      audience: "authenticated",
    });
    if (typeof payload.sub !== "string" || !payload.sub) {
      return jsonResponse({ error: "Invalid or expired token" }, 401, corsHeaders);
    }
    userId = payload.sub;
    userEmail = typeof payload.email === "string" ? payload.email : null;
  } catch (e) {
    console.error("[export-user-data] jwt verify failed:", e);
    return jsonResponse({ error: "Invalid or expired token" }, 401, corsHeaders);
  }

  // User-scoped client: RLS runs as this user. This - not the .eq filters below -
  // is what guarantees the export cannot contain another user's rows.
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const [profileRes, listingsRes, roommateRes, conversationsRes, messagesRes, savedDormsRes] =
      await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
        supabase.from("marketplace_listings").select(LISTING_COLUMNS).eq("user_id", userId),
        supabase.from("roommate_search_posts").select(ROOMMATE_COLUMNS).eq("user_id", userId),
        supabase
          .from("conversations")
          .select("*")
          .or(`participant_1.eq.${userId},participant_2.eq.${userId}`),
        // Only messages the caller authored - protects the other party's content.
        supabase.from("messages").select("*").eq("sender_id", userId),
        supabase.from("saved_dorms").select("*").eq("user_id", userId),
      ]);

    // Surface the first hard error rather than shipping a silently-partial export.
    const firstError =
      profileRes.error || listingsRes.error || roommateRes.error ||
      conversationsRes.error || messagesRes.error || savedDormsRes.error;
    if (firstError) {
      console.error("[export-user-data] read failed:", firstError.message);
      return jsonResponse({ error: "Could not assemble your data. Please try again." }, 500, corsHeaders);
    }

    const payload = {
      export_format: "dormcheck.user-data.v1",
      exported_at: new Date().toISOString(),
      user: { id: userId, email: userEmail },
      scope_notes: [
        "This export contains only your own data, scoped to your account by the server.",
        "Messages include only those you sent; the other participant's messages are not included.",
        "Per-listing/per-post contact handles are omitted; your phone is under profile.phone_number.",
      ],
      profile: profileRes.data ?? null,
      marketplace_listings: listingsRes.data ?? [],
      roommate_posts: roommateRes.data ?? [],
      conversations: conversationsRes.data ?? [],
      messages_sent: messagesRes.data ?? [],
      saved_dorms: savedDormsRes.data ?? [],
    };

    return jsonResponse(payload, 200, corsHeaders);
  } catch (e) {
    console.error("[export-user-data] unexpected error:", e);
    return jsonResponse({ error: "Could not assemble your data. Please try again." }, 500, corsHeaders);
  }
});
