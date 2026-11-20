-- Re-audit of the 2026-08-02 dismissals (docs/security/reaudit-2026-08-06.md).
--
-- Four findings survived re-examination under the evidence standard the 08-02
-- close-out itself established. Each was reproduced against the local stack
-- before this migration was written; the probe is
-- supabase/tests/reaudit_dismissal_survivors.test.sql.
--
-- R1 — helper reuse, by VERB. The 08-02 flip narrowed ranking_collaborations
--      DELETE from get_my_all_group_ids() (which deliberately INCLUDES pending
--      invites) to get_my_accepted_group_ids(). It stopped at DELETE. Both
--      UPDATE policies were left on the permissive helper, so a never-accepted
--      invitee could rewrite the group — including setting owner_id to
--      themselves, which hands them every owner policy and re-opens the DELETE
--      that was just closed. Reproduced: group_name -> 'HIJACKED', then
--      owner_id -> attacker, both from a 'pending' membership row.
--
-- R2 — trap 2, on the membership table itself. "Users can accept their own
--      invites" is USING (user_id = auth.uid()) WITH CHECK (user_id =
--      auth.uid()). It names ONE column. Nothing freezes group_id, so any user
--      holding any membership row (every group owner holds one) could move that
--      row into another group in their tenant and set status='accepted'. That
--      makes get_my_accepted_group_ids() return the victim's group, which is
--      the input to the R1 fix, to group_dorm_rankings, to checklist_items, to
--      checklist_share_links, and to the DELETE policy. Reproduced end to end:
--      an outsider deleted a group they were never invited to.
--
-- R3 — a value gate written for INSERT and never carried to UPDATE.
--      force_insert_pre_moderation() refuses a client-supplied
--      moderation_decision at INSERT, and its own comment explains why: "the
--      INSERT policy's WITH CHECK only asserts ownership." The UPDATE policy's
--      WITH CHECK asserts exactly the same thing, and no trigger covered the
--      UPDATE side. guard_listing_status_change() is BEFORE UPDATE OF status,
--      so it never fires for a write that touches only the moderation columns.
--      Reproduced: the owner of a listing the scanner had HELD set
--      moderation_decision='approved' and the row left the
--      admin_list_held_listings() queue predicate while still status
--      'under_review' — prohibited content that no moderator will ever see.
--
-- R4 — trap 4, the third twin. private.marketplace_public executes as owner and
--      bypasses RLS, and unlike marketplace_listings_contact,
--      roommate_search_posts_contact and seller_rating_stats it carries no
--      tenant predicate at all. Cross-ACTIVE-school reads are a recorded
--      decision (2026-08-01, in the view's own COMMENT) and are NOT changed
--      here. What that decision does not cover is a university with
--      is_active = false: a school that has not launched, whose students'
--      listings are nonetheless published to the open internet, with the only
--      school filter being a client-side .eq() in fetchGuestMarketplaceListings.
--      Reproduced: anon read 2/2 seeded listings across 2 schools, one inactive.
--
-- Deliberately NOT keyed on session_user. protect_profile_role(),
-- protect_profile_is_admin() and protect_listing_verified_at() all exempt
-- session_user IN ('postgres','supabase_admin'), which makes them invisible to
-- every probe in supabase/tests/ (those assume a role with set_config('role',
-- ...), which changes current_user and leaves session_user = postgres). Those
-- three guards are real — verified through PostgREST, where all three writes
-- are refused — but a probe asserting them would pass while asserting nothing.
-- The triggers below gate on auth.uid()/auth.role() only, so the harness can
-- actually exercise them.

-- ---------------------------------------------------------------------------
-- R1. ranking_collaborations: accepted members only, and freeze row identity.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Members can update group details" ON public.ranking_collaborations;
CREATE POLICY "Members can update group details"
  ON public.ranking_collaborations
  FOR UPDATE
  TO authenticated
  USING (id IN (SELECT get_my_accepted_group_ids()))
  WITH CHECK (id IN (SELECT get_my_accepted_group_ids()));

DROP POLICY IF EXISTS "Members can update group status" ON public.ranking_collaborations;
CREATE POLICY "Members can update group status"
  ON public.ranking_collaborations
  FOR UPDATE
  TO authenticated
  USING (
    id IN (SELECT get_my_accepted_group_ids())
    OR owner_id = (SELECT auth.uid())
  )
  WITH CHECK (
    id IN (SELECT get_my_accepted_group_ids())
    OR owner_id = (SELECT auth.uid())
  );

-- A policy cannot reference OLD, so ownership is frozen by trigger — the same
-- shape and the same reason as protect_seller_rating_target (08-02): a trigger
-- survives a future policy rewrite, and the advisor-autofix job rewrites
-- policies autonomously.
CREATE OR REPLACE FUNCTION public.protect_ranking_collaboration_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Internal contexts: signup/seed/migration (no JWT) and the service role.
  IF auth.uid() IS NULL OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- The owner may hand the group over deliberately; nobody else may take it.
  IF OLD.owner_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    NEW.owner_id := OLD.owner_id;
  END IF;

  -- Tenant and creation time are never client-writable. Restoring OLD rather
  -- than raising keeps benign member edits (group_name, status) working.
  NEW.university_id := OLD.university_id;
  NEW.created_at    := OLD.created_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_ranking_collaboration_identity ON public.ranking_collaborations;
CREATE TRIGGER protect_ranking_collaboration_identity
  BEFORE UPDATE ON public.ranking_collaborations
  FOR EACH ROW EXECUTE FUNCTION public.protect_ranking_collaboration_identity();

-- ---------------------------------------------------------------------------
-- R2. ranking_group_members: a membership row cannot change which group it is
--     a membership of. Accepting an invite (status) stays a self-service write.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_group_membership_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Which group a membership row belongs to, and whose it is, are never
  -- client-writable — not even by a group owner. An owner adding or removing
  -- somebody INSERTs or DELETEs; there is no legitimate write that moves an
  -- existing row between groups, and allowing one is the whole exploit (the
  -- first cut of this trigger exempted the owner of OLD.group_id, which let an
  -- attacker relocate the row out of the group they owned — caught by this
  -- file's own R2 assertion before the migration shipped).
  NEW.group_id := OLD.group_id;
  NEW.user_id  := OLD.user_id;

  -- The owner of the group manages the roster and may change a member's role;
  -- the member themselves may only move `status`, which is the accept/decline
  -- flow the policy was written for.
  IF NOT EXISTS (
    SELECT 1 FROM public.ranking_collaborations rc
     WHERE rc.id = OLD.group_id AND rc.owner_id = v_uid
  ) THEN
    NEW.role := OLD.role;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_group_membership_identity ON public.ranking_group_members;
CREATE TRIGGER protect_group_membership_identity
  BEFORE UPDATE ON public.ranking_group_members
  FOR EACH ROW EXECUTE FUNCTION public.protect_group_membership_identity();

-- ---------------------------------------------------------------------------
-- R3. marketplace_listings: moderation state is not client-writable on UPDATE,
--     for the same reason it is not client-writable on INSERT.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_listing_moderation_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Same exemption shape as force_insert_pre_moderation(): only end-user
  -- requests are gated. service_role (the moderate-listing edge function),
  -- postgres/seed contexts (auth.role() is not 'authenticated') and admins keep
  -- full control.
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR EXISTS (
       SELECT 1 FROM public.profiles
        WHERE id = (SELECT auth.uid()) AND is_admin = true
     ) THEN
    RETURN NEW;
  END IF;

  NEW.moderation_decision   := OLD.moderation_decision;
  NEW.moderation_reason     := OLD.moderation_reason;
  NEW.moderation_categories := OLD.moderation_categories;
  NEW.moderated_at          := OLD.moderated_at;
  NEW.moderation_started_at := OLD.moderation_started_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_listing_moderation_state ON public.marketplace_listings;
CREATE TRIGGER protect_listing_moderation_state
  BEFORE UPDATE ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.protect_listing_moderation_state();

-- ---------------------------------------------------------------------------
-- R4. private.marketplace_public: publish live schools only.
--
-- CREATE OR REPLACE cannot add a WHERE clause without re-listing the whole
-- projection, and 20260910000000 already documents that a full re-create is the
-- only safe edit here (a partial one silently reverts the hardening). Both
-- column lists are carried forward VERBATIM from that migration; the single
-- change is the trailing is_active predicate.
-- ---------------------------------------------------------------------------

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
  nullif(btrim((regexp_split_to_array(btrim(p.full_name), '\s+'))[1], ' ,.-'), '') AS seller_name,
  COALESCE(
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
  AND l.moderation_decision = 'approved'
  -- Added 2026-08-06 (re-audit R4). "Cross-school by design" is a decision about
  -- LIVE schools; it was never a decision to publish a school that has not
  -- launched. A NULL university_id is excluded for the same reason: it cannot be
  -- shown to belong to a live tenant.
  AND EXISTS (
    SELECT 1 FROM public.universities un
     WHERE un.id = l.university_id AND un.is_active
  );

GRANT SELECT ON private.marketplace_public TO anon, authenticated;

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
  'Guest-readable, approved-only (fail-closed), PII-free projection of marketplace_listings (App Store 5.1.1(v)). Covers items and service posts. No user_id join key; meetup_location and service_location are room-number-stripped; contact columns excluded with show_* pinned false. Cross-school among ACTIVE schools by design (decision 2026-08-01) - the client school filter is UX, not a boundary - but an inactive/pre-launch school is never published (re-audit 2026-08-06). New columns must be added to both column lists deliberately.';

COMMENT ON FUNCTION public.protect_ranking_collaboration_identity() IS
  'Freezes owner_id (except a deliberate handover by the current owner), university_id and created_at on ranking_collaborations. A policy cannot reference OLD; re-audit 2026-08-06 R1.';
COMMENT ON FUNCTION public.protect_group_membership_identity() IS
  'Freezes group_id/user_id/role on ranking_group_members for anyone but the group owner, so a membership row cannot be relocated into another group. Re-audit 2026-08-06 R2.';
COMMENT ON FUNCTION public.protect_listing_moderation_state() IS
  'Freezes the marketplace_listings moderation columns on UPDATE for non-admin authenticated callers, mirroring force_insert_pre_moderation() on the INSERT side. Re-audit 2026-08-06 R3.';
