import { sendMarketplaceInquiryEmail } from './_lib/notifications.js';
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
    console.error('[notify-marketplace-inquiry] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in Vercel env');
    return res.status(503).json({ error: 'Service unavailable' });
  }
  try {
    const user = await getAuthedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!(await enforceRateLimit({ res, action: 'marketplace-inquiry', userId: user.id, max: 20, windowSeconds: 3600 }))) {
      return;
    }

    const { listingId } = req.body as { listingId?: string };
    if (!listingId || typeof listingId !== 'string' || !listingId.trim()) {
      return res.status(400).json({ error: 'listingId is required' });
    }

    // The seller email and item name come from the listing itself, never from
    // the request body.
    const { data: listing, error: listingError } = await supabase
      .from('marketplace_listings')
      .select('id, title, user_id, price, image_urls')
      .eq('id', listingId.trim())
      .maybeSingle();

    if (listingError || !listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    const sellerUserId = (listing as { user_id: string }).user_id;
    if (sellerUserId === user.id) {
      return res.status(200).json({ ok: true });
    }

    // Authorization: only notify a seller the caller has actually opened a
    // conversation with. Both message-seller call sites (useMessageSeller,
    // SavedHomeBand) create the conversation before posting here, so a custom
    // client cannot spam sellers it never contacted by enumerating listing ids.
    const { data: convo } = await supabase
      .from('conversations')
      .select('id')
      .or(
        `and(participant_1.eq.${user.id},participant_2.eq.${sellerUserId}),and(participant_1.eq.${sellerUserId},participant_2.eq.${user.id})`
      )
      .limit(1);
    if (!convo?.length) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    // Don't relay across a block in either direction.
    if (await areUsersBlocked(user.id, sellerUserId)) {
      return res.status(200).json({ ok: true });
    }

    const { data: sellerProfile } = await supabase
      .from('profiles')
      .select('email, email_notifications, notification_prefs')
      .eq('id', sellerUserId)
      .maybeSingle();
    const sellerPrefs = sellerProfile as NotificationProfile | null;
    const sellerEmail = (sellerProfile as { email?: string | null } | null)?.email?.trim();

    const l = listing as { title?: string | null; price?: number | null; image_urls?: string[] | null };
    const itemName = l.title?.trim() || 'your listing';
    if (shouldSendEmail(sellerPrefs, 'marketplace') && sellerEmail) {
      // The buyer's most recent message in this conversation gives the seller
      // real context (the caller is the buyer, messaging the seller).
      const { data: lastMsg } = await supabase
        .from('messages')
        .select('content')
        .eq('conversation_id', (convo![0] as { id: string }).id)
        .eq('sender_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      await sendMarketplaceInquiryEmail(
        sellerEmail,
        itemName,
        { userId: sellerUserId, category: 'marketplace' },
        {
          imageUrl: l.image_urls?.[0] ?? null,
          price: l.price ?? null,
          messageSnippet: (lastMsg as { content?: string | null } | null)?.content ?? null,
        },
      );
    }
    if (shouldSendPush(sellerPrefs, 'marketplace')) {
      await sendPush(sellerUserId, 'New marketplace inquiry', `Someone is interested in ${itemName}`, {
        type: 'marketplace_inquiry',
        route: '/marketplace/my-items',
      });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[notify-marketplace-inquiry]', err);
    return res.status(500).json({ error: 'Failed to send notification' });
  }
}
