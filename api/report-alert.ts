import { sendContentReportAlertEmail } from './_lib/notifications.js';
import { supabase } from './_lib/supabase.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Immediate moderation alert, fired by the `content_reports` AFTER INSERT
 * trigger (`private.dispatch_report_alert`, migration 20260831000000) via
 * pg_net, NOT by the client.
 *
 * Why this exists: /terms and /moderation publish a 24-hour commitment to
 * remove reported content and eject the user (App Store guideline 1.2). The
 * existing `api/cron/report-nudge.ts` only fires at 48h and is capped at one
 * admin email per day, so on its own it cannot keep that promise. This route is
 * what makes the first look at a report happen inside the window.
 *
 * Auth: a shared bearer secret (`REPORT_ALERT_TOKEN`), the same shape as the
 * CRON_SECRET routes. The trigger holds the token in `private.report_alert_config`,
 * which is REVOKEd from anon/authenticated, so the only caller is the database.
 * The body carries an id only: every field in the email is re-read server-side
 * with the service-role client, so a leaked token cannot inject email content.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const secret = process.env.REPORT_ALERT_TOKEN?.trim();
  const header = req.headers.authorization ?? '';
  const token = /^Bearer\s+(.+)$/i.exec(Array.isArray(header) ? header[0] : header)?.[1];
  if (!secret || token !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!supabase) {
    console.error('[report-alert] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    return res.status(503).json({ error: 'Service unavailable' });
  }

  const { reportId } = (req.body ?? {}) as { reportId?: string };

  if (!reportId || typeof reportId !== 'string' || !reportId.trim()) {
    return res.status(400).json({ error: 'reportId is required' });
  }

  try {
    const { data, error } = await supabase
      .from('content_reports')
      .select('id, content_type, category, reason')
      .eq('id', reportId.trim())
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Report not found' });

    const row = data as {
      id: string;
      content_type: string;
      category: string | null;
      reason: string | null;
    };
    await sendContentReportAlertEmail({
      reportId: row.id,
      contentType: row.content_type,
      category: row.category?.trim() ?? '',
      reason: row.reason?.trim() ?? '',
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[report-alert]', err);
    return res.status(500).json({ error: 'Alert failed' });
  }
}
