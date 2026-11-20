-- Student services on marketplace_listings: `request_help` / `offer_help`.
--
-- WHY THE DISCRIMINATOR IS A COLUMN ON THIS TABLE, NOT A NEW TABLE
-- ---------------------------------------------------------------
-- Everything that makes a post safe is already wired to marketplace_listings:
-- the pre-publish moderation hold (trg_force_insert_pre_moderation), the
-- omni-scan verdict columns, content_reports.chk_content_type's
-- 'marketplace_listing', auto_hide_reported_listing(), the admin Reports queue,
-- the tenant RLS on university_id, and the guest projection
-- public.marketplace_public. A `service_posts` table would inherit exactly none
-- of it and would have to re-implement all six, which is where the holes get
-- cut. So services are rows here.
--
-- WHY `post_type text`, NOT another boolean and NOT an enum
-- --------------------------------------------------------
-- The table already carries one boolean discriminator, `is_sublease`, and the
-- PRD lands four types (item, sublease, request_help, offer_help). N booleans
-- encode 2^N states of which N are legal, so every reader has to know the
-- illegal combinations — that is how a row ends up both a sublease and a ride
-- request. One `post_type` column makes the states mutually exclusive by
-- construction and matches src/lib/postTypes.ts, which is already the registry
-- the create flow and the feed branch off.
-- `text` + CHECK rather than a Postgres enum because this repo's expand/contract
-- rule wants a fifth type to be a one-line CHECK re-assert (see the status
-- section below) rather than an ALTER TYPE, which cannot run in a transaction
-- with other DDL and cannot drop a value at all.
-- `is_sublease` stays and is kept in sync by trigger — expand-only; older
-- readers (the guest view, roommate cross-links) keep working untouched.
--
-- NO PAYMENTS. `price` is NOT NULL on a live table, so a service post writes 0
-- and a CHECK holds it there. There is no rate, balance or amount-owed column
-- here, and the display layer hides the price field for service types. Nothing
-- in DormCheck tracks a debt between students.

-- ---------------------------------------------------------------------------
-- 1. The discriminator
-- ---------------------------------------------------------------------------
ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS post_type text NOT NULL DEFAULT 'item';

ALTER TABLE public.marketplace_listings
  DROP CONSTRAINT IF EXISTS marketplace_listings_post_type_check;
ALTER TABLE public.marketplace_listings
  ADD CONSTRAINT marketplace_listings_post_type_check
  CHECK (post_type = ANY (ARRAY[
    'item'::text, 'sublease'::text, 'request_help'::text, 'offer_help'::text
  ]));

-- Backfill from the boolean this column supersedes.
UPDATE public.marketplace_listings
   SET post_type = 'sublease'
 WHERE is_sublease IS TRUE AND post_type <> 'sublease';

-- Keep the two in lockstep so no reader has to know which one is authoritative.
-- On INSERT a caller that only knows the old boolean (post_type left at its
-- 'item' default) still lands as a sublease; after that, post_type wins.
CREATE OR REPLACE FUNCTION public.sync_listing_post_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.post_type = 'item' AND NEW.is_sublease IS TRUE THEN
    NEW.post_type := 'sublease';
  END IF;
  NEW.is_sublease := (NEW.post_type = 'sublease');
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_listing_post_type() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_listing_post_type ON public.marketplace_listings;
CREATE TRIGGER trg_sync_listing_post_type
  BEFORE INSERT OR UPDATE OF post_type, is_sublease ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.sync_listing_post_type();

CREATE INDEX IF NOT EXISTS idx_marketplace_listings_post_type_created
  ON public.marketplace_listings (university_id, post_type, created_at DESC);

COMMENT ON COLUMN public.marketplace_listings.post_type IS
  'Post-type discriminator (item|sublease|request_help|offer_help). Mirrors src/lib/postTypes.ts. is_sublease is a derived legacy mirror kept in sync by trg_sync_listing_post_type.';

-- ---------------------------------------------------------------------------
-- 2. Structured service fields
-- ---------------------------------------------------------------------------
ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS service_category text,
  ADD COLUMN IF NOT EXISTS service_date date,
  ADD COLUMN IF NOT EXISTS service_duration_minutes integer,
  ADD COLUMN IF NOT EXISTS service_location text,
  ADD COLUMN IF NOT EXISTS service_notes text;

