import { sendRankingInviteEmail } from './_lib/notifications.js';
import { sendPush } from './_lib/push.js';
import { supabase } from './_lib/supabase.js';
import { getAuthedUser, getCallerName, areUsersBlocked } from './_lib/auth.js';
import { shouldSendEmail, shouldSendPush, type NotificationProfile } from './_lib/notificationPrefs.js';
import { applyCors } from './_lib/cors.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!supabase) {
    console.error('[notify-ranking-invite] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in Vercel env');
    return res.status(503).json({ error: 'Service unavailable' });
  }
  try {
    const user = await getAuthedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!(await enforceRateLimit({ res, action: 'ranking-invite', userId: user.id, max: 20, windowSeconds: 3600 }))) {
      return;
    }

    const { recipientEmail, inviteCode } = req.body as {
      recipientEmail?: string;
      inviteCode?: string;
    };
    if (!recipientEmail || typeof recipientEmail !== 'string' || !recipientEmail.trim()) {
      return res.status(400).json({ error: 'recipientEmail is required' });
    }
    if (!inviteCode || typeof inviteCode !== 'string' || !UUID_REGEX.test(inviteCode.trim())) {
      return res.status(400).json({ error: 'inviteCode is required' });
    }
    const code = inviteCode.trim();

    // Invite codes are ranking group ids; the caller must belong to the group.
    const [{ data: group }, { data: membership }] = await Promise.all([
      supabase.from('ranking_collaborations').select('id, owner_id').eq('id', code).maybeSingle(),
      supabase
        .from('ranking_group_members')
        .select('user_id')
        .eq('group_id', code)
        .eq('user_id', user.id)
        .eq('status', 'accepted')
        .maybeSingle(),
    ]);
    const isOwner = (group as { owner_id?: string | null } | null)?.owner_id === user.id;
    if (!group || (!isOwner && !membership)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Only send to addresses that already belong to a registered profile. The
    // recipient email from the body is never mailed directly - that would let
    // any group member use our verified domain to relay branded mail to any
    // address on the internet. Resolving through profiles confines delivery to
    // real (Pitt-gated) accounts and lets us honor their notification opt-out.
    const { data: recipientProfile } = await supabase
      .from('profiles')
      .select('id, email, email_notifications, notification_prefs')
      .eq('email', recipientEmail.trim().toLowerCase())
      .maybeSingle();
    const profileEmail = (recipientProfile as { email?: string | null } | null)?.email?.trim();
    if (!profileEmail) {
      return res.status(404).json({ error: 'Recipient not found' });
    }
    const recipientPrefs = recipientProfile as NotificationProfile | null;
    // Don't relay across a block in either direction.
    const recipientId = (recipientProfile as { id?: string | null } | null)?.id;
    if (recipientId && (await areUsersBlocked(user.id, recipientId))) {
      return res.status(200).json({ ok: true });
    }

    const senderName = await getCallerName(user.id, user.email);
    if (shouldSendEmail(recipientPrefs, 'ranking_invites')) {
      await sendRankingInviteEmail(
        profileEmail,
        senderName,
        code,
        recipientId ? { userId: recipientId, category: 'ranking_invites' } : undefined,
      );
    }
    if (recipientId && shouldSendPush(recipientPrefs, 'ranking_invites')) {
      await sendPush(recipientId, 'Ranking invite', `${senderName} invited you to collaborate`, {
        type: 'ranking_invite',
        route: `/rankings/invite/${code}`,
      });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[notify-ranking-invite]', err);
    return res.status(500).json({ error: 'Failed to send notification' });
  }
}
