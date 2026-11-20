import { sendNewMessageRequestEmail } from './_lib/notifications.js';
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
    console.error('[notify-message-request] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in Vercel env');
    return res.status(503).json({ error: 'Service unavailable' });
  }
  try {
    const user = await getAuthedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!(await enforceRateLimit({ res, action: 'message-request', userId: user.id, max: 20, windowSeconds: 3600 }))) {
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
      .eq('status', 'pending')
      .maybeSingle();

    if (convError || !conv) {
      return res.status(200).json({ ok: true }); // idempotent: no conversation or not pending
    }

    // Only the requester may trigger this notification.
    if (conv.initiated_by !== user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const recipientId = conv.initiated_by === conv.participant_1 ? conv.participant_2 : conv.participant_1;
    const senderId = conv.initiated_by;

    // Don't relay across a block in either direction.
    if (recipientId && (await areUsersBlocked(user.id, recipientId))) {
      return res.status(200).json({ ok: true });
    }

    const { data: recipientProfile, error: recipientError } = await supabase
      .from('profiles')
      .select('email, email_notifications, notification_prefs')
      .eq('id', recipientId)
      .maybeSingle();

    if (recipientError || !recipientProfile) {
      return res.status(200).json({ ok: true });
    }

    const recipientPrefs = recipientProfile as NotificationProfile;
    const recipientEmail = (recipientProfile as { email?: string | null }).email?.trim() ?? '';
    if (!shouldSendEmail(recipientPrefs, 'message_requests') && !shouldSendPush(recipientPrefs, 'message_requests')) {
      return res.status(200).json({ ok: true });
    }

    const { data: senderProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', senderId)
      .maybeSingle();

    const senderName =
      (senderProfile as { full_name?: string } | null)?.full_name?.trim() || 'Someone';

    if (shouldSendEmail(recipientPrefs, 'message_requests') && recipientEmail) {
      // The requester's opening message gives the recipient real context.
      const { data: lastMsg } = await supabase
        .from('messages')
        .select('content')
        .eq('conversation_id', id)
        .eq('sender_id', senderId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      await sendNewMessageRequestEmail(
        recipientEmail,
        senderName,
        id,
        { userId: recipientId, category: 'message_requests' },
        (lastMsg as { content?: string | null } | null)?.content ?? null,
      );
    }
    if (shouldSendPush(recipientPrefs, 'message_requests')) {
      await sendPush(recipientId, 'New message request', `${senderName} wants to connect`, {
        type: 'message_request',
        route: `/messages?conversation=${id}`,
        conversationId: id,
      });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[notify-message-request]', err);
    return res.status(500).json({ error: 'Failed to send notification' });
  }
}
