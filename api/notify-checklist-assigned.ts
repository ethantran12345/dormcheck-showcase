import { sendChecklistAssignedEmail } from './_lib/notifications.js';
import { sendPush } from './_lib/push.js';
import { supabase } from './_lib/supabase.js';
import { getAuthedUser, getCallerName, areUsersBlocked } from './_lib/auth.js';
import { shouldSendEmail, shouldSendPush, type NotificationProfile } from './_lib/notificationPrefs.js';
import { applyCors } from './_lib/cors.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * "{assigner} assigned you a move-in task" - called by AssigneeControl right
 * after it writes checklist_items.assigned_to. That write may not have
 * committed when this runs, so the body's assigneeId is accepted - but only
 * for a GROUP item where BOTH the caller and the assignee are members of the
 * item's group (so a forged itemId/assigneeId can't aim mail at strangers).
 * Category: movein.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!supabase) {
    console.error('[notify-checklist-assigned] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in Vercel env');
    return res.status(503).json({ error: 'Service unavailable' });
  }
  try {
    const user = await getAuthedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    if (!(await enforceRateLimit({ res, action: 'checklist-assigned', userId: user.id, max: 30, windowSeconds: 3600 }))) {
      return;
    }

    const { itemId, assigneeId } = req.body as { itemId?: string; assigneeId?: string };
    if (!itemId || typeof itemId !== 'string' || !itemId.trim()) {
      return res.status(400).json({ error: 'itemId is required' });
    }
    if (!assigneeId || typeof assigneeId !== 'string' || !assigneeId.trim()) {
      return res.status(400).json({ error: 'assigneeId is required' });
    }
    const assignee = assigneeId.trim();

    // Self-assignments don't email.
    if (assignee === user.id) return res.status(200).json({ ok: true });

    const { data: item, error: itemErr } = await supabase
      .from('checklist_items')
      .select('id, item, group_id')
      .eq('id', itemId.trim())
      .maybeSingle();
    if (itemErr || !item) return res.status(404).json({ error: 'Item not found' });
    const it = item as { id: string; item: string | null; group_id: string | null };

    // Personal (non-group) items never email.
    if (!it.group_id) return res.status(200).json({ ok: true });

    const { data: members } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', it.group_id)
      .in('user_id', [user.id, assignee]);
    const memberIds = new Set((members ?? []).map((m) => (m as { user_id: string }).user_id));
    if (!memberIds.has(user.id) || !memberIds.has(assignee)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (await areUsersBlocked(user.id, assignee)) {
      return res.status(200).json({ ok: true });
    }

    const { data: assigneeProfile } = await supabase
      .from('profiles')
      .select('email, email_notifications, notification_prefs')
      .eq('id', assignee)
      .maybeSingle();
    const prefs = assigneeProfile as NotificationProfile | null;
    const assigneeEmail = (assigneeProfile as { email?: string | null } | null)?.email?.trim();

    const itemName = it.item?.trim() || 'a checklist item';
    const assignerName = await getCallerName(user.id, user.email);
    if (shouldSendEmail(prefs, 'movein') && assigneeEmail) {
      await sendChecklistAssignedEmail(assigneeEmail, assignerName, itemName, {
        userId: assignee,
        category: 'movein',
      });
    }
    if (shouldSendPush(prefs, 'movein')) {
      await sendPush(assignee, 'Checklist item assigned', `${assignerName} assigned you ${itemName}`, {
        type: 'checklist_assigned',
        route: '/checklist',
        itemId: it.id,
      });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[notify-checklist-assigned]', err);
    return res.status(500).json({ error: 'Failed to send notification' });
  }
}
