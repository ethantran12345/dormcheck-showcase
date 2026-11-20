import { supabase } from '../_lib/supabase.js';
import { sendAdminReportNudgeEmail } from '../_lib/notifications.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * 48h unactioned-report nudge (P1.8b). Vercel Cron, daily 13:00 UTC. For each
 * school with content reports older than 48h (and not escalated), email that
 * school's admins. "Never more than one per day total": skips an admin who
 * already received ANY admin email (digest or nudge) in the last 24h;
 * respects profiles.email_notifications.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET?.trim();
  const header = req.headers.authorization ?? '';
  const token = /^Bearer\s+(.+)$/i.exec(Array.isArray(header) ? header[0] : header)?.[1];
  if (!secret || token !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!supabase) {
    console.error('[report-nudge] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    return res.status(503).json({ error: 'Service unavailable' });
  }

  try {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: stale, error: staleErr } = await supabase
      .from('content_reports')
      .select('id, reporter_id, created_at')
      .is('escalated_at', null)
      .lte('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(500);
    if (staleErr) throw staleErr;
    if (!stale?.length) return res.status(200).json({ ok: true, sent: 0, staleReports: 0 });

    // Resolve each stale report's school through the reporter.
    const reporterIds = [...new Set(stale.map((r) => (r as { reporter_id: string }).reporter_id))];
    const { data: reporterRows } = await supabase
      .from('profiles')
      .select('id, university_id')
      .in('id', reporterIds);
    const schoolByReporter = new Map(
      (reporterRows ?? []).map((r) => {
        const row = r as { id: string; university_id: string | null };
        return [row.id, row.university_id] as const;
      }),
    );

    const perSchool = new Map<string, { count: number; oldest: string }>();
    for (const r of stale) {
      const row = r as { reporter_id: string; created_at: string };
      const school = schoolByReporter.get(row.reporter_id);
      if (!school) continue;
      const entry = perSchool.get(school);
      if (entry) entry.count++;
      else perSchool.set(school, { count: 1, oldest: row.created_at });
    }
    if (perSchool.size === 0) return res.status(200).json({ ok: true, sent: 0, staleReports: stale.length });

    const { data: admins } = await supabase
      .from('profiles')
      .select('id, email, university_id, email_notifications')
      .eq('role', 'university_admin')
      .in('university_id', [...perSchool.keys()]);

    const daySince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let sent = 0;
    for (const admin of admins ?? []) {
      const a = admin as {
        id: string;
        email: string | null;
        university_id: string | null;
        email_notifications: boolean | null;
      };
      const school = a.university_id ? perSchool.get(a.university_id) : undefined;
      if (!school || !a.email?.trim() || a.email_notifications === false) continue;
      const { data: recent } = await supabase
        .from('admin_email_log')
        .select('id')
        .eq('admin_id', a.id)
        .gte('sent_at', daySince)
        .limit(1);
      if (recent?.length) continue;

      const oldestHours = Math.round((Date.now() - new Date(school.oldest).getTime()) / 3_600_000);
      await sendAdminReportNudgeEmail(a.email.trim(), school.count, oldestHours);
      await supabase.from('admin_email_log').insert({ admin_id: a.id, kind: 'report_nudge' });
      sent++;
    }

    return res.status(200).json({ ok: true, sent, staleReports: stale.length });
  } catch (err) {
    console.error('[report-nudge]', err);
    return res.status(500).json({ error: 'Nudge run failed' });
  }
}