ALTER TABLE public.marketplace_listings
  DROP CONSTRAINT IF EXISTS marketplace_listings_service_category_check;
ALTER TABLE public.marketplace_listings
  ADD CONSTRAINT marketplace_listings_service_category_check
  CHECK (service_category IS NULL OR service_category = ANY (ARRAY[
    'moving'::text, 'storage'::text, 'ride'::text, 'tutoring'::text, 'other'::text
  ]));

ALTER TABLE public.marketplace_listings
  DROP CONSTRAINT IF EXISTS marketplace_listings_service_duration_check;
ALTER TABLE public.marketplace_listings
  ADD CONSTRAINT marketplace_listings_service_duration_check
  CHECK (service_duration_minutes IS NULL
         OR (service_duration_minutes > 0 AND service_duration_minutes <= 10080));

ALTER TABLE public.marketplace_listings
  DROP CONSTRAINT IF EXISTS marketplace_listings_service_notes_check;
ALTER TABLE public.marketplace_listings
  ADD CONSTRAINT marketplace_listings_service_notes_check
  CHECK (service_notes IS NULL OR char_length(service_notes) <= 500);

-- Shape gate: a service post carries a category, and a non-service post carries
-- no service fields at all. Without this the columns drift into a soft schema.
ALTER TABLE public.marketplace_listings
  DROP CONSTRAINT IF EXISTS marketplace_listings_service_shape_check;
ALTER TABLE public.marketplace_listings
  ADD CONSTRAINT marketplace_listings_service_shape_check
  CHECK (
    CASE
      WHEN post_type IN ('request_help', 'offer_help')
        THEN service_category IS NOT NULL
      ELSE service_category IS NULL
           AND service_date IS NULL
           AND service_duration_minutes IS NULL
           AND service_location IS NULL
           AND service_notes IS NULL
    END
  );

-- NO PAYMENTS, enforced in the DB. `price` cannot be dropped to NULLable on a
-- live table, so a service post pins it at 0. There is deliberately no rate,
-- deposit or balance column: DormCheck never tracks money owed between students.
ALTER TABLE public.marketplace_listings
  DROP CONSTRAINT IF EXISTS marketplace_listings_service_price_zero_check;
ALTER TABLE public.marketplace_listings
  ADD CONSTRAINT marketplace_listings_service_price_zero_check
  CHECK (post_type NOT IN ('request_help', 'offer_help') OR price = 0);

-- ---------------------------------------------------------------------------
-- 3. Claim / completion columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS claimed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_marketplace_listings_claimed_by
  ON public.marketplace_listings (claimed_by)
  WHERE claimed_by IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Status: RE-ASSERT THE FULL VALUE SET IN ONE PLACE
-- ---------------------------------------------------------------------------
-- READ BEFORE EDITING. marketplace_listings_status_check has been dropped and
-- re-added seven times, and 20260731030000_marketplace_status_pending silently
-- deleted 'pending_review' by re-adding a set that predated it — a bug that
-- took 20260817000000 to repair. A DROP/re-ADD is a full replacement, never an
-- addition. Any future migration touching this constraint MUST restate every
-- value below plus its own, in one statement, and must be dated after every
-- prior one so filename-order replay (supabase db reset / CI) lands the union.
--
-- Union as of this migration:
--   moderation, all types : pending_review, under_review, expired
--   item + sublease       : available, pending, sold
--   service               : open, claimed, completed
ALTER TABLE public.marketplace_listings
  DROP CONSTRAINT IF EXISTS marketplace_listings_status_check;
ALTER TABLE public.marketplace_listings
  ADD CONSTRAINT marketplace_listings_status_check
  CHECK (status = ANY (ARRAY[
    'available'::text, 'pending'::text, 'sold'::text,
    'under_review'::text, 'expired'::text, 'pending_review'::text,
    'open'::text, 'claimed'::text, 'completed'::text
  ]));

-- A service post can never be 'sold' and an item can never be 'claimed'. This
-- is what keeps the two lifecycles from bleeding into each other's queries.
ALTER TABLE public.marketplace_listings
  DROP CONSTRAINT IF EXISTS marketplace_listings_status_by_post_type_check;
