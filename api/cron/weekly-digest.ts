import { supabase } from "../_lib/supabase.js";
import { sendAdminWeeklyDigestEmail } from "../_lib/notifications.js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Weekly admin digest (P1.8b). Vercel Cron, Mondays 12:00 UTC (8am ET during
 * DST; vercel.json). Per university_admin: last-7-days signups + listings for
 * their school and the current open-report count, then one email. Respects
 * profiles.email_notifications; idempotent via admin_email_log (no second
 * digest within 6 days).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET?.trim();
  const header = req.headers.authorization ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(
    Array.isArray(header) ? header[0] : header
  )?.[1];
  if (!secret || token !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!supabase) {
    console.error(
      "[weekly-digest] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set"
    );
    return res.status(503).json({ error: "Service unavailable" });
  }

  try {
    const { data: admins, error: adminErr } = await supabase
      .from("profiles")
      .select("id, email, university_id, email_notifications")
      .eq("role", "university_admin");
    if (adminErr) throw adminErr;

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const dedupSince = new Date(
      Date.now() - 6 * 24 * 60 * 60 * 1000
    ).toISOString();
    let sent = 0;
    let skipped = 0;

    for (const admin of admins ?? []) {
      const a = admin as {
        id: string;
        email: string | null;
        university_id: string | null;
        email_notifications: boolean | null;
      };
      if (
        !a.email?.trim() ||
        !a.university_id ||
        a.email_notifications === false
      ) {
        skipped++;
        continue;
      }
      const { data: already } = await supabase
        .from("admin_email_log")
        .select("id")
        .eq("admin_id", a.id)
        .eq("kind", "weekly_digest")
        .gte("sent_at", dedupSince)
        .limit(1);
      if (already?.length) {
        skipped++;
        continue;
      }

      // One server-only aggregate avoids 4+ round trips per administrator and
      // never serializes an unbounded reporter-id list into a PostgREST URL.
      const { data: metrics, error: metricsErr } = await supabase.rpc(
        "get_weekly_digest_metrics",
        {
          p_university_id: a.university_id,
          p_since: since,
        }
      );
      if (metricsErr) throw metricsErr;
      const metric = (Array.isArray(metrics) ? metrics[0] : metrics) as {
        university_name?: string | null;
        new_signups?: number | null;
        new_listings?: number | null;
        open_reports?: number | null;
      } | null;
      if (!metric)
        throw new Error(
          `weekly digest metrics missing for university ${a.university_id}`
        );

      await sendAdminWeeklyDigestEmail(
        a.email.trim(),
        (metric.university_name ?? "your school").trim(),
        {
          newSignups: metric.new_signups ?? 0,
          newListings: metric.new_listings ?? 0,
          openReports: metric.open_reports ?? 0,
        }
      );
      await supabase
        .from("admin_email_log")
        .insert({ admin_id: a.id, kind: "weekly_digest" });
      sent++;
    }

    return res.status(200).json({ ok: true, sent, skipped });
  } catch (err) {
    console.error("[weekly-digest]", err);
    return res.status(500).json({ error: "Digest run failed" });
  }
}
