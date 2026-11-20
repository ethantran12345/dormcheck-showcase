import { sendGroupInviteAcceptedEmail } from './_lib/notifications.js';
import { supabase } from './_lib/supabase.js';
import { getAuthedUser, getCallerName, areUsersBlocked } from './_lib/auth.js';
import { shouldSendEmail, type NotificationProfile } from './_lib/notificationPrefs.js';
import { applyCors } from './_lib/cors.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Someone joined your group" email to a roommate-group owner, called by the
 * accepter's client right after it flips ranking_group_members.status to
 * 'accepted'. Push parity for this event is NOT here: the
 * notify_group_invite_accepted DB trigger fires the push (and the in-app
 * notification) on the same row change, so emitting sendPush() here too would
 * double-notify. That's why this file is in the notifyPushParity EXEMPT set.
 * Gated on the recipient's 'housing_groups' category, matching the trigger.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!supabase) {
    console.error('[notify-group-invite-accepted] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in Vercel env');
    return res.status(503).json({ error: 'Service unavailable' });
  }
  try {
    const user = await getAuthedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    if (!(await enforceRateLimit({ res, action: 'group-invite-accepted', userId: user.id, max: 20, windowSeconds: 3600 }))) {
      return;
    }

    const { groupId } = req.body as { groupId?: string };
    if (!groupId || typeof groupId !== 'string' || !UUID_REGEX.test(groupId.trim())) {
      return res.status(400).json({ error: 'groupId is required' });
    }
    const group = groupId.trim();

    // Authorization: the caller must actually be an accepted member of this
    // group (they just accepted), so a forged groupId can't email an owner the
    // caller never joined.
    const { data: membership } = await supabase
      .from('ranking_group_members')
      .select('id')
      .eq('group_id', group)
      .eq('user_id', user.id)
      .eq('status', 'accepted')
      .limit(1);
    if (!membership?.length) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Only roommate/housing groups notify (mirrors the trigger). Owner + name
    // come from the group row, never the request body.
    const { data: groupRow } = await supabase
      .from('ranking_collaborations')
      .select('owner_id, group_name, group_type')
      .eq('id', group)
      .maybeSingle();
    const g = groupRow as { owner_id: string; group_name: string | null; group_type: string | null } | null;
    if (!g || g.group_type !== 'roommate') {
      return res.status(200).json({ ok: true });
    }
    // Don't email yourself (owner accepting their own group is a no-op).
    if (g.owner_id === user.id) {
      return res.status(200).json({ ok: true });
    }
    if (await areUsersBlocked(user.id, g.owner_id)) {
      return res.status(200).json({ ok: true });
    }

    const { data: ownerProfile } = await supabase
      .from('profiles')
      .select('email, email_notifications, notification_prefs')
      .eq('id', g.owner_id)
      .maybeSingle();
    const prefs = ownerProfile as NotificationProfile | null;
    const ownerEmail = (ownerProfile as { email?: string | null } | null)?.email?.trim();

    if (shouldSendEmail(prefs, 'housing_groups') && ownerEmail) {
      const accepterName = await getCallerName(user.id, user.email);
      const groupName = g.group_name?.trim() || 'your group';
      await sendGroupInviteAcceptedEmail(ownerEmail, accepterName, groupName, {
        userId: g.owner_id,
        category: 'housing_groups',
      });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[notify-group-invite-accepted]', err);
    return res.status(500).json({ error: 'Failed to send notification' });
  }
}
