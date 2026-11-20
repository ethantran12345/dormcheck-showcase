import { sendSellerRatingEmail } from './_lib/notifications.js';
import { sendPush } from './_lib/push.js';
import { supabase } from './_lib/supabase.js';
import { getAuthedUser, getCallerName, areUsersBlocked } from './_lib/auth.js';
import { shouldSendEmail, shouldSendPush, type NotificationProfile } from './_lib/notificationPrefs.js';
import { applyCors } from './_lib/cors.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * "You got a new review" to a seller, called by the rater's client right after
 * useUpsertSellerRating() lands. The rating row itself is the authorization:
 * we only email when a seller_ratings row (rater = caller) actually exists,
 * and only for a fresh rating (created ~= updated), so edits don't re-notify.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!supabase) {
    console.error('[notify-seller-rating] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in Vercel env');
    return res.status(503).json({ error: 'Service unavailable' });
  }
  try {
    const user = await getAuthedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    if (!(await enforceRateLimit({ res, action: 'seller-rating-notify', userId: user.id, max: 20, windowSeconds: 3600 }))) {
      return;
    }

    const { sellerId } = req.body as { sellerId?: string };
    if (!sellerId || typeof sellerId !== 'string' || !sellerId.trim()) {
      return res.status(400).json({ error: 'sellerId is required' });
    }
    if (sellerId.trim() === user.id) return res.status(200).json({ ok: true });

    // Stars and recency come from the rating row, never the request body.
    const { data: rating, error: ratingErr } = await supabase
      .from('seller_ratings')
      .select('stars, comment, created_at, updated_at')
      .eq('rater_id', user.id)
      .eq('seller_id', sellerId.trim())
      .maybeSingle();
    if (ratingErr || !rating) return res.status(404).json({ error: 'Rating not found' });
    const r = rating as { stars: number; comment: string | null; created_at: string; updated_at: string };

    // Edited ratings (updated well after created) don't re-notify.
    if (new Date(r.updated_at).getTime() - new Date(r.created_at).getTime() > 120_000) {
      return res.status(200).json({ ok: true });
    }

    if (await areUsersBlocked(user.id, sellerId.trim())) {
      return res.status(200).json({ ok: true });
    }

    const { data: sellerProfile } = await supabase
      .from('profiles')
      .select('email, email_notifications, notification_prefs')
      .eq('id', sellerId.trim())
      .maybeSingle();
    const prefs = sellerProfile as NotificationProfile | null;
    const sellerEmail = (sellerProfile as { email?: string | null } | null)?.email?.trim();

    if (shouldSendEmail(prefs, 'marketplace') && sellerEmail) {
      const raterName = await getCallerName(user.id, user.email);
      await sendSellerRatingEmail(
        sellerEmail,
        raterName,
        r.stars,
        { userId: sellerId.trim(), category: 'marketplace' },
        r.comment,
      );
    }
    if (shouldSendPush(prefs, 'marketplace')) {
      await sendPush(sellerId.trim(), 'New rating', `You got a ${r.stars}-star rating`, {
        type: 'seller_rating',
        route: '/marketplace/my-items',
      });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[notify-seller-rating]', err);
    return res.status(500).json({ error: 'Failed to send notification' });
  }
}
