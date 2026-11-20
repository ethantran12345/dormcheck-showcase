-- Student services, release shape: a fixed category vocabulary with a LOCAL /
-- REMOTE scope, one active offer per provider, and a post-approval edit limit.
--
-- WHY THIS EXTENDS marketplace_listings RATHER THAN ADDING TABLES: the service
-- surface already exists (20260910000000_marketplace_service_posts.sql). It has
-- the open -> claimed -> completed lifecycle, the pre-moderation gate every
-- listing goes through, the report path, the guest projection, and a review
-- eligibility rule that is already enforced in the DATABASE
-- (has_completed_service_between() inside rls_seller_ratings_insert). A parallel
-- service_listings / service_requests / service_reviews trio would duplicate all
-- five and give the moderation queue two shapes to reason about. Decision:
-- docs/DECISIONS.md, 2026-08-16.
--
-- THE INVARIANT, stated once: a service category is one of NINE literals, and
-- each is either LOCAL (visible to anyone your marketplace group reaches) or
-- REMOTE (visible across schools, and OFF until both schools opt in). There is
-- no free-text category and no catch-all, because the absence of a value is the
-- only control that cannot be talked around: no license-gated trade (nails,
-- hair, massage, anything medical) and no food category can be posted, since
-- there is nothing to post them as.
--
-- STILL NO PAYMENTS. This migration adds no rate, price band, deposit or
-- amount-owed column, and marketplace_listings_service_price_zero_check is left
-- exactly as 20260910000000 wrote it.
--
-- Rollback (restores exact pre-migration behaviour):
--   DROP TRIGGER IF EXISTS trg_service_edit_rate_limit ON public.marketplace_listings;
--   DROP FUNCTION IF EXISTS public.enforce_service_edit_rate_limit();
--   DROP INDEX IF EXISTS public.marketplace_listings_user_one_active_service_offer;
--   ALTER TABLE public.marketplace_listings
--     DROP COLUMN service_edit_count, DROP COLUMN service_last_edit_at;
--   -- then re-run sections 3-6 of 20260918000000_shared_marketplace_group.sql
--   -- to drop the remote disjunct from the four widened policies, and
--   ALTER TABLE public.universities DROP COLUMN remote_services_open;
--   DROP FUNCTION IF EXISTS public.shares_remote_services(uuid),
--                           public.service_category_scope(text),
--                           public.service_completion_count(uuid);
--   ALTER TABLE public.marketplace_listings
--     DROP CONSTRAINT IF EXISTS marketplace_listings_service_category_check;
--   ALTER TABLE public.marketplace_listings
--     ADD CONSTRAINT marketplace_listings_service_category_check
--     CHECK (service_category IS NULL OR service_category = ANY (ARRAY[
--       'moving'::text, 'storage'::text, 'ride'::text, 'tutoring'::text, 'other'::text]));

-- ---------------------------------------------------------------------------
-- 1. Retire the placeholder vocabulary, in data, before the CHECK moves
-- ---------------------------------------------------------------------------
-- 20260910000000 shipped five provisional values. Three map exactly onto the
-- release set; 'storage' folds into move_help, which is the same "help me haul
-- and stash a thing" task under a name that says so. 'other' has NO target and
-- is deliberately not given one — a catch-all is what lets a license-gated or
-- food service be posted under a label nobody screens. If prod ever holds an
-- 'other' row this migration STOPS rather than silently refiling a student's
-- post; the operator re-categorises by hand and re-runs.
UPDATE public.marketplace_listings
   SET service_category = CASE service_category
                            WHEN 'moving'  THEN 'move_help'
                            WHEN 'storage' THEN 'move_help'
                            WHEN 'ride'    THEN 'rides'
                            ELSE service_category
                          END
 WHERE service_category IN ('moving', 'storage', 'ride');

DO $$
DECLARE
  v_stragglers integer;
BEGIN
  SELECT count(*) INTO v_stragglers
    FROM public.marketplace_listings
   WHERE service_category = 'other';

  IF v_stragglers > 0 THEN
    RAISE EXCEPTION
      '% listing(s) still carry service_category = ''other''. Re-categorise them '
      'into one of move_help, rides, tech_repair, printing, photography, '
      'tutoring, resume_review, design, editing before applying this migration.',
      v_stragglers;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. The category vocabulary — the full authorized set, as an equality
