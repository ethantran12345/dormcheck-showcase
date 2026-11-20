// Account deletion (App Store 5.1.1) - deletes auth user + all owned data.
//
// Security: internet-reachable, JWT verified inside the function (mirrors
// admin-metrics). Never trusts a userId from the client; the target is always
// `payload.sub` from the verified JWT.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as jose from "npm:jose@5.9.6";
import { fetchWithTimeout } from "../_shared/fetchWithTimeout.ts";
import {
  PRESERVED_BUCKETS,
  purgeableOwnerBuckets,
  purgeableUserBuckets,
} from "../_shared/storageBuckets.ts";

// Upper bound on the confirmation email round trip (BA-06). It runs AFTER the
// account is gone, so a Resend stall used to turn a successful deletion into a
// client-visible error. Best-effort: a timeout is logged like any other send failure.
const DELETION_EMAIL_TIMEOUT_MS = 5_000;

// Reflect a specific allowed origin instead of "*". This is a destructive,
// JWT-authenticated endpoint reached from both the web app and the Capacitor
// native shell, so the allowlist mirrors api/_lib/cors.ts exactly. Unknown
// origins fall back to the production origin (never a wildcard).
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
  extra?: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders, ...extra },
  });
}

function bearer(req: Request): string | null {
  const h = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!h || !/^Bearer\s+/i.test(h)) return null;
  const t = h.replace(/^Bearer\s+/i, "").trim();
  return t.length > 0 ? t : null;
}

// Recursively list every storage path under `prefix` in `bucket`.
// supabase-js list() is non-recursive; we walk subfolders ourselves.
// Files have id != null, folders have id == null.
async function listAllUnder(
  supabase: SupabaseClient,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [prefix];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let offset = 0;
    while (true) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .list(dir, { limit: 1000, offset });
      if (error) {
        console.warn(`[delete-user-account] list ${bucket}/${dir} failed:`, error.message);
        break;
      }
      if (!data || data.length === 0) break;
      for (const entry of data) {
        const full = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.id == null) {
          stack.push(full);
        } else {
          out.push(full);
        }
      }
      if (data.length < 1000) break;
      offset += data.length;
    }
  }
  return out;
}

async function purgeUserFolder(
  supabase: SupabaseClient,
  bucket: string,
  userId: string,
): Promise<number> {
  try {
    const paths = await listAllUnder(supabase, bucket, userId);
    if (paths.length === 0) return 0;
    let removed = 0;
    for (let i = 0; i < paths.length; i += 1000) {
      const chunk = paths.slice(i, i + 1000);
      const { error } = await supabase.storage.from(bucket).remove(chunk);
      if (error) {
        console.warn(`[delete-user-account] remove ${bucket} chunk failed:`, error.message);
      } else {
        removed += chunk.length;
      }
    }
    return removed;
  } catch (e) {
    console.warn(`[delete-user-account] purge ${bucket} for ${userId} threw:`, e);
    return 0;
  }
}

