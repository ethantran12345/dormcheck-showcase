import { sendMessageRequestAcceptedEmail } from './_lib/notifications.js';
import { sendPush } from './_lib/push.js';
import { supabase } from './_lib/supabase.js';
import { getAuthedUser, areUsersBlocked } from './_lib/auth.js';
import { shouldSendEmail, shouldSendPush, type NotificationProfile } from './_lib/notificationPrefs.js';
import { applyCors } from './_lib/cors.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!supabase) {
    console.error('[notify-message-request-accepted] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in Vercel env');
    return res.status(503).json({ error: 'Service unavailable' });
  }
  try {
    const user = await getAuthedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!(await enforceRateLimit({ res, action: 'request-accepted', userId: user.id, max: 30, windowSeconds: 3600 }))) {
      return;
    }

    const { conversationId } = req.body as { conversationId?: string };

    if (!conversationId || typeof conversationId !== 'string' || !conversationId.trim()) {
      return res.status(400).json({ error: 'conversationId is required' });
    }

    const id = conversationId.trim();

    const { data: conv, error: convError } = await supabase
      .from('conversations')
      .select('participant_1, participant_2, initiated_by')
      .eq('id', id)
      .eq('status', 'accepted')
      .maybeSingle();

    if (convError || !conv) {
      return res.status(200).json({ ok: true });
    }

    const senderId = conv.initiated_by;
    const accepterId = conv.participant_1 === senderId ? conv.participant_2 : conv.participant_1;

    // Only the accepting participant may trigger this notification.
    if (accepterId !== user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Don't relay across a block in either direction.
    if (senderId && (await areUsersBlocked(user.id, senderId))) {
      return res.status(200).json({ ok: true });
    }

    const { data: senderProfile, error: senderError } = await supabase
      .from('profiles')
      .select('email, email_notifications, notification_prefs')
      .eq('id', senderId)
      .maybeSingle();

    if (senderError || !senderProfile) {
      return res.status(200).json({ ok: true });
    }

    const senderPrefs = senderProfile as NotificationProfile;
    const senderEmail = (senderProfile as { email?: string | null }).email?.trim() ?? '';
    if (!shouldSendEmail(senderPrefs, 'message_requests') && !shouldSendPush(senderPrefs, 'message_requests')) {
      return res.status(200).json({ ok: true });
    }

    const { data: accepterProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', accepterId)
      .maybeSingle();
    const accepterName = (accepterProfile as { full_name?: string } | null)?.full_name?.trim() || 'Someone';

    if (shouldSendEmail(senderPrefs, 'message_requests') && senderEmail) {
      await sendMessageRequestAcceptedEmail(senderEmail, accepterName, id, {
        userId: senderId,
        category: 'message_requests',
      });
    }
    if (shouldSendPush(senderPrefs, 'message_requests')) {
      await sendPush(senderId, 'Request accepted', `${accepterName} accepted your message request`, {
        type: 'request_accepted',
        route: `/messages?conversation=${id}`,
        conversationId: id,
      });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[notify-message-request-accepted]', err);
    return res.status(500).json({ error: 'Failed to send notification' });
  }
}
