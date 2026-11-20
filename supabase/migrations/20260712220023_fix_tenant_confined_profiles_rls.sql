-- HOTFIX: tenant_confined policies that subquery public.profiles are broken
-- for real clients. profiles SELECT is self-only (rls_profiles_select_own),
-- so inside a policy the OTHER user's row is invisible -> university
-- comparison yields NULL -> WITH CHECK fails -> the INSERT is rejected.
-- Broken in prod since the tenant-isolation migration (2026-07-10):
--   - conversations: starting any NEW DM / message request fails 42501.
--   - group_members: joining a group chat you didn't create fails.
--   - ranking_group_members: same pattern via own-profile read (works today
--     only because the joining user reads their own row; fixed for
--     consistency and to survive future profiles-RLS changes).
-- Fix: a SECURITY DEFINER lookup (same approach as is_blocked_between) so the
-- tenant comparison sees real university ids; policy semantics unchanged.
-- PROD APPLY: URGENT - via Supabase MCP apply_migration ahead of the staged
-- feature queue (PITR-first per discipline); prod messaging is broken now.

CREATE OR REPLACE FUNCTION public.profile_university(p_user uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT university_id FROM public.profiles WHERE id = p_user;
$$;
REVOKE EXECUTE ON FUNCTION public.profile_university(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_university(uuid) TO authenticated;

DROP POLICY IF EXISTS tenant_confined ON public.conversations;
CREATE POLICY tenant_confined ON public.conversations
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.profile_university(participant_1) = public.profile_university(participant_2)
  );

DROP POLICY IF EXISTS tenant_confined ON public.group_members;
CREATE POLICY tenant_confined ON public.group_members
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.profile_university(user_id) = (
      SELECT public.profile_university(gc.created_by)
      FROM public.group_conversations gc
      WHERE gc.id = group_members.group_id
    )
  );

DROP POLICY IF EXISTS tenant_confined ON public.ranking_group_members;
CREATE POLICY tenant_confined ON public.ranking_group_members
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.profile_university(user_id) = (
      SELECT rc.university_id
      FROM public.ranking_collaborations rc
      WHERE rc.id = ranking_group_members.group_id
    )
  );
