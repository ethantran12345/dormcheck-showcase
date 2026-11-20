import { supabase } from '../_lib/supabase.js';
import { sendPush } from '../_lib/push.js';
import { shouldSendPush, type NotificationProfile } from '../_lib/notificationPrefs.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Move-in countdown pushes (push handoff, phase 2b). Vercel Cron hits this
// daily (vercel.json crons, 15:00 UTC = 11:00 ET). Idempotency: one row per
// (user, milestone) in movein_push_log — a same-day re-run sends nothing.
const MILESTONES = [35, 14, 7, 1] as const;

/** Checklist need snapshot used to tailor the nudge (personal list). */
type ChecklistCounts = { hasList: boolean; need: number; nightOneNeed: number };

const plural = (n: number, word: string) => (n === 1 ? word : `${word}s`);

/**
 * Copy tailored to how close move-in is AND what the student still needs.
 *   >= 14 days: buy-now window (time to shop + ship) - nudge to buy.
 *   <= 7 days: pack-later window (too late to ship) - nudge first-night + packing.
 * No em dashes in push copy.
 */
function copyFor(days: number, c: ChecklistCounts): { title: string; body: string } {
  const when =
    days === 1 ? 'Move-in is tomorrow' : days === 7 ? '1 week to move-in' : `Move-in is in ${days} days`;

  if (!c.hasList) {
    return { title: when, body: 'Start your move-in checklist so nothing gets left behind.' };
  }

  // Final stretch: first-night items matter most; shipping is off the table.
  if (days <= 7) {
    if (c.nightOneNeed > 0) {
      return {
        title: when,
        body: `${c.nightOneNeed} first-night ${plural(c.nightOneNeed, 'item')} still to get. Grab ${
          c.nightOneNeed === 1 ? 'it' : 'them'
        } and open your checklist.`,
      };
    }
    if (c.need > 0) {
      return { title: when, body: `${c.need} ${plural(c.need, 'item')} left. Check your list and start packing.` };
    }
    return { title: when, body: 'Your checklist is ready. Time to pack up.' };
  }

  // Buy-now window: plenty of lead time to order and ship.
  if (c.need > 0) {
    return { title: when, body: `${c.need} ${plural(c.need, 'item')} still to buy. Plenty of time to shop and ship.` };
  }
  return { title: when, body: 'Your checklist is ready. Nice work.' };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel Cron sends Authorization: Bearer ${CRON_SECRET}.
  const secret = process.env.CRON_SECRET?.trim();
  const header = req.headers.authorization ?? '';
  const token = /^Bearer\s+(.+)$/i.exec(Array.isArray(header) ? header[0] : header)?.[1];
  if (!secret || token !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!supabase) {
    console.error('[movein-countdown] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    return res.status(503).json({ error: 'Service unavailable' });
  }

  try {
    // UTC-date milestones: move_in_date is a plain date column.
    const today = new Date();
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const dateAt = (daysOut: number) =>
      new Date(todayUtc + daysOut * 86_400_000).toISOString().slice(0, 10);

    let sent = 0;
    let skipped = 0;

    for (const milestone of MILESTONES) {
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('id, notification_prefs, email_notifications')
        .eq('move_in_date', dateAt(milestone));
      if (error) {
        console.error('[movein-countdown] profiles query failed', milestone, error.message);
        continue;
      }

      // Per-recipient checklist snapshot (personal list) to tailor the nudge.
      const ids = (profiles ?? []).map((p) => p.id as string);
      const countsByUser = new Map<string, ChecklistCounts>();
      if (ids.length > 0) {
        const { data: items, error: itemsError } = await supabase
          .from('checklist_items')
          .select('user_id, status, is_checked, is_night_one')
          .in('user_id', ids)
          .is('group_id', null);
        if (itemsError) {
          console.error('[movein-countdown] checklist counts query failed', milestone, itemsError.message);
        }
        for (const it of (items ?? []) as Array<{
          user_id: string;
          status: string | null;
          is_checked: boolean | null;
          is_night_one: boolean | null;
        }>) {
          const cur = countsByUser.get(it.user_id) ?? { hasList: false, need: 0, nightOneNeed: 0 };
          cur.hasList = true;
          const isNeed = it.status ? it.status === 'need' : !it.is_checked;
          if (isNeed) {
            cur.need += 1;
            if (it.is_night_one) cur.nightOneNeed += 1;
          }
          countsByUser.set(it.user_id, cur);
        }
      }

      for (const profile of (profiles ?? []) as Array<NotificationProfile & { id: string }>) {
        if (!shouldSendPush(profile, 'movein')) {
          skipped++;
          continue;
        }
        // Claim the (user, milestone) slot first; a conflict means already sent.
        const { error: logError } = await supabase
          .from('movein_push_log')
          .insert({ user_id: profile.id, milestone });
        if (logError) {
          skipped++;
          continue;
        }
        const counts = countsByUser.get(profile.id) ?? { hasList: false, need: 0, nightOneNeed: 0 };
        const { title, body } = copyFor(milestone, counts);
        await sendPush(profile.id, title, body, {
          type: 'movein_countdown',
          route: '/checklist?tab=checklist',
          days: milestone,
        });
        sent++;
      }
    }

    return res.status(200).json({ ok: true, sent, skipped });
  } catch (err) {
    console.error('[movein-countdown]', err);
    return res.status(500).json({ error: 'Cron failed' });
  }
}
