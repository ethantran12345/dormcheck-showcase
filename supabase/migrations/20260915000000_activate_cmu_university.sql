-- Capture, as schema, the CMU activation that was performed BY HAND in prod.
--
-- Background: 20260710055408_seed_cmu_university.sql deliberately seeded CMU with
-- is_active = false ("INACTIVE until tenant isolation is verified"). Tenant isolation
-- WAS verified, and someone flipped prod by hand:
--
--     prod public.universities: slug='cmu', is_active=true, updated_at 2026-07-27 12:15:37+00
--
-- No migration ever recorded that flip. `src/config/universities.ts` (CMU.isActive = true)
-- and `api/_lib/auth.ts` were updated in code, so prod and the client agree — but every
-- freshly reset database (`supabase db reset`, CI, any future environment) comes up with
-- CMU INACTIVE. Consequence: `validate_university_email()` correctly refuses an
-- @andrew.cmu.edu signup locally, so no multi-tenant verification can be done on a local
-- stack without a throwaway out-of-band script. Same failure class as a prod state that
-- no migration records and no check can see.
--
-- Expand-only. This adds no object and removes none; it only converges data.
--
-- No-op against prod by construction: the `IS DISTINCT FROM true` predicate matches zero
-- rows where the flag is already true, so re-applying this to prod updates 0 rows and does
-- not touch updated_at. Idempotent everywhere for the same reason.
--
-- Rollback: UPDATE public.universities SET is_active = false WHERE slug = 'cmu';
--   (Deactivating a live tenant blocks its students from signing in — this is a
--    product decision, not a routine revert.)

UPDATE public.universities
   SET is_active = true
 WHERE slug = 'cmu'
   AND is_active IS DISTINCT FROM true;
