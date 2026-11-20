-- P3-D step 1 (guest exposure review 2026-08-01): backfill legacy NULL
-- moderation_decision values BEFORE the guest view's predicate tightens from
-- coalesce(moderation_decision,'approved') to moderation_decision='approved'
-- (20260830050000). The coalesce fails OPEN — the same class of bug as P0-1 —
-- but simply tightening it would silently drop legitimate legacy listings from
-- the guest feed, so this runs first.
--
-- Classification rule (fail closed on doubt):
--   * APPROVED: moderation_decision IS NULL, created BEFORE pre-moderation
--     shipped (20260719150000), and status is NOT a review-hold state. These
--     rows were live-by-approval: guard_listing_status_change() did not exist
--     yet, and every visible listing had passed the then-current manual bar.
--   * HELD (left NULL, i.e. invisible to guests once 20260830050000 lands):
--     any NULL-decision row created AFTER the pre-moderation cutoff. A
--     post-cutoff row in 'available'/'pending' with no decision should be
--     impossible (the omni-moderation scan stamps a decision) — if any exist
--     they are exactly the P0-1 bypass artifacts and must NOT be blanket-
--     approved. They are counted and reported, not touched.
--
-- The cutoff is the pre-moderation migration's own date. Rows are only ever
-- moved NULL → 'approved'; no existing decision is rewritten.

DO $$
DECLARE
  n_null_before  bigint;
  n_backfilled   bigint;
  n_held         bigint;
BEGIN
  SELECT count(*) INTO n_null_before
    FROM public.marketplace_listings WHERE moderation_decision IS NULL;

  UPDATE public.marketplace_listings
     SET moderation_decision = 'approved',
         moderated_at = coalesce(moderated_at, now())
   WHERE moderation_decision IS NULL
     AND created_at < '2026-07-20T00:00:00Z'
     AND status NOT IN ('pending_review', 'under_review');
  GET DIAGNOSTICS n_backfilled = ROW_COUNT;

  SELECT count(*) INTO n_held
    FROM public.marketplace_listings WHERE moderation_decision IS NULL;

  RAISE NOTICE 'moderation_decision backfill: % NULL before, % backfilled to approved, % held as NULL (fail closed)',
    n_null_before, n_backfilled, n_held;
END $$;
