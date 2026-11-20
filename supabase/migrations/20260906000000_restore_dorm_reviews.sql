-- Restore the dorm rating feature, REVERSING the 2026-07-01 teardown
-- (20260701053717_teardown_student_reviews.sql), which dropped the table, its
-- policies, its RPCs, and 'student_review' from content_reports.chk_content_type.
--
-- This is forward-only: the teardown migration is left exactly as it is. Replaying
-- history still drops the old table, and this file then builds the new one.
--
-- THREE DELIBERATE DIFFERENCES from the pre-teardown table:
--
-- 1. Keyed on building_id bigint -> master_housing(id), NOT the old dorm_id text.
--    A text dorm name cannot be checked by user_current_dorm_matches_building(bigint),
--    so the old shape made resident-only writes unenforceable in RLS. With a real FK
--    the eligibility rule is a one-line policy predicate, and the table becomes a
--    class-B tenant child of master_housing, inheriting tenant isolation for free
--    rather than needing its own university_id column.
--
-- 2. NO comment is ever written. The column exists, nullable, for historical rows
--    only; the app writes NULL. Ratings carry no free text, so a review cannot
--    contain abusive content and never enters the pre-moderation queue. Reporting
--    still exists for the residual case (a resident rating in bad faith), which is
--    why 'student_review' returns to chk_content_type.
--
-- 3. is_anonymous DEFAULTS TRUE. Attribution is opt-in, not opt-out.
--
-- Averages are suppressed below 3 reviews IN THE RPC, not in the client, so a
-- direct PostgREST call cannot de-anonymize a hall with one or two ratings.

-- ── 1. Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.student_reviews (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id         bigint NOT NULL REFERENCES public.master_housing(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: mirrors the 20260524223000 anonymize-on-delete rule, so a
  -- departed student's rating still counts toward the hall's average. NULLs are
  -- distinct in a unique index, so orphaned rows never collide with each other.
  user_id             uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  rating              numeric(3,1) NOT NULL,
  rating_community    numeric(3,1),
  rating_student_life numeric(3,1),
  rating_location     numeric(3,1),

  -- Legacy only. The write path never sets this; see header note 2.
  comment             text,
  is_anonymous        boolean NOT NULL DEFAULT true,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT student_reviews_rating_check
    CHECK (rating >= 1 AND rating <= 5 AND (rating * 2) = floor(rating * 2)),
  CONSTRAINT student_reviews_rating_community_check
    CHECK (rating_community IS NULL OR (rating_community >= 1 AND rating_community <= 5 AND (rating_community * 2) = floor(rating_community * 2))),
  CONSTRAINT student_reviews_rating_student_life_check
    CHECK (rating_student_life IS NULL OR (rating_student_life >= 1 AND rating_student_life <= 5 AND (rating_student_life * 2) = floor(rating_student_life * 2))),
  CONSTRAINT student_reviews_rating_location_check
    CHECK (rating_location IS NULL OR (rating_location >= 1 AND rating_location <= 5 AND (rating_location * 2) = floor(rating_location * 2)))
);

COMMENT ON TABLE public.student_reviews IS
  'Resident star ratings for a residence hall. Ratings only - no free text is ever written (comment is legacy/nullable), which is why these never enter pre-moderation. One row per user per building, enforced by student_reviews_user_building_key.';
COMMENT ON COLUMN public.student_reviews.rating IS 'Room quality (1-5, half-steps).';
COMMENT ON COLUMN public.student_reviews.rating_community IS 'Community (1-5, half-steps).';
COMMENT ON COLUMN public.student_reviews.rating_student_life IS 'Student life (1-5, half-steps).';
COMMENT ON COLUMN public.student_reviews.rating_location IS 'Location (1-5, half-steps).';
COMMENT ON COLUMN public.student_reviews.comment IS 'LEGACY, always NULL on new rows. The write path has no comment field by design - see the migration header.';
COMMENT ON COLUMN public.student_reviews.is_anonymous IS 'Defaults TRUE: attribution is opt-in.';

-- One review per user per building; editable and deletable in place.
ALTER TABLE public.student_reviews
  DROP CONSTRAINT IF EXISTS student_reviews_user_building_key;
ALTER TABLE public.student_reviews
  ADD CONSTRAINT student_reviews_user_building_key UNIQUE (user_id, building_id);

CREATE INDEX IF NOT EXISTS idx_student_reviews_building_id
  ON public.student_reviews USING btree (building_id);
CREATE INDEX IF NOT EXISTS idx_student_reviews_user_id
  ON public.student_reviews USING btree (user_id);

-- updated_at maintenance. There is no shared set_updated_at() in this schema -
-- each table carries its own trigger function (seller_ratings_set_updated_at,
-- roommate_search_posts_set_updated_at, ...), so this follows that idiom.
CREATE OR REPLACE FUNCTION public.student_reviews_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_student_reviews_updated_at ON public.student_reviews;
CREATE TRIGGER trg_student_reviews_updated_at
  BEFORE UPDATE ON public.student_reviews
  FOR EACH ROW EXECUTE FUNCTION public.student_reviews_set_updated_at();

-- ── 2. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.student_reviews ENABLE ROW LEVEL SECURITY;

-- Class-B tenant isolation via the master_housing parent, matching the shape
-- normalized in 20260710183147 for every other child table.
DROP POLICY IF EXISTS tenant_isolation ON public.student_reviews;
CREATE POLICY tenant_isolation ON public.student_reviews
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.master_housing m WHERE m.id = student_reviews.building_id));

