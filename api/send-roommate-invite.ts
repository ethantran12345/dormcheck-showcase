import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendHousingGroupInviteEmail } from './_lib/notifications.js';
import { sendPush } from './_lib/push.js';
import { supabase } from './_lib/supabase.js';
import { getAuthedUser, getCallerName, areUsersBlocked } from './_lib/auth.js';
import { shouldSendEmail, shouldSendPush, type NotificationProfile } from './_lib/notificationPrefs.js';
import { applyCors } from './_lib/cors.js';
import { enforceRateLimit } from './_lib/rateLimit.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!supabase) {
    console.error('[send-roommate-invite] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in Vercel env');
    return res.status(503).json({ error: 'Service unavailable' });
  }

  try {
    const user = await getAuthedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!(await enforceRateLimit({ res, action: 'roommate-invite', userId: user.id, max: 20, windowSeconds: 3600 }))) {
      return;
    }

    const { recipientUserId } = req.body as { recipientUserId?: string };
    if (
      !recipientUserId ||
      typeof recipientUserId !== 'string' ||
      !UUID_REGEX.test(recipientUserId.trim())
    ) {
      return res.status(400).json({ error: 'recipientUserId is required' });
    }

    const recipient = recipientUserId.trim();

    // Authorization: the caller must have actually invited this user into a group
    // they own or belong to. The collaborate flow inserts a pending
    // ranking_group_members row (status='pending') before emailing; without one
    // this would be an unsolicited branded invite to an arbitrary user by UUID.
    const { data: pendingRows } = await supabase
      .from('ranking_group_members')
      .select('group_id')
      .eq('user_id', recipient)
      .eq('status', 'pending');
    const pendingGroupIds = [
      ...new Set((pendingRows ?? []).map((r) => (r as { group_id: string }).group_id)),
    ];
    let authorizedGroupId: string | null = null;
    if (pendingGroupIds.length > 0) {
      const { data: ownedGroups } = await supabase
        .from('ranking_collaborations')
        .select('id')
        .in('id', pendingGroupIds)
        .eq('owner_id', user.id)
        .limit(1);
      authorizedGroupId = (ownedGroups?.[0] as { id: string } | undefined)?.id ?? null;
      if (!authorizedGroupId) {
        const { data: memberOf } = await supabase
          .from('ranking_group_members')
          .select('group_id')
          .in('group_id', pendingGroupIds)
          .eq('user_id', user.id)
          .eq('status', 'accepted')
          .limit(1);
        authorizedGroupId = (memberOf?.[0] as { group_id: string } | undefined)?.group_id ?? null;
      }
    }
    if (!authorizedGroupId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (await areUsersBlocked(user.id, recipient)) {
      return res.status(200).json({ ok: true });
    }

    const { data: recipientProfile, error: profileErr } = await supabase
      .from('profiles')
      .select('email, full_name, email_notifications, notification_prefs')
      .eq('id', recipient)
      .maybeSingle();

    if (profileErr || !recipientProfile?.email) {
      return res.status(404).json({ error: 'Recipient not found' });
    }

    const senderName = await getCallerName(user.id, user.email);
    if (shouldSendEmail(recipientProfile as NotificationProfile, 'roommate_invites')) {
      await sendHousingGroupInviteEmail(recipientProfile.email.trim(), senderName, {
        userId: recipient,
        category: 'roommate_invites',
      });
    }
    if (shouldSendPush(recipientProfile as NotificationProfile, 'roommate_invites')) {
      await sendPush(recipient, 'Roommate invite', `${senderName} invited you to their group`, {
        type: 'roommate_invite',
        route: `/roommates/invite/${authorizedGroupId}`,
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[send-roommate-invite]', err);
    return res.status(500).json({ error: 'Failed to send invite' });
  }
}
