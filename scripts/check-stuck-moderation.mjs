#!/usr/bin/env node
/**
 * Stuck-moderation monitor.
 *
 * THE FAILURE MODE THIS EXISTS FOR. A marketplace listing becomes visible to
 * guests only once moderation has decided on it: `marketplace_public` filters on
 * an approved `moderation_decision`, so a row sitting at `status='pending_review'`
 * with `moderation_decision IS NULL` is invisible to every logged-out visitor.
 * That is correct while moderation is IN FLIGHT and catastrophic once it has
 * stalled -- if `moderate-listing` never completes (function error, timeout,
 * quota, a bad deploy), the listing stays invisible FOREVER and absolutely
 * nothing reports it. The seller sees their listing in their own account and
 * assumes it is live. This is the silent half of the 2026-08-05 guest-feed bug:
 * the visible half (seeded demo listings never approved) was found by a human
 * looking at an empty feed, which is not a monitoring strategy.
 *
 * WHY A TIME THRESHOLD RATHER THAN A COUNT. Pending listings are NORMAL; a
 * nonzero queue is healthy. What is never normal is a listing pending for longer
 * than moderation could plausibly take. 24h is deliberately far above the real
 * latency (moderation is inline on create) so this alerts on a STALL, not on a
 * busy afternoon -- an alert that fires during normal operation gets muted, and a
 * muted alert is the same as no alert.
 *
 * Exit codes: 0 = clean (or a real, reported error state handled by the caller).
 * Prints a JSON summary on stdout for the workflow to act on.
 *
 * Usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/check-stuck-moderation.mjs
 */

const URL_BASE = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HOURS = Number(process.env.STUCK_HOURS || 24);

if (!URL_BASE || !KEY) {
  // FAIL LOUD, NEVER SILENT-GREEN. A monitor that cannot reach the database has
  // not observed "no stuck listings" -- it has observed nothing. Reporting clean
  // here would be the exact defect this monitor exists to catch, one level up.
  console.error('✗ stuck-moderation monitor: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — cannot observe anything.');
  console.error('  This is NOT a pass. Wire the secrets or the monitor is decorative.');
  process.exit(2);
}

const cutoff = new Date(Date.now() - HOURS * 3600 * 1000).toISOString();

const params = new URLSearchParams({
  select: 'id,title,university_id,created_at,status,moderation_decision',
  status: 'eq.pending_review',
  moderation_decision: 'is.null',
  created_at: `lt.${cutoff}`,
  order: 'created_at.asc',
  limit: '50',
});

let rows;
try {
  const res = await fetch(`${URL_BASE}/rest/v1/marketplace_listings?${params}`, {
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      Prefer: 'count=exact',
    },
  });
  if (!res.ok) {
    console.error(`✗ stuck-moderation monitor: query failed (HTTP ${res.status}) — ${(await res.text()).slice(0, 300)}`);
    process.exit(2);
  }
  rows = await res.json();
} catch (err) {
  console.error(`✗ stuck-moderation monitor: query threw — ${err.message}`);
  process.exit(2);
}

const summary = {
  stuck: rows.length,
  thresholdHours: HOURS,
  oldest: rows[0]?.created_at ?? null,
  ids: rows.map((r) => r.id),
};

if (rows.length === 0) {
  console.log(`✓ stuck-moderation monitor: no listing has been pending_review with a NULL decision for more than ${HOURS}h.`);
  console.log(JSON.stringify({ ...summary, ok: true }));
  process.exit(0);
}

console.error(`✗ stuck-moderation monitor: ${rows.length} listing(s) stuck in pending_review with NO moderation decision for >${HOURS}h.`);
console.error('  These are INVISIBLE TO GUESTS and will stay that way until moderation completes.');
for (const r of rows.slice(0, 20)) {
  console.error(`  · ${r.id}  created ${r.created_at}  university=${r.university_id ?? 'none'}`);
}
if (rows.length > 20) console.error(`  …and ${rows.length - 20} more (query capped at 50).`);
console.log(JSON.stringify({ ...summary, ok: false }));
process.exit(1);
