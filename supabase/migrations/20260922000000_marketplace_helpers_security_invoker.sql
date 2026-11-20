-- The shared-marketplace helpers only read public.universities. Authenticated
-- users already have SELECT on that table under an unconditional read policy,
-- so elevated execution is unnecessary and exposes avoidable PostgREST RPCs.
-- Keep the pinned search_path and authenticated-only EXECUTE grants.

ALTER FUNCTION public.current_marketplace_group() SECURITY INVOKER;
ALTER FUNCTION public.shares_marketplace(uuid) SECURITY INVOKER;

REVOKE EXECUTE ON FUNCTION public.current_marketplace_group() FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.shares_marketplace(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.current_marketplace_group() TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_marketplace(uuid) TO authenticated;
