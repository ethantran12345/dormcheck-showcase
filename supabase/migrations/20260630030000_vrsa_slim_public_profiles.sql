-- Pitt VRSA hardening - public_profiles opt-out, STEP 2 of 2 (CONTRACT)
-- Triage: git show ec16fc14:docs/audits/pitt-vrsa-triage.md (removed 2026-08-06) (P0 #1/#2, Option A). Rollback: docs/audits/pitt-vrsa-rollback.md
--
-- CONTRACT half of the expand/contract migration. Apply to prod ONLY AFTER the
-- EXPAND step (20260630020000) + the new code are deployed and verified working
-- (roommate browse/liked/feed + DM roommate card read from roommate_profiles).
-- This is the step that actually CLOSES the exposure: it removes the DISCOVERY
-- columns (bio, roommate-match fields, dorm, neighborhood, prefs, …) from the
-- broadly-readable public_profiles, leaving only the IDENTITY tier
-- (id, full_name, avatar_url + the two social handles the marketplace card falls
-- back to, display-gated by listing show_* flags).
--
-- No object depends on public_profiles (verified in prod) - safe to drop + recreate
-- (slimming columns can't be done with CREATE OR REPLACE). public_profiles stays
-- SECURITY DEFINER; the security_definer_view ERROR is accepted (see triage).

DROP VIEW IF EXISTS public.public_profiles;

CREATE VIEW public.public_profiles AS
  SELECT id, full_name, avatar_url, instagram_username, snapchat_username
  FROM public.profiles;

REVOKE ALL ON public.public_profiles FROM anon, public;
GRANT SELECT ON public.public_profiles TO authenticated;
