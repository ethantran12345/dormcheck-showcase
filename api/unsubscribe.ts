import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from './_lib/supabase.js';
import { verifyUnsubscribeToken } from './_lib/unsubscribe.js';
import { NOTIFICATION_CATEGORY_LABELS } from './_lib/notificationPrefs.js';
import type { NotificationPrefs } from './_lib/notificationPrefs.js';

/**
 * One-click unsubscribe (P0.4). The signed token in the query string is the
 * auth (see _lib/unsubscribe.ts). Two entry points per RFC 8058:
 *   - POST: mail clients' native "Unsubscribe" button (List-Unsubscribe-Post).
 *   - GET: the footer link in the email body - flips the pref and renders a
 *     small confirmation page linking to the full settings matrix.
 * Both are idempotent and only ever set notification_prefs.email[category]
 * to false for the token's user - never any other field.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!supabase) {
    console.error('[unsubscribe] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    return res.status(503).json({ error: 'Service unavailable' });
  }

  const raw = req.query.t;
  const token = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
  const parsed = token ? verifyUnsubscribeToken(token) : null;
  if (!parsed) {
    return res.status(400).send('This unsubscribe link is not valid.');
  }

  try {
    const { data: row, error: readErr } = await supabase
      .from('profiles')
      .select('notification_prefs')
      .eq('id', parsed.userId)
      .maybeSingle();
    if (readErr) throw readErr;
    // Unknown user (deleted account): report success - there is nothing to mute.
    if (row) {
      const prefs = ((row as { notification_prefs?: NotificationPrefs | null }).notification_prefs ??
        {}) as NotificationPrefs;
      const next: NotificationPrefs = {
        ...prefs,
        email: { ...(prefs.email ?? {}), [parsed.category]: false },
      };
      const { error: writeErr } = await supabase
        .from('profiles')
        .update({ notification_prefs: next })
        .eq('id', parsed.userId);
      if (writeErr) throw writeErr;
    }
  } catch (err) {
    console.error('[unsubscribe]', err);
    return res.status(500).send('Something went wrong. Please try again.');
  }

  if (req.method === 'POST') {
    return res.status(200).json({ ok: true });
  }

  const label = NOTIFICATION_CATEGORY_LABELS[parsed.category];
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribed - DormCheck</title></head>
<body style="margin:0;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;background:#fff;">
<div style="max-width:520px;margin:80px auto;padding:0 20px;">
<p style="font-size:18px;font-weight:800;color:#18181B;margin:0 0 12px;">You're unsubscribed</p>
<p style="font-size:16px;color:#18181B;line-height:1.6;margin:0 0 20px;">
You'll no longer get "${label}" emails from DormCheck. Push and in-app notifications are unchanged.</p>
<a href="https://dormcheck.com/settings?section=notifications" style="display:inline-block;padding:13px 30px;background:#0B702B;color:#fff;font-weight:800;font-size:15px;border-radius:9999px;text-decoration:none;">Manage notification settings</a>
</div></body></html>`);
}