// Deletion-confirmation email (v6 chrome, mirrors api/_lib/notifications.ts -
// this Deno function can't import that Node bundle, so the template is inlined).
// No dynamic values are interpolated, so no escaping is needed; keep it that
// way or add escaping if variables are ever introduced. Best-effort: a send
// failure never fails the deletion. Transactional security notice - the
// profiles row is already gone, so email_notifications cannot (and should not)
// gate it.
async function sendDeletionEmail(to: string): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("[delete-user-account] RESEND_API_KEY not set; skipping deletion email");
    return;
  }
  const F = "'Nunito','Segoe UI',Helvetica,Arial,sans-serif";
  const html = `
<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:0;background:#ffffff;font-family:${F};} a{text-decoration:none;}</style></head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
<tr><td align="center" style="padding:44px 20px;">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:520px;max-width:520px;">
<tr><td align="left" style="padding-bottom:28px;">
<img src="https://dormcheck.com/dormcheck-logo-new.png" width="30" height="27" alt="" style="vertical-align:middle;display:inline-block;border:0;">
<img src="https://dormcheck.com/dormcheck-wordmark-sora.png" alt="DormCheck" height="20" style="vertical-align:middle;display:inline-block;border:0;padding-left:9px;">
</td></tr>
<tr><td align="left">
<p style="margin:0 0 15px;font-family:${F};color:#18181B;font-size:18px;font-weight:800;line-height:1.5;">Your account was deleted</p>
<p style="margin:0 0 15px;font-family:${F};color:#18181B;font-size:16px;line-height:1.6;">Your DormCheck account and data have been removed. Sorry to see you go. If this wasn't you, reply to this email and contact us right away.</p>
</td></tr>
<tr><td style="padding-top:26px;"><div style="height:1px;background:#E4E4E7;font-size:0;line-height:0;">&nbsp;</div></td></tr>
<tr><td align="left" style="padding-top:20px;">
<p style="margin:0 0 8px;font-family:${F};font-size:13.5px;">
<a href="https://www.instagram.com/dormcheck_app" style="color:#0B702B;">Instagram</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span>
<a href="https://www.tiktok.com/@dormcheck" style="color:#0B702B;">TikTok</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span>
<a href="https://www.linkedin.com/company/dormcheck" style="color:#0B702B;">LinkedIn</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span>
<a href="https://x.com/dormcheck" style="color:#0B702B;">X</a></p>
<p style="margin:0;font-family:${F};color:#71717A;font-size:13px;line-height:1.75;">
&copy; 2026 DormCheck<span style="color:#C7CCD2;">&nbsp;|&nbsp;</span>Pittsburgh, PA<span style="color:#C7CCD2;">&nbsp;|&nbsp;</span>
<a href="https://dormcheck.com/privacy" style="color:#0B702B;text-decoration:underline;">Privacy</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span>
<a href="https://dormcheck.com/terms" style="color:#0B702B;text-decoration:underline;">Terms</a><br>
DormCheck is an independent platform and isn't affiliated with any university.
</p>
</td></tr>
</table></td></tr></table></body></html>`;
  const resp = await fetchWithTimeout("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "DormCheck <noreply@dormcheck.com>",
      to,
      reply_to: "support@dormcheck.com",
      subject: "Your DormCheck account was deleted",
      html,
    }),
  }, DELETION_EMAIL_TIMEOUT_MS);
  if (!resp.ok) {
    console.error("[delete-user-account] deletion email failed:", resp.status, await resp.text());
  }
}

/**
 * Purge the objects this user uploaded to an owner-scoped bucket (dorm-photos)
 * that no row references any more. A photo still on a dorm page is kept: it is
 * institutional content, not the uploader's personal data, and deleting it would
 * break a public page. The SQL refuses preserved buckets on its own.
 */
async function purgeOwnedUnreferenced(
  supabase: SupabaseClient,
  bucket: string,
  userId: string,
): Promise<number> {
  try {
    let removed = 0;
    // Bounded: 500 per call, and at most 10 rounds.
    for (let round = 0; round < 10; round++) {
      const { data, error } = await supabase.rpc("storage_unreferenced_objects", {
        p_bucket: bucket,
        p_created_before: new Date().toISOString(),
        p_owner: userId,
        p_limit: 500,
      });
      if (error) {
        console.warn(`[delete-user-account] list owned ${bucket} failed:`, error.message);
        return removed;
      }
      const names = ((data ?? []) as { name: string }[]).map((r) => r.name);
      if (names.length === 0) return removed;
      const { error: rmErr } = await supabase.storage.from(bucket).remove(names);
      if (rmErr) {
        console.warn(`[delete-user-account] remove owned ${bucket} failed:`, rmErr.message);
        return removed;
      }
      removed += names.length;
      if (names.length < 500) return removed;
    }
    return removed;
  } catch (e) {
    console.warn(`[delete-user-account] purge owned ${bucket} for ${userId} threw:`, e);
    return 0;
  }
}

