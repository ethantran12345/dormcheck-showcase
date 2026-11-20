import { supabase } from '../_lib/supabase.js';
import { getAuthedUser } from '../_lib/auth.js';
import { applyCors } from '../_lib/cors.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import {
  type Audience,
  parseAudience,
  serializeAudience,
  resolveRecipients,
  dispatchToRecipients,
  cleanRoute,
} from '../_lib/broadcastCore.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Manual admin push broadcast (push handoff, phase 3; scheduling + templates
// added 2026-07-14). Superadmin-only, verified SERVER-SIDE against profiles.role
// - the client gate (RequireSuperAdmin) is UI-only. Actions:
//   preview  → audience → recipient count
//   send     → fan out now (audit row), OR if scheduledFor is in the future,
//              write a 'scheduled' row for the cron to dispatch (superadmin-only)
//   cancel   → mark a scheduled broadcast 'canceled' (superadmin-only)
// University admins may immediate-send to their own school (unchanged); they may
// NOT schedule or cancel - those are operator-only.

// Server-side audience authorization — never trust the client's role/scope.
function authorizeAudience(
  caller: { role?: string; university_id?: string | null },
  audience: Audience,
): boolean {
  if (caller.role === 'superadmin') return true;
  if (caller.role === 'university_admin') {
    return (
      audience.kind === 'university' &&
      !!caller.university_id &&
      audience.universityId === caller.university_id
    );
  }
  return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!supabase) {
    console.error('[admin-broadcast] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    return res.status(503).json({ error: 'Service unavailable' });
  }
  try {
    const user = await getAuthedUser(req, { requireAal2: true });
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    // Server-side role check — never trust the client. admin_scopes ships in
    // migration 20260731020000; fall back to the pre-scope column list until it
    // reaches every environment.
    type Caller = { role?: string; university_id?: string | null; admin_scopes?: string[] | null };
    const scoped = await supabase
      .from('profiles')
      .select('role, university_id, admin_scopes')
      .eq('id', user.id)
      .maybeSingle();
    const me = scoped.error
      ? (
          await supabase
            .from('profiles')
            .select('role, university_id')
            .eq('id', user.id)
            .maybeSingle()
        ).data
      : scoped.data;
    const caller = (me as Caller | null) ?? {};
    if (caller.role !== 'superadmin' && caller.role !== 'university_admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (
      caller.role === 'university_admin' &&
      Array.isArray(caller.admin_scopes) &&
      !caller.admin_scopes.includes('broadcasts')
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (!(await enforceRateLimit({ res, action: 'admin_broadcast', userId: user.id, max: 20, windowSeconds: 3600 }))) {
      return;
    }

    const {
      action,
      audience: rawAudience,
      title,
      body,
      route,
      scheduledFor,
      broadcastId,
    } = req.body as {
      action?: string;
      audience?: unknown;
      title?: string;
      body?: string;
      route?: string;
      scheduledFor?: string;
      broadcastId?: string;
    };

    // --- cancel: superadmin-only, only a still-scheduled row ---
    if (action === 'cancel') {
      if (caller.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
      if (!broadcastId) return res.status(400).json({ error: 'broadcastId required' });
      const { data: updated, error: cErr } = await supabase
        .from('push_broadcasts')
        .update({ status: 'canceled' })
        .eq('id', broadcastId)
        .eq('status', 'scheduled')
        .select('id');
      if (cErr) return res.status(500).json({ error: 'Cancel failed' });
      if (!updated || updated.length === 0) {
        return res.status(409).json({ error: 'Not a scheduled broadcast (already sent, canceled, or missing)' });
      }
      return res.status(200).json({ ok: true, canceled: true });
    }

    const audience = parseAudience(rawAudience);
    if (!audience) return res.status(400).json({ error: 'Invalid audience' });

    // Per-audience scope check for both preview and send (preview leaks counts).
    if (!authorizeAudience(caller, audience)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (action === 'preview') {
      const recipients = await resolveRecipients(audience);
      if (!recipients) return res.status(500).json({ error: 'Failed to resolve audience' });
      return res.status(200).json({ ok: true, count: recipients.length });
    }
    if (action !== 'send') return res.status(400).json({ error: 'Invalid action' });

    const cleanTitle = title?.trim();
    const cleanBody = body?.trim();
    if (!cleanTitle || !cleanBody) {
      return res.status(400).json({ error: 'title and body are required' });
    }
    if (cleanTitle.length > 120 || cleanBody.length > 500) {
      return res.status(400).json({ error: 'title or body too long' });
    }
    const deepLink = cleanRoute(route);
    const { audience_type, audience_detail } = serializeAudience(audience);

    // --- scheduled send: superadmin-only. Persist a 'scheduled' row; the cron
    //     (api/cron/dispatch-broadcasts) dispatches it at the due time. ---
    if (typeof scheduledFor === 'string' && scheduledFor.trim()) {
      if (caller.role !== 'superadmin') {
        return res.status(403).json({ error: 'Scheduling is operator-only' });
      }
      const when = new Date(scheduledFor);
      if (Number.isNaN(when.getTime())) {
        return res.status(400).json({ error: 'Invalid scheduledFor' });
      }
      if (when.getTime() <= Date.now()) {
        return res.status(400).json({ error: 'scheduledFor must be in the future' });
      }
      const { error: insErr } = await supabase.from('push_broadcasts').insert({
        sender_id: user.id,
        audience_type,
        audience_detail,
        title: cleanTitle,
        body: cleanBody,
        route: deepLink,
        status: 'scheduled',
        scheduled_for: when.toISOString(),
      });
      if (insErr) {
        console.error('[admin-broadcast] schedule insert failed', insErr.message);
        return res.status(500).json({ error: 'Could not schedule broadcast' });
      }
      return res.status(200).json({ ok: true, scheduled: true, scheduledFor: when.toISOString() });
    }

    // --- immediate send ---
    const recipients = await resolveRecipients(audience);
    if (!recipients) return res.status(500).json({ error: 'Failed to resolve audience' });

    const result = await dispatchToRecipients(recipients, {
      title: cleanTitle,
      body: cleanBody,
      route: deepLink,
    });

    const { error: auditError } = await supabase.from('push_broadcasts').insert({
      sender_id: user.id,
      audience_type,
      audience_detail,
      title: cleanTitle,
      body: cleanBody,
      route: deepLink,
      sent_count: result.sent,
      failed_count: result.failed,
      status: 'sent',
    });
    if (auditError) console.error('[admin-broadcast] audit insert failed', auditError.message);

    return res.status(200).json({
      ok: true,
      sent: result.sent,
      failed: result.failed,
      eligible: result.eligible,
      resolved: result.resolved,
    });
  } catch (err) {
    console.error('[admin-broadcast]', err);
    return res.status(500).json({ error: 'Broadcast failed' });
  }
}