ALTER TABLE public.marketplace_listings
  ADD CONSTRAINT marketplace_listings_status_by_post_type_check
  CHECK (
    CASE
      WHEN post_type IN ('request_help', 'offer_help')
        THEN status = ANY (ARRAY[
          'pending_review'::text, 'under_review'::text, 'expired'::text,
          'open'::text, 'claimed'::text, 'completed'::text
        ])
      ELSE status = ANY (ARRAY[
        'pending_review'::text, 'under_review'::text, 'expired'::text,
        'available'::text, 'pending'::text, 'sold'::text
      ])
    END
  );

-- Claim bookkeeping must match the status, in both directions.
ALTER TABLE public.marketplace_listings
  DROP CONSTRAINT IF EXISTS marketplace_listings_claim_shape_check;
ALTER TABLE public.marketplace_listings
  ADD CONSTRAINT marketplace_listings_claim_shape_check
  CHECK (
    (claimed_by IS NULL) = (claimed_at IS NULL)
    AND (status NOT IN ('claimed', 'completed') OR claimed_by IS NOT NULL)
    AND (status = 'completed') = (completed_at IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- 5. Lifecycle RPCs (open -> claimed -> completed)
-- ---------------------------------------------------------------------------
-- rls_marketplace_listings_update is own-or-admin, and RLS cannot restrict
-- WHICH columns an UPDATE touches — widening it so a claimer could write the
-- row would hand every peer the title, price and contact columns too. So the
-- two transitions a non-owner may drive are SECURITY DEFINER functions with an
-- explicit column list, and the UPDATE policy is left exactly as it is.

CREATE OR REPLACE FUNCTION public.claim_service_post(p_listing_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.marketplace_listings%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to claim a post.' USING errcode = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_row
    FROM public.marketplace_listings
   WHERE id = p_listing_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post not found.' USING errcode = 'no_data_found';
  END IF;
  IF v_row.post_type NOT IN ('request_help', 'offer_help') THEN
    RAISE EXCEPTION 'Only service posts can be claimed.' USING errcode = 'check_violation';
  END IF;
  IF v_row.status <> 'open' THEN
    RAISE EXCEPTION 'This post is no longer open.' USING errcode = 'check_violation';
  END IF;
  IF v_row.user_id = v_uid THEN
    RAISE EXCEPTION 'You cannot claim your own post.' USING errcode = 'check_violation';
  END IF;
  -- Tenant boundary, restated here because SECURITY DEFINER bypasses RLS.
  IF v_row.university_id IS DISTINCT FROM (
       SELECT university_id FROM public.profiles WHERE id = v_uid
     ) THEN
    RAISE EXCEPTION 'Post not found.' USING errcode = 'no_data_found';
  END IF;
  IF public.is_blocked_between(v_uid, v_row.user_id) THEN
    RAISE EXCEPTION 'Post not found.' USING errcode = 'no_data_found';
  END IF;

  UPDATE public.marketplace_listings
     SET status = 'claimed', claimed_by = v_uid, claimed_at = now()
   WHERE id = p_listing_id;

  RETURN p_listing_id;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_service_post(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_service_post(uuid) TO authenticated;
COMMENT ON FUNCTION public.claim_service_post(uuid) IS
  'Claim an open service post (open -> claimed). Same-university non-owner only. Writes status/claimed_by/claimed_at and nothing else.';

CREATE OR REPLACE FUNCTION public.complete_service_post(p_listing_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.marketplace_listings%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to complete a post.' USING errcode = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_row
    FROM public.marketplace_listings
   WHERE id = p_listing_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post not found.' USING errcode = 'no_data_found';
  END IF;
  IF v_row.status <> 'claimed' THEN
    RAISE EXCEPTION 'Only a claimed post can be completed.' USING errcode = 'check_violation';
  END IF;
  -- Either side may close it out; both were present for the handoff.
  IF v_uid NOT IN (v_row.user_id, v_row.claimed_by) THEN
    RAISE EXCEPTION 'Post not found.' USING errcode = 'no_data_found';
  END IF;

  UPDATE public.marketplace_listings
     SET status = 'completed', completed_at = now()
   WHERE id = p_listing_id;

  RETURN p_listing_id;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_service_post(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.complete_service_post(uuid) TO authenticated;
COMMENT ON FUNCTION public.complete_service_post(uuid) IS
  'Close out a claimed service post (claimed -> completed). Poster or claimer only. Writes status/completed_at and nothing else.';

-- ---------------------------------------------------------------------------
-- 6. Reputation: reuse seller_rating_stats, do not build a second one
-- ---------------------------------------------------------------------------
-- Completion reputation is the EXISTING seller_ratings table and the EXISTING
-- seller_rating_stats view (20260704054447) — no service-specific rating table,
-- no second aggregate. The only gap was the eligibility gate: inserts required
-- an accepted DM thread between the pair, so a claim arranged outside DMs left
-- a completed job unratable. Add the completed-post pair as a second way to
-- earn the same right; everything downstream (the view, the UI hook
-- src/hooks/useSellerRatings.ts, the 'seller_rating' report type) is untouched.
CREATE OR REPLACE FUNCTION public.has_completed_service_between(u1 uuid, u2 uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.marketplace_listings l
    WHERE l.status = 'completed'
      AND l.post_type IN ('request_help', 'offer_help')
      AND ((l.user_id = u1 AND l.claimed_by = u2)
        OR (l.user_id = u2 AND l.claimed_by = u1))
  );
$$;
REVOKE ALL ON FUNCTION public.has_completed_service_between(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_completed_service_between(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS rls_seller_ratings_insert ON public.seller_ratings;
CREATE POLICY rls_seller_ratings_insert ON public.seller_ratings
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = rater_id
    AND (
      public.has_accepted_conversation_between(rater_id, seller_id)
      OR public.has_completed_service_between(rater_id, seller_id)
    )
    AND NOT public.is_blocked_between(rater_id, seller_id)
  );

-- ---------------------------------------------------------------------------
-- 7. Guest projection inherits service posts
-- ---------------------------------------------------------------------------
-- Rebuilt from 20260830050000_marketplace_guest_view_harden.sql — NOT from the
-- original 20260829000000. That hardening pass removed the user_id join key,
-- room-number-strips meetup_location, made the moderation filter FAIL CLOSED
-- (`= 'approved'`, not `coalesce(...) = 'approved'`) and pinned an explicit
-- column list on the public wrapper. Recreating the view from the older
-- definition silently reverts all four; supabase/tests/marketplace_guest_view_harden.test.sql
-- catches it, and did.
--
-- Three deliberate changes on top of the hardened definition:
--   * the approved-status set gains 'open'/'claimed' (a service post's live states),
--   * `is_sublease = false` becomes the equivalent post_type predicate,
--   * post_type + the service columns are projected — on BOTH column lists, per
--     that migration's rule that a new column never auto-publishes.
-- No contact column is added, and price stays projected because a service post's
-- price is 0.
DROP VIEW IF EXISTS public.marketplace_public;
DROP VIEW IF EXISTS private.marketplace_public;

CREATE VIEW private.marketplace_public
WITH (security_barrier = true) AS
SELECT
  l.id,
  l.university_id,
  l.title,
  l.description,
  l.price,
  l.original_price,
  l.category,
  l.condition,
  l.image_urls,
  -- Anon-path sanitization (20260830050000): strip keyworded room tokens, then
  -- any remaining digit runs, then collapse the leftover whitespace/punctuation.
  nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(l.meetup_location,
            '(room|rm\.?|apt\.?|suite|unit|floor|fl\.?|#)\s*[0-9]+[a-z]?', ' ', 'gi'),
          '[0-9]+(st|nd|rd|th)?[a-z]?', ' ', 'gi'),
        '\s+', ' ', 'g'),
      ' ,-'),
    ''
  ) AS meetup_location,
  l.price_negotiable,
  l.payment_methods,
  l.status,
  l.verified_at,
  l.created_at,
  l.post_type,
  l.service_category,
  l.service_date,
  l.service_duration_minutes,
  -- Same sanitization as meetup_location: service_location is the anon-visible
  -- "where", so it must not carry a room number either.
  nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(l.service_location,
            '(room|rm\.?|apt\.?|suite|unit|floor|fl\.?|#)\s*[0-9]+[a-z]?', ' ', 'gi'),
          '[0-9]+(st|nd|rd|th)?[a-z]?', ' ', 'gi'),
        '\s+', ' ', 'g'),
      ' ,-'),
    ''
  ) AS service_location,
  l.service_notes,
  false AS show_instagram,
  false AS show_snapchat,
  false AS show_phone,
  -- FIRST NAME ONLY, here too (BA-08, 2026-09-06). This file used to project
  -- `p.full_name AS seller_name` and rely on 20260911000000 sorting after it to
  -- take the surname back off the anonymous feed — a pairing that lived only in
  -- a comment. Prod applied both as ONE transaction; nothing stopped a future
  -- selective apply from re-publishing surnames between the two. Now this file
  -- never emits the leaking projection at all (identical expression to
  -- 20260911000000, which re-asserts it), and the DO block at the end refuses
  -- to commit if this view ever carries full_name again.
  nullif(btrim((regexp_split_to_array(btrim(p.full_name), '\s+'))[1], ' ,.-'), '')
    AS seller_name,
  coalesce(
    (
      SELECT jsonb_agg(
               jsonb_build_object(
                 'id', i.id,
                 'listing_id', i.listing_id,
                 'name', i.name,
                 'price', i.price,
                 'status', i.status,
                 'x', i.x,
                 'y', i.y,
                 'photo_index', i.photo_index
               )
               ORDER BY i.photo_index NULLS LAST, i.id
             )
      FROM public.marketplace_listing_items i
      WHERE i.listing_id = l.id
    ),
    '[]'::jsonb
  ) AS items
