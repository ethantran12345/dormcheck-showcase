-- Fix infinite-recursion (42P17) in ranking RLS that made every roommate-invite
-- INSERT into ranking_group_members fail silently.
--
-- Cycle: inserting a pending member row evaluates ranking_group_members'
-- tenant_confined INSERT check, which sub-selects ranking_collaborations; that
-- read applied the "View groups I am invited to" SELECT policy, whose raw inline
-- `SELECT group_id FROM ranking_group_members ...` re-entered ranking_group_members
-- RLS while it was already being evaluated -> Postgres aborts with 42P17. Group
-- CREATION was unaffected (SECURITY DEFINER RPC bypasses RLS); only the direct
-- client invite INSERT hit the cycle, so no invite ever landed.
--
-- Fix: route the three ranking_collaborations policies that inline-read
-- ranking_group_members through the existing SECURITY DEFINER helper
-- get_my_all_group_ids() (identical query: `SELECT group_id FROM
-- ranking_group_members WHERE user_id = auth.uid()`), which bypasses RLS and so
-- cannot re-enter it. Behavior-preserving; only removes the recursion.
-- Expand-only. Applied to PROD via Supabase MCP apply_migration 2026-07-14.

DROP POLICY IF EXISTS "View groups I am invited to" ON public.ranking_collaborations;
CREATE POLICY "View groups I am invited to" ON public.ranking_collaborations
  FOR SELECT
  USING (owner_id = auth.uid() OR id IN (SELECT public.get_my_all_group_ids()));

DROP POLICY IF EXISTS "Members can delete their group" ON public.ranking_collaborations;
CREATE POLICY "Members can delete their group" ON public.ranking_collaborations
  FOR DELETE TO authenticated
  USING (id IN (SELECT public.get_my_all_group_ids()));

DROP POLICY IF EXISTS "Members can update group details" ON public.ranking_collaborations;
CREATE POLICY "Members can update group details" ON public.ranking_collaborations
  FOR UPDATE TO authenticated
  USING (id IN (SELECT public.get_my_all_group_ids()))
  WITH CHECK (id IN (SELECT public.get_my_all_group_ids()));
