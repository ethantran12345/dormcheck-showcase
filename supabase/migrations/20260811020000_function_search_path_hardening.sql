-- Security advisor cleanup: pin search_path on the two trigger functions the
-- linter flags as function_search_path_mutable (0011). Both bodies touch only
-- NEW/OLD and pg_catalog builtins, so an empty path is safe and removes the
-- schema-shadowing surface.
--
-- PROD APPLY RUNBOOK (Ethan at keyboard):
--   1. PITR checkpoint in the Supabase dashboard.
--   2. Supabase MCP apply_migration (never db push) with this file's content,
--      name: function_search_path_hardening.
--   3. Re-run get_advisors(security) — the two 0011 WARNs clear.
--   4. Remove the two function_search_path_mutable entries from
--      docs/security/advisor-baseline.json (they are baselined as
--      "fix authored, pending prod apply" until then).

ALTER FUNCTION public.protect_listing_verified_at() SET search_path = '';
ALTER FUNCTION public.touch_listing_confirmed() SET search_path = '';
