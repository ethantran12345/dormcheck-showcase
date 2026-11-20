import { sendNewMessageEmail } from './_lib/notifications.js';
import { sendPush } from './_lib/push.js';
import { supabase } from './_lib/supabase.js';
import { getAuthedUser, getCallerName, areUsersBlocked } from './_lib/auth.js';
import { shouldSendEmail, shouldSendPush, type NotificationProfile } from './_lib/notificationPrefs.js';
import { applyCors } from './_lib/cors.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const NOTIFICATION_COOLDOWN_MINUTES = 15;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!supabase) {
    console.error('[notify-message] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in Vercel env');
    return res.status(503).json({ error: 'Service unavailable' });
  }
  try {
    const user = await getAuthedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Per-user backstop in addition to the per-conversation cooldown below.
    if (!(await enforceRateLimit({ res, action: 'message', userId: user.id, max: 60, windowSeconds: 3600 }))) {
      return;
    }

    const { conversationId, recipientParticipant } = req.body as {
      conversationId?: string;
      recipientParticipant?: 1 | 2;
    };

    if (!conversationId || typeof conversationId !== 'string' || !conversationId.trim()) {
      return res.status(400).json({ error: 'conversationId is required' });
    }
    if (recipientParticipant !== 1 && recipientParticipant !== 2) {
      return res.status(400).json({ error: 'recipientParticipant is required' });
    }
    const convId = conversationId.trim();
    const notifiedCol = recipientParticipant === 1
      ? 'participant_1_last_notified_at'
      : 'participant_2_last_notified_at';

    const { data: conv, error: convError } = await supabase
      .from('conversations')
      .select(`participant_1, participant_2, ${notifiedCol}`)
      .eq('id', convId)
      .maybeSingle();

    if (convError || !conv) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const row = conv as Record<string, string | null>;
    const recipientUserId = recipientParticipant === 1 ? row.participant_1 : row.participant_2;

    // Caller must be the other participant of this conversation.
    const isParticipant = row.participant_1 === user.id || row.participant_2 === user.id;
    if (!isParticipant || !recipientUserId || recipientUserId === user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Don't relay across a block in either direction.
    if (await areUsersBlocked(user.id, recipientUserId)) {
      return res.status(200).json({ ok: true });
    }

    let shouldSend = true;
    const lastNotified = row[notifiedCol];
    if (lastNotified) {
      const diffMinutes = (Date.now() - new Date(lastNotified).getTime()) / (1000 * 60);
      if (diffMinutes < NOTIFICATION_COOLDOWN_MINUTES) {
        shouldSend = false;
      }
    }

    const { data: recipientProfile } = await supabase
      .from('profiles')
      .select('email, email_notifications, notification_prefs')
      .eq('id', recipientUserId)
      .maybeSingle();
    const recipientEmail = (recipientProfile as { email?: string | null } | null)?.email?.trim() ?? '';
    const recipientPrefs = recipientProfile as NotificationProfile | null;

    const senderName = await getCallerName(user.id, user.email);

    if (shouldSendPush(recipientPrefs, 'messages')) {
      await sendPush(recipientUserId, 'New message', `${senderName} sent you a message`, {
        type: 'dm',
        route: `/messages?conversation=${convId}`,
        conversationId: convId,
      });
    }

    if (shouldSend && shouldSendEmail(recipientPrefs, 'messages') && recipientEmail) {
      // Latest message from the sender in this conversation, for the preview card.
      const { data: lastMsg } = await supabase
        .from('messages')
        .select('content')
        .eq('conversation_id', convId)
        .eq('sender_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      await sendNewMessageEmail(
        recipientEmail,
        senderName,
        convId,
        { userId: recipientUserId, category: 'messages' },
        (lastMsg as { content?: string | null } | null)?.content ?? null,
      );
      await supabase
        .from('conversations')
        .update({ [notifiedCol]: new Date().toISOString() })
        .eq('id', convId);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[notify-message]', err);
    return res.status(500).json({ error: 'Failed to send notification' });
  }
}
