-- Admin university silos: clamped p_university_id on the two admin RPCs.
--
-- WHY: the superadmin console is moving to per-university silos (pick a school,
-- see only that school). Superadmins bypass tenant RLS by design, so silo
-- scoping needs an explicit, server-validated filter on the RPCs that aggregate
-- across schools.
--
-- SECURITY (clamp): p_university_id is honored ONLY for superadmins.
--   - superadmin + NULL  -> all rows (legacy behavior; keeps old clients working)
--   - superadmin + uuid  -> that university only
--   - anyone else        -> param IGNORED; scope forced to current_university_id().
--     A university_admin can NOT read another school by passing a foreign uuid.
--     Side effect (intended fix): get_content_reports previously showed a
--     university_admin ALL schools' reports (it only checked is_admin); it is
--     now scoped to their own school, consistent with the tenancy model.
--
-- DROP-then-CREATE (not a second overload) so PostgREST never sees two
-- same-name functions and old no-arg / one-arg calls keep resolving via the
-- new defaults. Bodies are copied from the LIVE prod definitions
-- (pg_get_functiondef, 2026-07-10) with only the param + scope clause added.

-- ---------------------------------------------------------------------------
-- 1) get_university_admins(p_university_id uuid default null)
-- ---------------------------------------------------------------------------
drop function if exists public.get_university_admins();

create or replace function public.get_university_admins(p_university_id uuid default null)
returns table(id uuid, full_name text, email text, role public.app_role, university_id uuid, created_at timestamptz)
language sql
stable security definer
set search_path to 'public'
as $function$
  select p.id, p.full_name, p.email, p.role, p.university_id, p.created_at
  from public.profiles p
  where p.role <> 'user'::public.app_role
    and (
      public.is_superadmin()
      or (
        public.current_app_role() = 'university_admin'::public.app_role
        and p.university_id = public.current_university_id()
      )
    )
    -- Silo clamp: only a superadmin's explicit selection narrows further; for
    -- everyone else the clause above already scopes and the param is ignored.
    and (
      not public.is_superadmin()
      or p_university_id is null
      or p.university_id = p_university_id
    );
$function$;

revoke execute on function public.get_university_admins(uuid) from public, anon;
grant execute on function public.get_university_admins(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) get_content_reports(content_type_filter text, p_university_id uuid)
-- ---------------------------------------------------------------------------
drop function if exists public.get_content_reports(text);
-- Fresh-chain (local/CI) note: earlier repo migrations (20260712110000 /
-- 20260712160000) already created the (text, uuid) signature with a narrower
-- return table; drop it too so the create below doesn't 42P13. No-op in prod,
-- where this migration originally replaced only the (text) signature.
drop function if exists public.get_content_reports(text, uuid);

create or replace function public.get_content_reports(
  content_type_filter text default null,
  p_university_id uuid default null
)
returns table(
  report_id uuid,
  content_type text,
  content_id uuid,
  reporter_id uuid,
  reporter_name text,
  reason text,
  reported_at timestamptz,
  content_preview_title text,
  content_preview_body text,
  content_owner_id uuid,
  content_owner_name text,
  content_context text
)
language sql
stable security definer
set search_path to 'public'
as $function$
  SELECT
    cr.id AS report_id,
    cr.content_type,
    cr.content_id,
    cr.reporter_id,
    reporter.full_name AS reporter_name,
    cr.reason,
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
    END AS content_preview_title,
    CASE cr.content_type
      WHEN 'marketplace_listing' THEN (SELECT LEFT(COALESCE(ml.description, ''), 200) FROM marketplace_listings ml WHERE ml.id = cr.content_id)
      WHEN 'roommate_post' THEN (SELECT LEFT(COALESCE(rsp.content, ''), 200) FROM roommate_search_posts rsp WHERE rsp.id = cr.content_id)
      WHEN 'building_chat_link' THEN (SELECT bcl.url FROM building_chat_links bcl WHERE bcl.id = cr.content_id)
      WHEN 'seller_rating' THEN (SELECT LEFT(COALESCE(sr.comment, ''), 200) FROM seller_ratings sr WHERE sr.id = cr.content_id)
    END AS content_preview_body,
    CASE cr.content_type
      WHEN 'marketplace_listing' THEN (SELECT ml.user_id FROM marketplace_listings ml WHERE ml.id = cr.content_id)
      WHEN 'roommate_post' THEN (SELECT rsp.user_id FROM roommate_search_posts rsp WHERE rsp.id = cr.content_id)
      WHEN 'building_chat_link' THEN (SELECT bcl.submitted_by FROM building_chat_links bcl WHERE bcl.id = cr.content_id)
      WHEN 'seller_rating' THEN (SELECT sr.rater_id FROM seller_ratings sr WHERE sr.id = cr.content_id)
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
      ELSE NULL
    END AS content_context
  FROM public.content_reports cr
  LEFT JOIN public.profiles reporter ON reporter.id = cr.reporter_id
  -- Effective silo scope: superadmin uses the (optional) param; everyone else
  -- is clamped to their own university regardless of what they pass.
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
      -- Unscoped only for superadmin with no silo selected (legacy calls).
      (public.is_superadmin() AND p_university_id IS NULL)
      -- Per content type, resolve the report's university and match the scope.
      OR (cr.content_type = 'marketplace_listing' AND EXISTS (
            SELECT 1 FROM public.marketplace_listings ml
            WHERE ml.id = cr.content_id AND ml.university_id = scope.uid))
      OR (cr.content_type = 'roommate_post' AND EXISTS (
            SELECT 1 FROM public.roommate_search_posts rsp
            WHERE rsp.id = cr.content_id AND rsp.university_id = scope.uid))
      OR (cr.content_type = 'building_chat_link' AND EXISTS (
            SELECT 1 FROM public.building_chat_links bcl
            WHERE bcl.id = cr.content_id AND bcl.university_id = scope.uid))
      -- User reports: content_id is the reported profile; scope via their school.
      OR (cr.content_type = 'user' AND EXISTS (
            SELECT 1 FROM public.profiles rp
            WHERE rp.id = cr.content_id AND rp.university_id = scope.uid))
      -- Seller ratings: scope via the rated seller's school.
      OR (cr.content_type = 'seller_rating' AND EXISTS (
            SELECT 1 FROM public.seller_ratings sr
            JOIN public.profiles sp ON sp.id = sr.seller_id
            WHERE sr.id = cr.content_id AND sp.university_id = scope.uid))
    )
  ORDER BY cr.created_at DESC;
$function$;

revoke execute on function public.get_content_reports(text, uuid) from public, anon;
grant execute on function public.get_content_reports(text, uuid) to authenticated;