FROM public.marketplace_listings l
LEFT JOIN public.profiles_public p ON p.id = l.user_id
WHERE l.status IN ('available', 'pending', 'open', 'claimed')
  AND l.post_type <> 'sublease'
  AND l.moderation_decision = 'approved';

GRANT SELECT ON private.marketplace_public TO anon, authenticated;

-- Explicit column list — a new base/private column never auto-publishes.
CREATE VIEW public.marketplace_public
WITH (security_invoker = true, security_barrier = true) AS
SELECT
  id,
  university_id,
  title,
  description,
  price,
  original_price,
  category,
  condition,
  image_urls,
  meetup_location,
  price_negotiable,
  payment_methods,
  status,
  verified_at,
  created_at,
  post_type,
  service_category,
  service_date,
  service_duration_minutes,
  service_location,
  service_notes,
  show_instagram,
  show_snapchat,
  show_phone,
  seller_name,
  items
FROM private.marketplace_public;

GRANT SELECT ON public.marketplace_public TO anon, authenticated;

COMMENT ON VIEW public.marketplace_public IS
  'Guest-readable, approved-only (fail-closed), PII-free projection of marketplace_listings (App Store 5.1.1(v)). Covers items and service posts. No user_id join key; meetup_location and service_location are room-number-stripped; contact columns excluded with show_* pinned false. Cross-school by design (decision 2026-08-01) - the client school filter is UX, not a boundary. New columns must be added to both column lists deliberately.';

