-- Tenant hardening 3/3: minor advisor-pass items.
-- 1. Trigger functions are invoked by the trigger machinery (as table owner), never as RPC —
--    residual EXECUTE for app roles is pointless surface. Revoke it.
-- 2. is_pitt_user() (20260630000000) was an additive primitive never wired to any policy;
--    tenancy now goes through current_university_id(). Drop it before tenant #3 lands.
-- 3. notifications.university_id is a dimension, not a boundary — document so nobody "fixes"
--    it into a redundant tenant policy.
-- Rollback: re-GRANT EXECUTE to authenticated; recreate is_pitt_user() from 20260630000000.

REVOKE EXECUTE ON FUNCTION public.set_university_id_from_profile() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_university_email() FROM public, anon, authenticated;

DROP FUNCTION IF EXISTS public.is_pitt_user();

COMMENT ON COLUMN public.notifications.university_id IS
  'Dimension, not a tenant boundary — rows are recipient-scoped (user_id = auth.uid()). Do not add a tenant policy.';
