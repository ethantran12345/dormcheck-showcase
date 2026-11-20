import { sendSchoolLaunchEmail } from './_lib/notifications.js';
import { sendPush } from './_lib/push.js';
import { supabase } from './_lib/supabase.js';
import { shouldSendPush, type NotificationProfile } from './_lib/notificationPrefs.js';
import { getAuthedUser } from './_lib/auth.js';
import { applyCors } from './_lib/cors.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * "Your school just launched" batch (superadmin-only). Run manually after a
 * university is flipped is_active=true: emails every university_waitlist row
 * whose email_domain matches the university's email_domains and that hasn't
 * been notified yet (launch_notified_at, migration 20260731050000). Batched at
 * 200 per call; re-invoke until `remaining` is 0. Waitlist mail is
 * transactional to non-users, so profiles.email_notifications does not apply.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!supabase) {
    console.error('[notify-school-launch] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in Vercel env');
    return res.status(503).json({ error: 'Service unavailable' });
  }
  try {
    const user = await getAuthedUser(req, { requireAal2: true });
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if ((callerProfile as { role?: string } | null)?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Fans out up to 200 emails per call - throttle even for a superadmin.
    if (!(await enforceRateLimit({ res, action: 'notify-school-launch', userId: user.id, max: 10, windowSeconds: 3600 }))) {
      return;
    }

    const { universitySlug } = req.body as { universitySlug?: string };
    if (!universitySlug || typeof universitySlug !== 'string' || !universitySlug.trim()) {
      return res.status(400).json({ error: 'universitySlug is required' });
    }

    const { data: uni, error: uniErr } = await supabase
      .from('universities')
      .select('name, email_domains, is_active')
      .eq('slug', universitySlug.trim())
      .maybeSingle();
    if (uniErr || !uni) return res.status(404).json({ error: 'University not found' });
    const u = uni as { name: string; email_domains: string[] | null; is_active: boolean };
    if (!u.is_active) {
      return res.status(409).json({ error: 'University is not active yet - flip is_active first' });
    }
    const domains = (u.email_domains ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean);
    if (!domains.length) return res.status(409).json({ error: 'University has no email_domains' });

    const { data: rows, error: rowsErr } = await supabase
      .from('university_waitlist')
      .select('id, email')
      .in('email_domain', domains)
      .is('launch_notified_at' as never, null)
      .limit(200);
    if (rowsErr) throw rowsErr;

    // Skip suppressed addresses (hard bounces / complaints recorded by
    // api/events.ts). Stamp them notified anyway so `remaining` converges.
    const emails = (rows ?? []).map((row) => (row as { email: string }).email.trim().toLowerCase());
    const suppressed = new Set<string>();
    if (emails.length) {
      const { data: sup, error: supErr } = await supabase
        .from('email_suppressions')
        .select('email')
        .in('email', emails);
      if (supErr) throw supErr;
      for (const s of sup ?? []) suppressed.add((s as { email: string }).email);
    }

    let sent = 0;
    let skippedSuppressed = 0;
    const notifiedEmails: string[] = [];
    for (const row of rows ?? []) {
      const r = row as { id: string; email: string };
      if (suppressed.has(r.email.trim().toLowerCase())) {
        await supabase
          .from('university_waitlist')
          .update({ launch_notified_at: new Date().toISOString() } as never)
          .eq('id', r.id);
        skippedSuppressed++;
        continue;
      }
      try {
        await sendSchoolLaunchEmail(r.email, u.name);
      } catch (sendErr) {
        console.error('[notify-school-launch] send failed for', r.id, sendErr);
        continue; // leave launch_notified_at null so a re-run retries it
      }
      await supabase
        .from('university_waitlist')
        .update({ launch_notified_at: new Date().toISOString() } as never)
        .eq('id', r.id);
      sent++;
      notifiedEmails.push(r.email.trim().toLowerCase());
    }

    // Push, but only to recipients who already have an account with a
    // registered device token (app installed). Email stays the universal path.
    let pushed = 0;
    if (notifiedEmails.length) {
      const { data: accountRows } = await supabase
        .from('profiles')
        .select('id, notification_prefs')
        .in('email', notifiedEmails);
      const accounts = (accountRows ?? []) as Array<{ id: string } & NotificationProfile>;
      if (accounts.length) {
        const { data: tokenRows } = await supabase
          .from('device_tokens')
          .select('user_id')
          .in('user_id', accounts.map((a) => a.id));
        const withDevice = new Set((tokenRows ?? []).map((t) => (t as { user_id: string }).user_id));
        for (const account of accounts) {
          if (!withDevice.has(account.id)) continue;
          if (!shouldSendPush(account, 'announcements')) continue;
          await sendPush(account.id, `${u.name} just launched`, 'DormCheck is now live at your school', {
            type: 'school_launch',
            route: '/my-home',
          });
          pushed++;
        }
      }
    }

    const { count } = await supabase
      .from('university_waitlist')
      .select('id', { count: 'exact', head: true })
      .in('email_domain', domains)
      .is('launch_notified_at' as never, null);

    return res.status(200).json({ ok: true, sent, pushed, skippedSuppressed, remaining: count ?? 0 });
  } catch (err) {
    console.error('[notify-school-launch]', err);
    return res.status(500).json({ error: 'Failed to send launch emails' });
  }
}