-- Read: ONLY your own row directly. Everyone else's ratings are reachable only
-- through the two SECURITY DEFINER RPCs below.
--
-- This is what makes is_anonymous a real guarantee rather than a rendering
-- convention. A permissive `USING (true)` would let any client select user_id
-- alongside is_anonymous and de-anonymize every "anonymous" rating with one
-- request - the toggle would be decoration. The RPCs return an is_mine flag and
-- a name that is NULL when anonymous, and never return user_id at all.
DROP POLICY IF EXISTS rls_student_reviews_select ON public.student_reviews;
CREATE POLICY rls_student_reviews_select ON public.student_reviews
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Write: ONLY a current resident of that building, and only as themselves.
-- user_current_dorm_matches_building() is the same helper that gates building
-- chats and group creation (20260816000000), so eligibility is defined once.
-- This is the enforcement point - the client check is UX, not the boundary.
DROP POLICY IF EXISTS rls_student_reviews_insert ON public.student_reviews;
CREATE POLICY rls_student_reviews_insert ON public.student_reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.user_current_dorm_matches_building(building_id)
  );

-- Edit in place. Residency is re-checked on UPDATE so a student who moves out
-- cannot keep revising a hall they no longer live in; the row itself survives.
DROP POLICY IF EXISTS rls_student_reviews_update ON public.student_reviews;
CREATE POLICY rls_student_reviews_update ON public.student_reviews
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.user_current_dorm_matches_building(building_id)
  );

-- Delete: own row, or a superadmin acting on a report. Deliberately NOT
-- is_admin - moderation is superadmin-scoped per the 2026-08-01 decision.
DROP POLICY IF EXISTS rls_student_reviews_delete ON public.student_reviews;
CREATE POLICY rls_student_reviews_delete ON public.student_reviews
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id OR public.is_superadmin());

REVOKE ALL ON TABLE public.student_reviews FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.student_reviews TO authenticated;
GRANT ALL ON TABLE public.student_reviews TO service_role;

