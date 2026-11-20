-- Pin search_path on service_category_scope().
--
-- Caught by the release gate's step 4 on 2026-08-16, immediately after
-- 20260924000000 was applied to prod: `function_search_path_mutable` on
-- public.service_category_scope. It is an oversight rather than a decision —
-- that same migration sets `SET search_path` on all THREE of its other
-- functions (shares_remote_services, enforce_service_edit_rate_limit,
-- service_completion_count) and on this one alone it was omitted.
--
-- The practical risk here is low: the body is a pure CASE over a text
-- parameter, resolves no schema-qualified object, and calls nothing, so a
-- mutable search_path cannot change what it returns. It is pinned anyway
-- because the repo's standard is to pin (20260811020000_function_search_path_
-- hardening), and because "this one is harmless" is exactly the argument that
-- leaves a real one unpinned later.
--
-- IMMUTABLE and PARALLEL SAFE are preserved deliberately: the function sits in
-- the marketplace_listings tenant_isolation qual, alongside
-- shares_remote_services which already carries SET search_path in the same
-- policy, so this is consistent with its immediate neighbour rather than a new
-- shape.
--
-- Expand-only: CREATE OR REPLACE of one function. No signature, return type,
-- volatility, grant, policy or data change.
CREATE OR REPLACE FUNCTION public.service_category_scope(p_category text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_catalog
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

-- CREATE OR REPLACE does not reset grants, but restate them so a fresh replay
-- from zero lands the same shape as prod.
REVOKE EXECUTE ON FUNCTION public.service_category_scope(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.service_category_scope(text) TO authenticated;
