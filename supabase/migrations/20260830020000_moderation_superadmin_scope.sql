-- P1-1 (security review 2026-08-01): content_reports and moderation_actions
-- policies gated on profiles.is_admin, which 20260709015840_rbac_admin_tiers
-- sets for university_admin too. Once a second school's admin exists, they can
-- read/PATCH/DELETE every other school's reports (reporter identity + free-text
-- allegations) via direct PostgREST. Moderation is documented superadmin-only
-- (AdminLayout); the tenant-clamped read path is get_content_reports. Re-scope
-- the base tables to is_superadmin() and give the UPDATE policy the WITH CHECK
-- it never had.

DROP POLICY IF EXISTS rls_content_reports_select_admin ON public.content_reports;
CREATE POLICY rls_content_reports_select_admin ON public.content_reports
  FOR SELECT TO authenticated
  USING (public.is_superadmin());

DROP POLICY IF EXISTS rls_content_reports_delete_admin ON public.content_reports;
CREATE POLICY rls_content_reports_delete_admin ON public.content_reports
  FOR DELETE TO authenticated
  USING (public.is_superadmin());

DROP POLICY IF EXISTS rls_content_reports_update_admin ON public.content_reports;
CREATE POLICY rls_content_reports_update_admin ON public.content_reports
  FOR UPDATE TO authenticated
  USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

DROP POLICY IF EXISTS admins_insert_moderation_actions ON public.moderation_actions;
CREATE POLICY admins_insert_moderation_actions ON public.moderation_actions
  FOR INSERT TO authenticated
  WITH CHECK (admin_id = (SELECT auth.uid()) AND public.is_superadmin());

DROP POLICY IF EXISTS admins_read_moderation_actions ON public.moderation_actions;
CREATE POLICY admins_read_moderation_actions ON public.moderation_actions
  FOR SELECT TO authenticated
  USING (public.is_superadmin());