-- ---------------------------------------------------------------------------
-- 8. Column grants for the new columns (this repo's grants are per-column)
-- ---------------------------------------------------------------------------
GRANT SELECT (post_type, service_category, service_date, service_duration_minutes,
              service_location, service_notes, claimed_by, claimed_at, completed_at)
  ON public.marketplace_listings TO authenticated;
GRANT INSERT (post_type, service_category, service_date, service_duration_minutes,
              service_location, service_notes)
  ON public.marketplace_listings TO authenticated;
GRANT UPDATE (post_type, service_category, service_date, service_duration_minutes,
              service_location, service_notes)
  ON public.marketplace_listings TO authenticated;

-- ───────────────────────── self-check (BA-08) ─────────────────────────
-- This file is applied inside one transaction, so a RAISE here rolls the whole
-- migration back: it can no longer be applied in a state that publishes surnames
-- to anonymous visitors, with or without 20260911000000 behind it.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_viewdef('private.marketplace_public'::regclass, true) INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION '20260910000000: private.marketplace_public is missing';
  END IF;
  IF v_def ~* 'full_name\s+AS\s+seller_name' THEN
    RAISE EXCEPTION '20260910000000: private.marketplace_public projects full_name as seller_name (surname leak, #144/#155). Apply refused.';
  END IF;
END $$;
