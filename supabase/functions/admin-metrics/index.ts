/**
 * Admin-only metrics entrypoint. Authorization stays in this Edge Function;
 * aggregation lives in the service-role-only SQL RPC so no event/profile rows
 * are paged into Edge memory or silently capped at 50k rows.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as jose from "npm:jose@5.9.6";

const allowedOrigins = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ?? Deno.env.get("ALLOWED_ORIGIN") ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
// The core-action event list now lives in the aggregate RPC added by
// 20260831020000_metrics_and_query_performance.sql — keeping a second copy here
// would be a silent drift source, so this function no longer carries one.

type DormMetric = { dorm: string; users: number; actionsThisWeek: number };
type SignupBucket = { weekStart: string; count: number };
type UserSample = { id: string; email: string | null; created_at: string };
type RawMetrics = {
  total_users: number;
  active_last_7_days: number;
  active_listings: number;
  signups_this_week: number;
  signups_prior_week: number;
  active_prior_week: number;
  core_actions_this_week: number;
  core_actions_prior_week: number;
  listings_created_this_week: number;
  listings_created_prior_week: number;
  activated_ever: number;
  returning: number;
  dorms: DormMetric[];
  signups_by_week: SignupBucket[];
  stuck_count: number;
  stuck_users: UserSample[];
  recent_signups: UserSample[];
};

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
  const header =
    req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!header || !/^Bearer\s+/i.test(header)) return null;
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return token || null;
}

async function countScopedContentReports(
  supabase: ReturnType<typeof createClient>,
  universityId: string
): Promise<number> {
  const { data, error } = await supabase
    .from("content_reports")
    .select("id, content_type, content_id");
  if (error) throw new Error(error.message);
  const reports = (data ?? []) as Array<{
    content_type: string;
    content_id: string;
  }>;
  if (!reports.length) return 0;

  const idsByType = new Map<string, string[]>();
  for (const report of reports) {
    idsByType.set(report.content_type, [
      ...(idsByType.get(report.content_type) ?? []),
      report.content_id,
    ]);
  }
  const countIn = async (table: string, ids: string[]) => {
    if (!ids.length) return 0;
    const { count, error: queryError } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .in("id", ids)
      .eq("university_id", universityId);
    if (queryError) throw new Error(queryError.message);
    return count ?? 0;
  };
  const sellerRatingIds = idsByType.get("seller_rating") ?? [];
  const studentSetupIds = idsByType.get("student_setup") ?? [];
  const [marketplace, roommates, chatLinks, users, ratings, setups] =
    await Promise.all([
      countIn(
        "marketplace_listings",
        idsByType.get("marketplace_listing") ?? []
      ),
      countIn("roommate_search_posts", idsByType.get("roommate_post") ?? []),
      countIn("building_chat_links", idsByType.get("building_chat_link") ?? []),
      countIn("profiles", idsByType.get("user") ?? []),
      (async () => {
        if (!sellerRatingIds.length) return 0;
        const { data: rows, error: ratingError } = await supabase
          .from("seller_ratings")
          .select("seller_id")
          .in("id", sellerRatingIds);
        if (ratingError) throw new Error(ratingError.message);
        const sellerIds = [
          ...new Set(
            (rows ?? []).map((row: { seller_id: string }) => row.seller_id)
          ),
        ];
        if (!sellerIds.length) return 0;
        const { count, error: profileError } = await supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .in("id", sellerIds)
          .eq("university_id", universityId);
        if (profileError) throw new Error(profileError.message);
        return count ?? 0;
      })(),
      (async () => {
        if (!studentSetupIds.length) return 0;
        const { data: rows, error: setupError } = await supabase
          .from("student_setups")
          .select("user_id")
          .in("report_uuid", studentSetupIds);
        if (setupError) throw new Error(setupError.message);
        const ownerIds = [
          ...new Set(
            (rows ?? []).map((row: { user_id: string }) => row.user_id)
          ),
        ];
        if (!ownerIds.length) return 0;
        const { count, error: profileError } = await supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .in("id", ownerIds)
          .eq("university_id", universityId);
        if (profileError) throw new Error(profileError.message);
        return count ?? 0;
      })(),
    ]);
  return marketplace + roommates + chatLinks + users + ratings + setups;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        ...corsHeadersFor(req),
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  }
  if (req.method !== "GET")
    return jsonResponse(req, { error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(req, { error: "Server configuration error" }, 500);
  }
  const jwt = extractBearerJwt(req);
  if (!jwt)
    return jsonResponse(
      req,
      { error: "Missing or invalid Authorization header" },
      401
    );

  const authOrigin = supabaseUrl.replace(/\/$/, "");
  const isLocalRuntime =
    /^https?:\/\/(kong|localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?$/i.test(
      authOrigin
    );
  const issuers = [
    `${authOrigin}/auth/v1`,
    ...(isLocalRuntime
      ? ["http://127.0.0.1:54321/auth/v1", "http://localhost:54321/auth/v1"]
      : []),
  ];
  let userId: string;
  try {
    const jwks = jose.createRemoteJWKSet(
      new URL(`${authOrigin}/auth/v1/.well-known/jwks.json`)
    );
    const { payload } = await jose.jwtVerify(jwt, jwks, {
      issuer: issuers,
      audience: "authenticated",
    });
    if (typeof payload.sub !== "string" || !payload.sub)
      throw new Error("missing subject");
    userId = payload.sub;
  } catch (error) {
    console.error("[admin-metrics] jwt verify failed:", error);
    return jsonResponse(req, { error: "Invalid or expired token" }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_admin, role, university_id")
    .eq("id", userId)
    .maybeSingle();
  if (profileError)
    return jsonResponse(req, { error: "Authorization check failed" }, 500);
  const role = (profile as { role?: string } | null)?.role;
  const isSuperAdmin =
    role === "superadmin" || (role == null && profile?.is_admin === true);
  const isUniversityAdmin = role === "university_admin";
  if (!isSuperAdmin && !isUniversityAdmin)
    return jsonResponse(req, { error: "Forbidden" }, 403);

  const url = new URL(req.url);
  const requestedUniversity = url.searchParams.get("university");
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (requestedUniversity && !uuid.test(requestedUniversity)) {
    return jsonResponse(req, { error: "Invalid university parameter" }, 400);
  }
  const profileUniversityId =
    (profile as { university_id?: string | null } | null)?.university_id ??
    null;
  if (isUniversityAdmin && !profileUniversityId) {
    return jsonResponse(
      req,
      { error: "University scope missing for this account" },
      403
    );
  }
  const universityId = isSuperAdmin
    ? requestedUniversity || null
    : profileUniversityId;
  const shapeAsUniversityAdmin =
    isUniversityAdmin ||
    (isSuperAdmin && url.searchParams.get("as_role") === "university_admin");

  try {
    const [metricsResult, scopedReports, chatReports] = await Promise.all([
      supabase.rpc("get_admin_metrics", { p_university_id: universityId }),
      universityId
        ? countScopedContentReports(supabase, universityId)
        : supabase
            .from("content_reports")
            .select("id", { count: "exact", head: true }),
      universityId
        ? supabase
            .from("building_chat_link_reports")
            .select("id, building_chat_links!inner(university_id)", {
              count: "exact",
              head: true,
            })
            .eq("building_chat_links.university_id", universityId)
        : supabase
            .from("building_chat_link_reports")
            .select("id", { count: "exact", head: true }),
    ]);
    if (metricsResult.error) throw new Error(metricsResult.error.message);
    // `scopedReports` is a NUMBER on the university-scoped branch and a PostgREST result
    // object otherwise. The old guard used the `in` operator on it, which throws TypeError on
    // a number — "Cannot use the 'in' operator to search for 'error' in 2" — so it 500'd EVERY request that
    // took the scoped branch, which is every university_admin request there has ever been.
    // Found 2026-08-06 by the first real university_admin session anyone has run against this
    // function; prod has never had one, so nothing surfaced it. Note the openReports line just
    // below already narrows with `typeof === "number"`: the shape was understood, this guard
    // simply was not written to match it.
    if (typeof scopedReports !== "number" && scopedReports.error)
      throw new Error(scopedReports.error.message);
    if (chatReports.error) throw new Error(chatReports.error.message);
    const raw = metricsResult.data as RawMetrics | null;
    if (!raw || typeof raw !== "object")
      throw new Error("metrics RPC returned no payload");
    const openReports =
      (typeof scopedReports === "number"
        ? scopedReports
        : scopedReports.count ?? 0) + (chatReports.count ?? 0);
    const suppress = (value: unknown): number | null => {
      const count = asNumber(value);
      return shapeAsUniversityAdmin && count > 0 && count < 5 ? null : count;
    };
    return jsonResponse(
      req,
      {
        metrics: {
          totalUsers: suppress(raw.total_users),
          activeLast7Days: suppress(raw.active_last_7_days),
          activeListings: suppress(raw.active_listings),
        },
        deltas: {
          newSignups: {
            current: suppress(raw.signups_this_week),
            previous: suppress(raw.signups_prior_week),
          },
          activeUsers: {
            current: suppress(raw.active_last_7_days),
            previous: suppress(raw.active_prior_week),
          },
          coreActions: {
            current: suppress(raw.core_actions_this_week),
            previous: suppress(raw.core_actions_prior_week),
          },
          listingsCreated: {
            current: suppress(raw.listings_created_this_week),
            previous: suppress(raw.listings_created_prior_week),
          },
        },
        funnel: {
          signedUp: suppress(raw.total_users),
          activated: suppress(raw.activated_ever),
          activeThisWeek: suppress(raw.active_last_7_days),
          returning: suppress(raw.returning),
        },
        dorms: (raw.dorms ?? []).map((row) => ({
          dorm: row.dorm,
          users: suppress(row.users),
          actionsThisWeek: suppress(row.actionsThisWeek),
        })),
        signupsByWeek: (raw.signups_by_week ?? []).map((row) => ({
          weekStart: row.weekStart,
          count: suppress(row.count),
        })),
        needsAttention: {
          openReports,
          stuckUsers: {
            count: suppress(raw.stuck_count),
            sample: shapeAsUniversityAdmin ? [] : raw.stuck_users ?? [],
          },
        },
        recentSignups: shapeAsUniversityAdmin ? [] : raw.recent_signups ?? [],
        suppression: { threshold: 5, applied: shapeAsUniversityAdmin },
      },
      200
    );
  } catch (error) {
    console.error("[admin-metrics] metrics query failed:", error);
    return jsonResponse(req, { error: "Metrics query failed" }, 500);
  }
});
