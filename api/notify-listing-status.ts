import {
  sendListingApprovedEmail,
  sendListingRejectedEmail,
  sendListingUnderReviewEmail,
} from './_lib/notifications.js';
import { sendPush } from './_lib/push.js';
import { supabase } from './_lib/supabase.js';
import { getAuthedUser } from './_lib/auth.js';
import { shouldSendEmail, shouldSendPush, type NotificationProfile } from './_lib/notificationPrefs.js';
import { applyCors } from './_lib/cors.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const ACTIONS = ['approved', 'rejected', 'under_review'] as const;
type Action = (typeof ACTIONS)[number];

/**
 * Moderation status email to a listing's seller (admin-only; called by the
 * admin ReportsPage after it flips marketplace_listings.status).
 *   approved     -> "Your listing is live" (restore after review)
 *   rejected     -> "About your listing" + reason (admin soft-hide)
 *   under_review -> "We're reviewing your listing"
 * Stamps under_review_notified_at (migration 20260731050000) on rejected /
 * under_review so the daily listing-freshness sweep never double-emails the
 * same review cycle, and clears it on approved so a future re-hide notifies
 * again. Listing title and seller email come from the DB, never the body.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!supabase) {
    console.error('[notify-listing-status] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in Vercel env');
    return res.status(503).json({ error: 'Service unavailable' });
  }
  try {
    const user = await getAuthedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('role, university_id')
      .eq('id', user.id)
      .maybeSingle();
    const caller = callerProfile as { role?: string; university_id?: string | null } | null;
    const role = caller?.role;
    if (role !== 'superadmin' && role !== 'university_admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (!(await enforceRateLimit({ res, action: 'notify-listing-status', userId: user.id, max: 60, windowSeconds: 3600 }))) {
      return;
    }

    const { listingId, action, reason } = req.body as { listingId?: string; action?: string; reason?: string };
    if (!listingId || typeof listingId !== 'string' || !listingId.trim()) {
      return res.status(400).json({ error: 'listingId is required' });
    }
    if (!ACTIONS.includes(action as Action)) {
      return res.status(400).json({ error: 'action must be approved, rejected, or under_review' });
    }

    const { data: listing, error: listingErr } = await supabase
      .from('marketplace_listings')
      .select('id, title, user_id, price, image_urls, university_id')
      .eq('id', listingId.trim())
      .maybeSingle();
    if (listingErr || !listing) return res.status(404).json({ error: 'Listing not found' });
    const l = listing as {
      id: string;
      title: string | null;
      user_id: string;
      price: number | null;
      image_urls: string[] | null;
      university_id: string | null;
    };
    // Tenant clamp: a university_admin can only relay status mail for listings
    // at their own school; anything else is a cross-tenant phishing vector on
    // the service-role client.
    if (role !== 'superadmin' && (!caller?.university_id || l.university_id !== caller.university_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const title = l.title?.trim() || 'your listing';
    const listingExtra = { imageUrl: l.image_urls?.[0] ?? null, price: l.price ?? null };

    const { data: sellerProfile } = await supabase
      .from('profiles')
      .select('email, email_notifications, notification_prefs')
      .eq('id', l.user_id)
      .maybeSingle();
    const prefs = sellerProfile as NotificationProfile | null;
    const sellerEmail = (sellerProfile as { email?: string | null } | null)?.email?.trim();

    if (shouldSendEmail(prefs, 'marketplace') && sellerEmail) {
      const unsub = { userId: l.user_id, category: 'marketplace' as const };
      if (action === 'approved') {
        await sendListingApprovedEmail(sellerEmail, title, unsub, listingExtra);
      } else if (action === 'rejected') {
        const safeReason = typeof reason === 'string' && reason.trim()
          ? reason.trim().slice(0, 500)
          : "It didn't meet our listing guidelines.";
        await sendListingRejectedEmail(sellerEmail, title, safeReason, unsub, listingExtra);
      } else {
        await sendListingUnderReviewEmail(sellerEmail, title, unsub, listingExtra);
      }
    }

    if (shouldSendPush(prefs, 'marketplace')) {
      const pushCopy: Record<Action, { title: string; body: string }> = {
        approved: { title: 'Listing approved', body: `"${title}" is live on the marketplace` },
        rejected: { title: 'About your listing', body: `"${title}" was removed after review` },
        under_review: { title: 'Listing under review', body: `"${title}" is being reviewed` },
      };
      const copy = pushCopy[action as Action];
      await sendPush(l.user_id, copy.title, copy.body, {
        type: 'listing_status',
        route: '/marketplace/my-items',
        listingId: l.id,
        action,
      });
    }

    // Dedupe stamp for the cron sweep; tolerate prod not having the column yet
    // (PGRST204 until migration 20260731050000 is applied).
    const stamp = action === 'approved' ? null : new Date().toISOString();
    const { error: stampErr } = await supabase
      .from('marketplace_listings')
      .update({ under_review_notified_at: stamp } as never)
      .eq('id', l.id);
    if (stampErr && stampErr.code !== 'PGRST204') {
      console.error('[notify-listing-status] dedupe stamp failed', l.id, stampErr);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[notify-listing-status]', err);
    return res.status(500).json({ error: 'Failed to send notification' });
  }
}
