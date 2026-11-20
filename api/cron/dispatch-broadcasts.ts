import { supabase } from '../_lib/supabase.js';
import {
  deserializeAudience,
  resolveRecipients,
  dispatchToRecipients,
} from '../_lib/broadcastCore.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Scheduled-broadcast dispatcher (scheduled/templated broadcasts, 2026-07-14).
 * Vercel Cron every ~5 min (vercel.json). Claims due 'scheduled' push_broadcasts
 * rows and dispatches them through the SAME core as an immediate send.
 *
 * At-most-once via an atomic claim: the `status='scheduled' → 'sent'` UPDATE is
 * the lock, so a second concurrent run matches zero rows and never double-sends.
 * Trade-off: a crash AFTER claim but BEFORE dispatch under-sends (row reads
 * 'sent' with 0 counts) rather than double-sending - the safe direction. A
 * crash-resilient exactly-once upgrade ('sending' + claimed_at + reaper) is v2.
 * Overdue (still 'scheduled' past due) rows are surfaced in the admin UI.
 */
type ClaimedRow = {
  id: string;
  audience_type: string;
  audience_detail: Record<string, unknown> | null;
  title: string;
  body: string;
  route: string | null;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET?.trim();
  const header = req.headers.authorization ?? '';
  const token = /^Bearer\s+(.+)$/i.exec(Array.isArray(header) ? header[0] : header)?.[1];
  if (!secret || token !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!supabase) {
    console.error('[dispatch-broadcasts] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    return res.status(503).json({ error: 'Service unavailable' });
  }

  try {
    // Atomic claim: flip due scheduled rows to 'sent' and take them. Any second
    // concurrent run sees them already 'sent' and claims nothing.
    const { data: claimed, error: claimErr } = await supabase
      .from('push_broadcasts')
      .update({ status: 'sent' })
      .eq('status', 'scheduled')
      .lte('scheduled_for', new Date().toISOString())
      .select('id, audience_type, audience_detail, title, body, route');
    if (claimErr) {
      console.error('[dispatch-broadcasts] claim failed', claimErr.message);
      return res.status(500).json({ error: 'Claim failed' });
    }

    const rows = (claimed ?? []) as ClaimedRow[];
    let dispatched = 0;
    let skipped = 0;

    for (const row of rows) {
      const audience = deserializeAudience(row.audience_type, row.audience_detail);
      if (!audience) {
        console.error('[dispatch-broadcasts] undecodable audience', row.id, row.audience_type);
        skipped++;
        continue;
      }
      const recipients = await resolveRecipients(audience);
      if (!recipients) {
        console.error('[dispatch-broadcasts] resolve failed', row.id);
        skipped++;
        continue;
      }
      const result = await dispatchToRecipients(recipients, {
        title: row.title,
        body: row.body,
        route: row.route,
      });
      // Backfill counts on the already-claimed ('sent') row.
      await supabase
        .from('push_broadcasts')
        .update({ sent_count: result.sent, failed_count: result.failed })
        .eq('id', row.id);
      dispatched++;
    }

    return res.status(200).json({ ok: true, claimed: rows.length, dispatched, skipped });
  } catch (err) {
    console.error('[dispatch-broadcasts]', err);
    return res.status(500).json({ error: 'Dispatch run failed' });
  }
}
