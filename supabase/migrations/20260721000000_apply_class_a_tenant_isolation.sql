-- Tenant hardening: apply the standard class-A RESTRICTIVE tenant_isolation policy
-- (university_id = current_university_id() OR is_superadmin(), TO authenticated)
-- to the 11 remaining class-A roots. university_resources + academic_terms already
-- had it applied (20260711041131, 20260713002232). Anon paths are unaffected:
-- the policy is scoped TO authenticated and the public preview RPCs are SECURITY DEFINER.
-- Pre-flight (2026-07-21): 0 NULL university_id rows across all 13 class-A roots.
-- Rollback: docs/audits/tenant-isolation-rollback.md §1.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'master_housing','marketplace_listings','business_listings',
    'roommate_search_posts','dorm_questions','student_setups',
    'building_chat_links','explore_picks','buildings','course_sections',
    'ranking_collaborations'
  ] LOOP
    PERFORM public.apply_tenant_isolation(('public.' || quote_ident(t))::regclass);
  END LOOP;
END $$;