// The purge list is DERIVED, never written here (BA-07): ../_shared/storageBuckets.ts
// declares the user-folder buckets and the PRESERVED set, and purgeableUserBuckets()
// is the difference. Rejected images that automated moderation moved into the
// quarantine bucket are held under a statutory one-year clock (18 U.S.C. § 2258A(h)
// as amended by the REPORT Act; moderation_actions.preserve_until) that does NOT
// end when the uploader deletes their account. The moderation_actions rows survive
// this deletion on their own: admin_id/reporter_id are ON DELETE SET NULL and
// content_id is a bare uuid, so the trail keeps its path and its clock.
const USER_FOLDER_BUCKETS = purgeableUserBuckets();
const OWNER_BUCKETS = purgeableOwnerBuckets();
if (
  [...USER_FOLDER_BUCKETS, ...OWNER_BUCKETS].some((b) =>
    (PRESERVED_BUCKETS as readonly string[]).includes(b)
  )
) {
  // Unreachable by construction; kept as a loud tripwire against a future edit
  // that adds the quarantine bucket to the wrong list.
  throw new Error("[delete-user-account] a preserved bucket is on the purge list");
}

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
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[delete-user-account] missing env vars");
    return jsonResponse({ error: "Server configuration error" }, 500, corsHeaders);
  }

  // Body confirmation. Defense-in-depth match against the UI's "type DELETE".
  let body: { confirm?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, corsHeaders);
  }
  if (body?.confirm !== "DELETE") {
    return jsonResponse({ error: "Missing confirmation" }, 400, corsHeaders);
  }

  // JWT verification (mirrors admin-metrics).
  const jwt = bearer(req);
  if (!jwt) return jsonResponse({ error: "Missing or invalid Authorization header" }, 401, corsHeaders);

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
    console.error("[delete-user-account] jwt verify failed:", e);
    return jsonResponse({ error: "Invalid or expired token" }, 401, corsHeaders);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Counts for audit metadata. Best-effort; failures don't abort.
  const counts: Record<string, number> = {};

  try {
    // Step 1. Anonymize-keep tables. The migration FK rule ON DELETE SET NULL
    // would also handle this when the profile delete cascades, but we do the
    // explicit UPDATE so anonymization happens up-front (auditable order) and
    // is robust to a future FK regression.
    {
      const { error, count } = await supabase
        .from("dorm_questions")
        .update({ user_id: null }, { count: "exact" })
        .eq("user_id", userId);
      if (error) console.warn("[delete-user-account] anon dorm_questions:", error.message);
      counts.dorm_questions_anonymized = count ?? 0;
    }
    {
      const { error, count } = await supabase
        .from("dorm_answers")
        .update({ user_id: null }, { count: "exact" })
        .eq("user_id", userId);
      if (error) console.warn("[delete-user-account] anon dorm_answers:", error.message);
      counts.dorm_answers_anonymized = count ?? 0;
    }

    // Step 2. Manual-delete tables that don't cascade and that we DO want gone.
    // Order: setup_comments first, then student_setups (FK cascades from setups
    // to setup_photos/setup_products will fire on the setups delete).
    {
      const { error, count } = await supabase
        .from("setup_comments")
        .delete({ count: "exact" })
        .eq("user_id", userId);
      if (error) console.warn("[delete-user-account] del setup_comments:", error.message);
      counts.setup_comments_deleted = count ?? 0;
    }
    {
      const { error, count } = await supabase
        .from("student_setups")
        .delete({ count: "exact" })
        .eq("user_id", userId);
      if (error) console.warn("[delete-user-account] del student_setups:", error.message);
      counts.student_setups_deleted = count ?? 0;
    }
    // conversations.initiated_by is NO ACTION. participant_* cascades handle row
    // deletion; null this defensively in case a row pointed at user without
    // participation.
    {
      const { error } = await supabase
        .from("conversations")
        .update({ initiated_by: null })
        .eq("initiated_by", userId);
      if (error) console.warn("[delete-user-account] null conversations.initiated_by:", error.message);
    }

    // Step 3. Storage cleanup. Best-effort; logged failures don't block the
    // account delete (orphan files are recoverable later via a janitor).
    let storagePurged = 0;
    for (const bucket of USER_FOLDER_BUCKETS) {
      storagePurged += await purgeUserFolder(supabase, bucket, userId);
    }
    for (const bucket of OWNER_BUCKETS) {
      storagePurged += await purgeOwnedUnreferenced(supabase, bucket, userId);
    }
    counts.storage_objects_removed = storagePurged;

    // Step 4. Delete the auth user. Cascades to profiles, which cascades to all
    // FK-with-CASCADE tables (Group A & B from the audit).
    const { error: deleteErr } = await supabase.auth.admin.deleteUser(userId);
    if (deleteErr) {
      console.error("[delete-user-account] auth.admin.deleteUser failed:", deleteErr.message);
      return jsonResponse(
        { error: "Failed to delete account. Please contact support." },
        500,
        corsHeaders,
      );
    }

    // Step 5. Audit log (last write - user is gone now, no FK to satisfy).
    const deletedAt = new Date().toISOString();
    const { error: auditErr } = await supabase.from("deleted_accounts").insert({
      auth_user_id: userId,
      email: userEmail,
      deleted_at: deletedAt,
      metadata: counts,
    });
    if (auditErr) {
      // Don't fail the request - the user IS deleted. Just log.
      console.error("[delete-user-account] audit insert failed:", auditErr.message);
    }

    // Step 6. Confirmation email (best-effort; user is already deleted).
    if (userEmail) {
      try {
        await sendDeletionEmail(userEmail);
      } catch (e) {
        console.error("[delete-user-account] deletion email threw:", e);
      }
    }

    return jsonResponse({ ok: true, deletedAt }, 200, corsHeaders);
  } catch (e) {
    console.error("[delete-user-account] unexpected error:", e);
    return jsonResponse({ error: "Failed to delete account. Please contact support." }, 500, corsHeaders);
  }
});
