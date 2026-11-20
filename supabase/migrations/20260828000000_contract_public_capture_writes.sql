-- CONTRACT: apply to production ONLY AFTER /api/submit-admin-lead is deployed
-- and both the lead form and /api/join-waitlist have been smoke-tested. The
-- browser no longer needs direct table INSERT privileges; Vercel uses the
-- service-role client and enforces an IP rate limit before either write.
--
-- Rollback (only if the server endpoint is unavailable after deploy):
--   GRANT INSERT ON public.university_waitlist TO anon, authenticated;
--   GRANT INSERT ON public.university_admin_leads TO anon, authenticated;
--   CREATE POLICY "Anyone may join the waitlist (anon)" ON public.university_waitlist FOR INSERT TO anon WITH CHECK (true);
--   CREATE POLICY "Anyone may join the waitlist (authenticated)" ON public.university_waitlist FOR INSERT TO authenticated WITH CHECK (true);
--   CREATE POLICY "Anyone may submit an admin lead (anon)" ON public.university_admin_leads FOR INSERT TO anon WITH CHECK (true);
--   CREATE POLICY "Anyone may submit an admin lead (authenticated)" ON public.university_admin_leads FOR INSERT TO authenticated WITH CHECK (true);

REVOKE INSERT ON TABLE public.university_waitlist FROM PUBLIC, anon, authenticated;
REVOKE INSERT ON TABLE public.university_admin_leads FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Anyone may join the waitlist (anon)" ON public.university_waitlist;
DROP POLICY IF EXISTS "Anyone may join the waitlist (authenticated)" ON public.university_waitlist;
DROP POLICY IF EXISTS "Anyone may submit an admin lead (anon)" ON public.university_admin_leads;
DROP POLICY IF EXISTS "Anyone may submit an admin lead (authenticated)" ON public.university_admin_leads;

COMMENT ON TABLE public.university_waitlist IS
  'Public prospect capture written only by the rate-limited /api/join-waitlist service-role endpoint; no direct client table access.';
COMMENT ON TABLE public.university_admin_leads IS
  'Partnership-lead capture written only by the rate-limited /api/submit-admin-lead service-role endpoint; no direct client table access.';