-- ---------------------------------------------------------------------------
-- Per .claude/rules/supabase-backend.md: a re-added CHECK restates the EXACT
-- authorized set, never the historical union. The five values from
-- 20260910000000 are gone on purpose and must not reappear here.
ALTER TABLE public.marketplace_listings
  DROP CONSTRAINT IF EXISTS marketplace_listings_service_category_check;
ALTER TABLE public.marketplace_listings
  ADD CONSTRAINT marketplace_listings_service_category_check
  CHECK (service_category IS NULL OR service_category = ANY (ARRAY[
    -- LOCAL: the student has to physically be there.
    'move_help'::text, 'rides'::text, 'tech_repair'::text,
    'printing'::text, 'photography'::text,
    -- REMOTE: deliverable over a link.
    'tutoring'::text, 'resume_review'::text, 'design'::text, 'editing'::text
  ]));

-- IMMUTABLE so it can sit in a policy qual (and, later, an index predicate)
-- without the planner treating it as opaque. Mirrors SERVICE_CATEGORY_SCOPE in
-- src/lib/postTypes.ts; src/test/postTypes.test.ts and
-- supabase/tests/service_categories_scope.test.sql pin the two together.
CREATE OR REPLACE FUNCTION public.service_category_scope(p_category text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE p_category
           WHEN 'move_help'     THEN 'local'
           WHEN 'rides'         THEN 'local'
           WHEN 'tech_repair'   THEN 'local'
           WHEN 'printing'      THEN 'local'
           WHEN 'photography'   THEN 'local'
           WHEN 'tutoring'      THEN 'remote'
           WHEN 'resume_review' THEN 'remote'
           WHEN 'design'        THEN 'remote'
           WHEN 'editing'       THEN 'remote'
         END
$$;

COMMENT ON FUNCTION public.service_category_scope(text) IS
  'local = the provider must be physically present, so reach is the marketplace '
  'group (geography). remote = deliverable over a link, so reach may cross '
  'schools — but only where both schools set universities.remote_services_open.';

REVOKE EXECUTE ON FUNCTION public.service_category_scope(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.service_category_scope(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Remote reach is OFF, and is data rather than code
-- ---------------------------------------------------------------------------
-- LEGAL GATE (verified 2026-08-16 against src/pages/marketing/Privacy.tsx §5 on
-- dev). The published policy permits exactly one cross-school disclosure:
-- "Verified students at partner schools IN YOUR AREA ... a shared LOCAL
-- marketplace". That sentence covers the marketplace_group mechanism and
-- therefore covers LOCAL categories at group range. It does NOT cover a
-- nationwide any-school surface, which is what REMOTE categories would be if
-- their reach were widened past the group. So the column ships DEFAULT false
-- and no row sets it: the machinery is complete and inert until Privacy §5 is
-- rewritten and re-noticed under Privacy §11.
ALTER TABLE public.universities
  ADD COLUMN IF NOT EXISTS remote_services_open boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.universities.remote_services_open IS
  'Opt-in to the cross-school REMOTE services surface (tutoring, resume_review, '
  'design, editing) beyond this school''s marketplace_group. false everywhere '
  'until Privacy §5 is widened past "partner schools in your area" — see '
  '20260924000000_service_categories_scope_and_limits.sql §3.';

-- SECURITY INVOKER, matching shares_marketplace() after 20260922000000: this
-- only reads public.universities, which authenticated users can already read.
CREATE OR REPLACE FUNCTION public.shares_remote_services(p_university_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
           SELECT 1
             FROM public.universities me, public.universities them
            WHERE me.id = public.current_university_id()
              AND them.id = p_university_id
              AND me.remote_services_open
              AND them.remote_services_open
         )
$$;

COMMENT ON FUNCTION public.shares_remote_services(uuid) IS
  'READ-side predicate for cross-school REMOTE services: true only when the '
  'caller''s school AND the target school have both opted in. Never use in a '
  'WITH CHECK — posting stays confined to the author''s own university.';

REVOKE EXECUTE ON FUNCTION public.shares_remote_services(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.shares_remote_services(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. The four policies the shared marketplace widened, widened once more
-- ---------------------------------------------------------------------------
-- Same shape and same rule as 20260918000000 §3-§6: the READ side grows a
-- disjunct, the WRITE side does not move. Every one of these is inert while
-- remote_services_open is false everywhere, which it is.

-- Listings: only a REMOTE-category service post travels past the group. An item,
-- a sublease, or a LOCAL service post keeps exactly the reach it has today.
-- The literal `current_university_id()` in the first disjunct is load-bearing:
-- supabase/tests/tenant_registry.test.sql asserts every class-A qual names it.
DROP POLICY IF EXISTS tenant_isolation ON public.marketplace_listings;
CREATE POLICY tenant_isolation ON public.marketplace_listings
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    university_id = public.current_university_id()
    OR public.shares_marketplace(university_id)
    OR (
      post_type IN ('request_help', 'offer_help')
      AND public.service_category_scope(service_category) = 'remote'
      AND public.shares_remote_services(university_id)
    )
    OR public.is_superadmin()
  )
  WITH CHECK (university_id = public.current_university_id() OR public.is_superadmin());

-- Ratings: a cross-school requester must be able to judge a provider, and the
-- provider must be able to accrue that reputation. INSERT eligibility is
-- untouched — rls_seller_ratings_insert still demands an accepted DM thread or
-- a completed service between the pair.
DROP POLICY IF EXISTS tenant_isolation ON public.seller_ratings;
CREATE POLICY tenant_isolation ON public.seller_ratings
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.shares_marketplace(public.profile_university(seller_id))
    OR public.shares_remote_services(public.profile_university(seller_id))
    OR public.is_superadmin()
  );

-- Public profile rows: without this a remote provider renders unnamed, which is
-- worse for safety than knowing who you are dealing with (20260918000000 §5).
DROP POLICY IF EXISTS rls_profiles_public_select ON public.profiles_public;
CREATE POLICY rls_profiles_public_select ON public.profiles_public
  FOR SELECT TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR NOT (university_id IS DISTINCT FROM (SELECT public.current_university_id()))
    OR public.shares_marketplace(university_id)
    OR public.shares_remote_services(university_id)
    OR public.is_superadmin()
  );

-- Conversations: a visible listing you cannot ask about is not a listing.
-- Consent is NOT weakened — conversations.status + initiated_by and
-- rls_conversations_insert_privacy_gate still make this a request the recipient
-- accepts or declines, exactly as for a same-school DM.
DROP POLICY IF EXISTS tenant_confined ON public.conversations;
CREATE POLICY tenant_confined ON public.conversations
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.profile_university(participant_1) = public.profile_university(participant_2)
    OR (
      public.shares_marketplace(public.profile_university(participant_1))
      AND public.shares_marketplace(public.profile_university(participant_2))
    )
    OR (
      public.shares_remote_services(public.profile_university(participant_1))
      AND public.shares_remote_services(public.profile_university(participant_2))
    )
  );

COMMENT ON POLICY tenant_confined ON public.conversations IS
  'A DM stays within one university, OR crosses schools that share a '
  'marketplace_group, OR crosses schools that have both opened remote services. '
  'The request/accept flow (status, initiated_by) is the consent gate in all '
  'three cases.';

-- ---------------------------------------------------------------------------
-- 5. One active offer per provider, in the DB
-- ---------------------------------------------------------------------------
-- Mirrors marketplace_listings_user_one_active_sublease (baseline) — a partial
-- unique index, not a trigger, so it holds under concurrency without a lock.
--
-- Scoped to offer_help, NOT to request_help: a provider advertising two
-- simultaneous services is the abuse shape this closes (it is how one account
-- occupies a whole category page). A student who needs help moving AND needs a
-- ride has two genuine, unrelated asks, and capping those would just push the
-- second one into the first one's free-text notes where nothing screens it.
--
-- 'pending_review' counts as active on purpose: without it a provider queues an
-- unlimited backlog behind the moderator and the cap only bites after approval.
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_listings_user_one_active_service_offer
  ON public.marketplace_listings (user_id)
  WHERE post_type = 'offer_help'
    AND status IN ('pending_review', 'open', 'claimed');

COMMENT ON INDEX public.marketplace_listings_user_one_active_service_offer IS
  'One live service OFFER per provider. Completed, expired, held and rejected '
  'offers fall out of the predicate, so taking one down frees the slot.';

-- ---------------------------------------------------------------------------
-- 6. Post-approval edit rate limit
-- ---------------------------------------------------------------------------
-- The bait-and-switch: post something benign, clear pre-moderation, then edit
-- the approved row into what you actually meant. The moderator does not re-run
-- on UPDATE, so the cheap structural answer is to make the rewrite loop slow and
-- finite rather than free.
ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS service_edit_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS service_last_edit_at timestamptz;

COMMENT ON COLUMN public.marketplace_listings.service_edit_count IS
  'Content edits made to this service post AFTER it cleared moderation. Bounded '
  'by enforce_service_edit_rate_limit().';

CREATE OR REPLACE FUNCTION public.enforce_service_edit_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  -- Deliberately small numbers. A provider fixing a typo or a time is well
  -- inside both; a provider rewriting the post repeatedly is not the same act.
  c_min_interval CONSTANT interval := interval '10 minutes';
  c_max_edits    CONSTANT integer  := 10;
BEGIN
  -- Only service posts, only once they are actually approved and public. A row
  -- still in pending_review is pre-moderation, and editing a draft the feed
  -- cannot see costs nobody anything.
  IF NEW.post_type NOT IN ('request_help', 'offer_help')
     OR OLD.moderation_decision IS DISTINCT FROM 'approved' THEN
    RETURN NEW;
  END IF;

  -- Lifecycle writes are not content edits. claim_service_post() and
  -- complete_service_post() move status/claimed_by/claimed_at/completed_at and
  -- must never be rate-limited — a claim that fails because the poster fixed a
  -- typo nine minutes ago is a broken feature, not a guardrail.
  IF NOT (
       NEW.title                    IS DISTINCT FROM OLD.title
    OR NEW.description              IS DISTINCT FROM OLD.description
    OR NEW.service_category         IS DISTINCT FROM OLD.service_category
    OR NEW.service_date             IS DISTINCT FROM OLD.service_date
    OR NEW.service_duration_minutes IS DISTINCT FROM OLD.service_duration_minutes
    OR NEW.service_location         IS DISTINCT FROM OLD.service_location
    OR NEW.service_notes            IS DISTINCT FROM OLD.service_notes
  ) THEN
    RETURN NEW;
  END IF;

  -- Admin remediation must not be throttled: an admin editing a post is the
  -- moderation path, not the bypass of it.
  IF public.is_superadmin() THEN
    RETURN NEW;
  END IF;

  IF OLD.service_edit_count >= c_max_edits THEN
    RAISE EXCEPTION
      'This post has been edited % times. Take it down and post a fresh one.',
      OLD.service_edit_count
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.service_last_edit_at IS NOT NULL
     AND OLD.service_last_edit_at > now() - c_min_interval THEN
    RAISE EXCEPTION
      'Edited too recently. Try again in a few minutes.'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.service_edit_count   := OLD.service_edit_count + 1;
  NEW.service_last_edit_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_service_edit_rate_limit ON public.marketplace_listings;
CREATE TRIGGER trg_service_edit_rate_limit
  BEFORE UPDATE ON public.marketplace_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_service_edit_rate_limit();

-- ---------------------------------------------------------------------------
-- 7. Completed-job count for the provider profile
-- ---------------------------------------------------------------------------
-- A star average with three ratings behind it reads the same as one with
-- thirty, and "has actually turned up before" is the signal a student wants
-- when they are about to let someone into their room or their car. Reputation
-- otherwise stays exactly where it was: seller_ratings and seller_rating_stats,
-- no second store (20260910000000 §6).
--
-- SECURITY DEFINER, and the reason is disclosure control rather than reach: a
-- client-side count(*) would return a number that shrinks with the VIEWER's
-- tenant scope, so the same provider would show 9 jobs to one student and 3 to
-- another. It returns a scalar and never a row, so nothing crosses that could
-- not already be counted.
--
-- "Completed" means completed BY them: an offer they posted and saw through, or
-- a request someone else posted that they claimed and finished.
CREATE OR REPLACE FUNCTION public.service_completion_count(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT count(*)::int
    FROM public.marketplace_listings l
   WHERE l.status = 'completed'
     AND (
          (l.post_type = 'offer_help'   AND l.user_id    = p_user_id)
       OR (l.post_type = 'request_help' AND l.claimed_by = p_user_id)
     )
$$;

COMMENT ON FUNCTION public.service_completion_count(uuid) IS
  'Jobs this student has completed as the PROVIDER. Viewer-independent by '
  'design — a tenant-scoped count would report a different number to every '
  'reader. Returns a scalar only.';

REVOKE EXECUTE ON FUNCTION public.service_completion_count(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.service_completion_count(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Column grants (this repo's grants are per-column — see SEC-6)
-- ---------------------------------------------------------------------------
-- The bookkeeping columns are readable so the owner's own UI can say "9 edits
-- left"; they are NOT writable, because the trigger is the only thing that may
-- move them. They are deliberately absent from marketplace_public: a new column
-- never auto-publishes to the guest projection (20260830050000).
GRANT SELECT (service_edit_count, service_last_edit_at)
  ON public.marketplace_listings TO authenticated;
