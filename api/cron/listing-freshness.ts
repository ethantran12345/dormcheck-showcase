import { supabase } from "../_lib/supabase.js";
import { sendPush } from "../_lib/push.js";
import { sendListingUnderReviewEmail } from "../_lib/notifications.js";
import {
  shouldSendEmail,
  shouldSendPush,
  type NotificationProfile,
} from "../_lib/notificationPrefs.js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const NUDGE_AFTER_DAYS = 21;
const EXPIRE_AFTER_DAYS = 35;
const DELIVERY_CONCURRENCY = 10;

/** Keep cron delivery bounded: fast enough for a 200-row batch without turning
 * a backlog into a burst of parallel Resend/push/database traffic. */
async function mapWithConcurrency<T, U>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<U>
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await task(items[index]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

/**
 * Listing freshness (P1.11). Daily Vercel Cron:
 *   1. Available listings unconfirmed for 21+ days get ONE "still available?"
 *      nudge (in-app notification + push, marketplace category) - the seller
 *      confirms by editing/relisting, which resets last_confirmed_at.
 *   2. At 35+ days they expire (status 'expired'): gone from the buyer feed,
 *      one tap to relist in My Marketplace.
 * Idempotent via freshness_nudged_at; the expiry write is naturally
 * idempotent (already-expired rows don't match the filter).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET?.trim();
  const header = req.headers.authorization ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(
    Array.isArray(header) ? header[0] : header
  )?.[1];
  if (!secret || token !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!supabase) {
    console.error(
      "[listing-freshness] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set"
    );
    return res.status(503).json({ error: "Service unavailable" });
  }

  try {
    const nudgeCutoff = new Date(
      Date.now() - NUDGE_AFTER_DAYS * 86_400_000
    ).toISOString();
    const expireCutoff = new Date(
      Date.now() - EXPIRE_AFTER_DAYS * 86_400_000
    ).toISOString();

    // 2. Expire first so a listing never gets nudged and expired the same run.
    const { data: expired, error: expireErr } = await supabase
      .from("marketplace_listings")
      .update({ status: "expired" } as never)
      .eq("status", "available")
      .lte("last_confirmed_at", expireCutoff)
      .select("id, user_id, title");
    if (expireErr) throw expireErr;

    // 1. Nudge the 21-35 day band, once per staleness cycle.
    const { data: stale, error: staleErr } = await supabase
      .from("marketplace_listings")
      .select("id, user_id, title, university_id")
      .eq("status", "available")
      .lte("last_confirmed_at", nudgeCutoff)
      .is("freshness_nudged_at" as never, null)
      .limit(200);
    if (staleErr) throw staleErr;

    const staleListings = (stale ?? []) as Array<{
      id: string;
      user_id: string;
      title: string;
      university_id: string | null;
    }>;
    const staleUserIds = [
      ...new Set(staleListings.map((listing) => listing.user_id)),
    ];
    const { data: staleProfiles, error: staleProfilesErr } = staleUserIds.length
      ? await supabase
          .from("profiles")
          .select("id, notification_prefs")
          .in("id", staleUserIds)
      : { data: [], error: null };
    if (staleProfilesErr) throw staleProfilesErr;
    const staleProfileById = new Map(
      (staleProfiles ?? []).map((profile) => [
        (profile as { id: string }).id,
        profile as NotificationProfile,
      ])
    );
    const nudgeResults = await mapWithConcurrency(
      staleListings,
      DELIVERY_CONCURRENCY,
      async (listing) => {
        try {
          const { error: notificationError } = await supabase
            .from("notifications")
            .insert({
              recipient_id: listing.user_id,
              type: "listing_freshness",
              payload: {
                listing_id: listing.id,
                title: listing.title,
                expires_in_days: EXPIRE_AFTER_DAYS - NUDGE_AFTER_DAYS,
              },
              university_id: listing.university_id,
            } as never);
          if (notificationError) throw notificationError;
          if (
            shouldSendPush(
              staleProfileById.get(listing.user_id) ?? null,
              "marketplace"
            )
          ) {
            await sendPush(
              listing.user_id,
              "Still selling this?",
              `"${listing.title}" expires soon unless you confirm it's still available.`,
              { type: "listing_freshness", route: "/marketplace/my-items" }
            );
          }
          const { error: updateError } = await supabase
            .from("marketplace_listings")
            .update({ freshness_nudged_at: new Date().toISOString() } as never)
            .eq("id", listing.id)
            .is("freshness_nudged_at" as never, null);
          if (updateError) throw updateError;
          return true;
        } catch (error) {
          console.error("[listing-freshness] nudge failed", listing.id, error);
          return false;
        }
      }
    );
    const nudged = nudgeResults.filter(Boolean).length;

    // 3. Sellers whose listing was auto-hidden by the report threshold (DB
    //    trigger flips status to under_review; no server hop exists there) get
    //    ONE "we're reviewing your listing" email per review cycle. Admin
    //    moderation via notify-listing-status stamps/clears the same column.
    //    Guarded separately: prod may not have under_review_notified_at until
    //    migration 20260731050000 is applied.
    let reviewNotified = 0;
    try {
      const { data: underReview, error: reviewErr } = await supabase
        .from("marketplace_listings")
        .select("id, user_id, title")
        .eq("status", "under_review")
        .is("under_review_notified_at" as never, null)
        .limit(100);
      if (reviewErr) throw reviewErr;
      const reviewListings = (underReview ?? []) as Array<{
        id: string;
        user_id: string;
        title: string | null;
      }>;
      const reviewUserIds = [
        ...new Set(reviewListings.map((listing) => listing.user_id)),
      ];
      const { data: reviewProfiles, error: reviewProfilesErr } =
        reviewUserIds.length
          ? await supabase
              .from("profiles")
              .select("id, email, email_notifications, notification_prefs")
              .in("id", reviewUserIds)
          : { data: [], error: null };
      if (reviewProfilesErr) throw reviewProfilesErr;
      const reviewProfileById = new Map(
        (reviewProfiles ?? []).map((profile) => [
          (profile as { id: string }).id,
          profile as NotificationProfile & { email?: string | null },
        ])
      );
      const reviewResults = await mapWithConcurrency(
        reviewListings,
        DELIVERY_CONCURRENCY,
        async (listing) => {
          try {
            const profile = reviewProfileById.get(listing.user_id) ?? null;
            const email = profile?.email?.trim();
            if (shouldSendEmail(profile, "marketplace") && email) {
              await sendListingUnderReviewEmail(
                email,
                listing.title?.trim() || "your listing",
                {
                  userId: listing.user_id,
                  category: "marketplace",
                }
              );
            }
            // Stamp even when preferences skipped email: this review cycle has
            // been handled. The null predicate prevents a second cron run from
            // overwriting a newer notification timestamp.
            const { error: updateError } = await supabase
              .from("marketplace_listings")
              .update({
                under_review_notified_at: new Date().toISOString(),
              } as never)
              .eq("id", listing.id)
              .is("under_review_notified_at" as never, null);
            if (updateError) throw updateError;
            return true;
          } catch (error) {
            console.error(
              "[listing-freshness] review notification failed",
              listing.id,
              error
            );
            return false;
          }
        }
      );
      reviewNotified = reviewResults.filter(Boolean).length;
    } catch (reviewSweepErr) {
      console.error(
        "[listing-freshness] under-review sweep failed (column missing until migration 20260731050000?)",
        reviewSweepErr
      );
    }

    return res.status(200).json({
      ok: true,
      nudged,
      expired: expired?.length ?? 0,
      reviewNotified,
    });
  } catch (err) {
    console.error("[listing-freshness]", err);
    return res.status(500).json({ error: "Freshness run failed" });
  }
}