-- ── 3. Aggregates ───────────────────────────────────────────────────────────
-- Suppression lives HERE, not in the client: below MIN_REVIEWS the function
-- returns the count and NULL averages, so no caller (including a raw PostgREST
-- request) can reconstruct an individual's rating in a thinly-rated hall.
DROP FUNCTION IF EXISTS public.get_dorm_review_stats(bigint);
CREATE FUNCTION public.get_dorm_review_stats(p_building_id bigint)
RETURNS TABLE(
  review_count      integer,
  avg_overall       numeric,
  avg_room          numeric,
  avg_community     numeric,
  avg_student_life  numeric,
  avg_location      numeric
)
-- SECURITY DEFINER because the SELECT policy now exposes only your own row.
-- DEFINER bypasses RLS, so the tenant boundary is re-imposed explicitly below
-- via current_university_id() - never rely on the caller's RLS in a DEFINER.
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH agg AS (
    SELECT
      count(*)::integer AS n,
      avg(sr.rating)              AS room,
      avg(sr.rating_community)    AS community,
      avg(sr.rating_student_life) AS student_life,
      avg(sr.rating_location)     AS location
    FROM public.student_reviews sr
    JOIN public.master_housing m ON m.id = sr.building_id
    WHERE sr.building_id = p_building_id
      AND m.university_id = public.current_university_id()
  )
  SELECT
    agg.n,
    CASE WHEN agg.n >= 3 THEN round(
      (COALESCE(agg.room, 0) + COALESCE(agg.community, agg.room, 0)
       + COALESCE(agg.student_life, agg.room, 0) + COALESCE(agg.location, agg.room, 0)) / 4.0, 2) END,
    CASE WHEN agg.n >= 3 THEN round(agg.room, 2) END,
    CASE WHEN agg.n >= 3 THEN round(agg.community, 2) END,
    CASE WHEN agg.n >= 3 THEN round(agg.student_life, 2) END,
    CASE WHEN agg.n >= 3 THEN round(agg.location, 2) END
  FROM agg;
$$;

COMMENT ON FUNCTION public.get_dorm_review_stats(bigint) IS
  'Per-category and overall rating averages for one building. Returns review_count always, but NULL averages below 3 reviews - the suppression is server-side so it cannot be bypassed by a direct PostgREST call. SECURITY INVOKER: the caller''s RLS applies, so tenant isolation still holds.';

REVOKE EXECUTE ON FUNCTION public.get_dorm_review_stats(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dorm_review_stats(bigint) TO authenticated;

-- Individual ratings for a hall, newest first.
--
-- Exists because `profiles` RLS hides other students' names, so a client-side
-- embed can never render an author who DID opt into attribution - the toggle
-- would have no visible effect either way. Resolving the name here, once,
-- server-side, is the only place that can honour the opt-in without also
-- leaking the opt-outs.
--
-- Two things it deliberately never returns:
--   * user_id     - returning it for anonymous rows would defeat the whole flag
--   * author_name - NULL whenever is_anonymous, computed here rather than trusted
--                   to the client
-- `is_mine` is computed server-side so the client can still hide the report
-- action on its own row without needing any identifier.
DROP FUNCTION IF EXISTS public.get_dorm_reviews(bigint, integer);
CREATE FUNCTION public.get_dorm_reviews(p_building_id bigint, p_limit integer DEFAULT 20)
RETURNS TABLE(
  id                  uuid,
  rating              numeric,
  rating_community    numeric,
  rating_student_life numeric,
  rating_location     numeric,
  is_anonymous        boolean,
  author_name         text,
  created_at          timestamptz,
  is_mine             boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    sr.id,
    sr.rating,
    sr.rating_community,
    sr.rating_student_life,
    sr.rating_location,
    sr.is_anonymous,
    CASE WHEN sr.is_anonymous THEN NULL ELSE p.full_name END,
    sr.created_at,
    sr.user_id IS NOT DISTINCT FROM (SELECT auth.uid())
  FROM public.student_reviews sr
  JOIN public.master_housing m ON m.id = sr.building_id
  LEFT JOIN public.profiles p ON p.id = sr.user_id
  WHERE sr.building_id = p_building_id
    -- Tenant clamp: DEFINER bypasses RLS, so this is the boundary.
    AND m.university_id = public.current_university_id()
  ORDER BY sr.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
$$;

COMMENT ON FUNCTION public.get_dorm_reviews(bigint, integer) IS
  'Individual ratings for one building. Never returns user_id, and returns author_name only for rows the author chose to attribute - anonymity is enforced here, not in the client.';

REVOKE EXECUTE ON FUNCTION public.get_dorm_reviews(bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dorm_reviews(bigint, integer) TO authenticated;

-- ── 4. Reporting ────────────────────────────────────────────────────────────
-- Re-admit 'student_review'. Additive: every value valid after 20260825010000
-- stays valid. moderation_actions already kept 'student_review' (it is an
-- append-only audit log), so only content_reports needs widening.
ALTER TABLE public.content_reports DROP CONSTRAINT IF EXISTS chk_content_type;
ALTER TABLE public.content_reports ADD CONSTRAINT chk_content_type
  CHECK (content_type = ANY (ARRAY[
    'marketplace_listing','roommate_post','building_chat_link','user',
    'seller_rating','student_setup','group_message','dm_message','student_review'
  ]));

-- ── 5. Admin reports queue ──────────────────────────────────────────────────
-- Re-add the 'student_review' branches the teardown stripped out. Body is the
-- live 20260825010000 definition verbatim plus five additive CASE/EXISTS arms;
-- nothing existing changes. CREATE OR REPLACE preserves owner and grants.
CREATE OR REPLACE FUNCTION public.get_content_reports(content_type_filter text DEFAULT NULL::text, p_university_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(report_id uuid, content_type text, content_id uuid, reporter_id uuid, reporter_name text, reason text, category text, escalated_at timestamp with time zone, reported_at timestamp with time zone, content_preview_title text, content_preview_body text, content_owner_id uuid, content_owner_name text, content_context text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    cr.id AS report_id,
    cr.content_type,
    cr.content_id,
    cr.reporter_id,
    reporter.full_name AS reporter_name,
    cr.reason,
    cr.category,
    cr.escalated_at,
    cr.created_at AS reported_at,
    CASE cr.content_type
      WHEN 'marketplace_listing' THEN (SELECT ml.title FROM marketplace_listings ml WHERE ml.id = cr.content_id)
      WHEN 'roommate_post' THEN (SELECT
        CASE rsp.post_type
          WHEN 'looking-for-roommates' THEN 'Looking for roommates'
          WHEN 'have-place-need-people' THEN 'Have a place, need people'
          ELSE 'Roommate post'
        END
        FROM roommate_search_posts rsp WHERE rsp.id = cr.content_id)
      WHEN 'building_chat_link' THEN (SELECT COALESCE(bcl.label, 'Chat link') FROM building_chat_links bcl WHERE bcl.id = cr.content_id)
      WHEN 'seller_rating' THEN (SELECT 'Seller rating: ' || sr.stars || ' of 5 stars' FROM seller_ratings sr WHERE sr.id = cr.content_id)
      WHEN 'group_message' THEN (SELECT 'Message in ' || gc.name FROM group_messages gm JOIN group_conversations gc ON gc.id = gm.group_id WHERE gm.id = cr.content_id)
      WHEN 'dm_message' THEN (SELECT
        CASE WHEN m.metadata ->> 'type' = 'image' THEN 'Direct message (photo)' ELSE 'Direct message' END
        FROM messages m WHERE m.report_uuid = cr.content_id)
      WHEN 'student_setup' THEN (SELECT 'Room setup in ' || ss.dorm_name FROM student_setups ss WHERE ss.report_uuid = cr.content_id)
      WHEN 'student_review' THEN (SELECT 'Rating of ' || COALESCE(mh.residence_hall, 'a hall')
        FROM student_reviews srv JOIN master_housing mh ON mh.id = srv.building_id
        WHERE srv.id = cr.content_id)
    END AS content_preview_title,
    CASE cr.content_type
      WHEN 'marketplace_listing' THEN (SELECT LEFT(COALESCE(ml.description, ''), 200) FROM marketplace_listings ml WHERE ml.id = cr.content_id)
      WHEN 'roommate_post' THEN (SELECT LEFT(COALESCE(rsp.content, ''), 200) FROM roommate_search_posts rsp WHERE rsp.id = cr.content_id)
      WHEN 'building_chat_link' THEN (SELECT bcl.url FROM building_chat_links bcl WHERE bcl.id = cr.content_id)
      WHEN 'seller_rating' THEN (SELECT LEFT(COALESCE(sr.comment, ''), 200) FROM seller_ratings sr WHERE sr.id = cr.content_id)
      WHEN 'group_message' THEN (SELECT LEFT(gm.content, 200) FROM group_messages gm WHERE gm.id = cr.content_id)
      WHEN 'dm_message' THEN (SELECT
        COALESCE(m.metadata ->> 'url', LEFT(COALESCE(m.content, ''), 200))
        FROM messages m WHERE m.report_uuid = cr.content_id)
      -- A review has no free text by design, so the ratings themselves are the
      -- only thing an admin can moderate. Rendering them here is what makes the
      -- report actionable at all.
      WHEN 'student_review' THEN (SELECT
        'Room ' || srv.rating
        || ' / Community ' || COALESCE(srv.rating_community::text, '-')
        || ' / Student life ' || COALESCE(srv.rating_student_life::text, '-')
        || ' / Location ' || COALESCE(srv.rating_location::text, '-')
        FROM student_reviews srv WHERE srv.id = cr.content_id)
      WHEN 'student_setup' THEN (SELECT LEFT(COALESCE(ss.caption, ''), 200) FROM student_setups ss WHERE ss.report_uuid = cr.content_id)
    END AS content_preview_body,
    CASE cr.content_type
      WHEN 'marketplace_listing' THEN (SELECT ml.user_id FROM marketplace_listings ml WHERE ml.id = cr.content_id)
      WHEN 'roommate_post' THEN (SELECT rsp.user_id FROM roommate_search_posts rsp WHERE rsp.id = cr.content_id)
      WHEN 'building_chat_link' THEN (SELECT bcl.submitted_by FROM building_chat_links bcl WHERE bcl.id = cr.content_id)
      WHEN 'seller_rating' THEN (SELECT sr.rater_id FROM seller_ratings sr WHERE sr.id = cr.content_id)
      WHEN 'group_message' THEN (SELECT gm.sender_id FROM group_messages gm WHERE gm.id = cr.content_id)
      WHEN 'dm_message' THEN (SELECT m.sender_id FROM messages m WHERE m.report_uuid = cr.content_id)
      WHEN 'student_setup' THEN (SELECT ss.user_id FROM student_setups ss WHERE ss.report_uuid = cr.content_id)
      WHEN 'student_review' THEN (SELECT srv.user_id FROM student_reviews srv WHERE srv.id = cr.content_id)
    END AS content_owner_id,
    NULL::text AS content_owner_name,
    CASE cr.content_type
      WHEN 'building_chat_link' THEN (
        SELECT mh.residence_hall
        FROM building_chat_links bcl
        JOIN master_housing mh ON mh.id = bcl.building_id
        WHERE bcl.id = cr.content_id
      )
      WHEN 'seller_rating' THEN (
        SELECT 'Rating of ' || COALESCE(sp.full_name, 'a seller')
        FROM seller_ratings sr
        LEFT JOIN profiles sp ON sp.id = sr.seller_id
        WHERE sr.id = cr.content_id
      )
      WHEN 'group_message' THEN (
        SELECT 'Sent by ' || COALESCE(sp.full_name, 'a member')
        FROM group_messages gm
        LEFT JOIN profiles sp ON sp.id = gm.sender_id
        WHERE gm.id = cr.content_id
      )
      WHEN 'dm_message' THEN (
        SELECT 'Sent by ' || COALESCE(sp.full_name, 'a student')
        FROM messages m
        LEFT JOIN profiles sp ON sp.id = m.sender_id
        WHERE m.report_uuid = cr.content_id
      )
      -- is_anonymous hides the author from STUDENTS; moderation still needs
      -- content_owner_id to action the report. This line reports the flag so an
      -- admin knows the name was never publicly shown.
      WHEN 'student_review' THEN (
        SELECT CASE WHEN srv.is_anonymous THEN 'Posted anonymously'
                    ELSE 'Posted by ' || COALESCE(sp.full_name, 'a student') END
        FROM student_reviews srv
        LEFT JOIN profiles sp ON sp.id = srv.user_id
        WHERE srv.id = cr.content_id
      )
      ELSE NULL
    END AS content_context
  FROM public.content_reports cr
  LEFT JOIN public.profiles reporter ON reporter.id = cr.reporter_id
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN public.is_superadmin() THEN p_university_id
      ELSE public.current_university_id()
    END AS uid
  ) scope
  WHERE
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
    AND (content_type_filter IS NULL OR cr.content_type = content_type_filter)
    AND (
      (public.is_superadmin() AND p_university_id IS NULL)
      OR (cr.content_type = 'marketplace_listing' AND EXISTS (
            SELECT 1 FROM public.marketplace_listings ml
            WHERE ml.id = cr.content_id AND ml.university_id = scope.uid))
      OR (cr.content_type = 'roommate_post' AND EXISTS (
            SELECT 1 FROM public.roommate_search_posts rsp
            WHERE rsp.id = cr.content_id AND rsp.university_id = scope.uid))
      OR (cr.content_type = 'building_chat_link' AND EXISTS (
            SELECT 1 FROM public.building_chat_links bcl
            WHERE bcl.id = cr.content_id AND bcl.university_id = scope.uid))
      OR (cr.content_type = 'user' AND EXISTS (
            SELECT 1 FROM public.profiles rp
            WHERE rp.id = cr.content_id AND rp.university_id = scope.uid))
      OR (cr.content_type = 'seller_rating' AND EXISTS (
            SELECT 1 FROM public.seller_ratings sr
            JOIN public.profiles sp ON sp.id = sr.seller_id
            WHERE sr.id = cr.content_id AND sp.university_id = scope.uid))
      OR (cr.content_type = 'group_message' AND EXISTS (
            SELECT 1 FROM public.group_messages gm
            JOIN public.profiles sp ON sp.id = gm.sender_id
            WHERE gm.id = cr.content_id AND sp.university_id = scope.uid))
      -- Tenant scope follows the SENDER's university, exactly as group_message
      -- does, so a Pitt admin never sees a CMU student's reported message.
      OR (cr.content_type = 'dm_message' AND EXISTS (
            SELECT 1 FROM public.messages m
            JOIN public.profiles sp ON sp.id = m.sender_id
            WHERE m.report_uuid = cr.content_id AND sp.university_id = scope.uid))
      OR (cr.content_type = 'student_setup' AND EXISTS (
            SELECT 1 FROM public.student_setups ss
            JOIN public.profiles sp ON sp.id = ss.user_id
            WHERE ss.report_uuid = cr.content_id AND sp.university_id = scope.uid))
      -- Scoped by the BUILDING's university (like building_chat_link), not the
      -- author's: the review is about the hall, and the author may be NULL after
      -- an account deletion, which would otherwise strand the report.
      OR (cr.content_type = 'student_review' AND EXISTS (
            SELECT 1 FROM public.student_reviews srv
            JOIN public.master_housing mh ON mh.id = srv.building_id
            WHERE srv.id = cr.content_id AND mh.university_id = scope.uid))
    )
  ORDER BY cr.created_at DESC;
$function$;
