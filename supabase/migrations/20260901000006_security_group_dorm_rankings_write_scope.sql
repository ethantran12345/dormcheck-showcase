-- P0 close-out (2026-08-02): tenant- and membership-scope every write path on
-- group_dorm_rankings, with an explicit WITH CHECK that value-gates the row.
--
-- History, so the threat model is honest: the baseline replays
--   "Members can insert group rankings"  FOR INSERT WITH CHECK (true)
--   "Members can update group rankings"  FOR UPDATE USING (true)
-- and 20260525032920 §8 then narrows both to an inline EXISTS over
-- ranking_group_members (status = 'accepted'). Measured on prod 2026-08-02
-- (pg_policy probe), that inline-EXISTS shape IS the live one — so "any
-- authenticated user can write any group's rankings" was already closed
-- pre-squash. What was still open, and what this migration closes:
--
--   1. No university scope on any write arm. Membership is the only gate, and
--      the RESTRICTIVE tenant_isolation policy on this table asserts only
--      parent-row *visibility* (an EXISTS that pending invitees also satisfy),
--      not tenant equality.
--   2. The membership gate is an inline EXISTS over an RLS'd table, evaluated
--      as the invoker — the exact shape the 2026-08-02 Decisions Log entry
--      condemns. It happens to work here because your own accepted
--      ranking_group_members row is visible to you, but it is one policy
--      rewrite on ranking_group_members away from silently failing closed (or
--      open). Rewritten via the SECURITY DEFINER helpers. Deliberately
--      get_my_accepted_group_ids(), NEVER get_my_all_group_ids(): pending
--      invitees may read a group, they must not write its rankings — reusing
--      the permissive read helper on a write path is the recorded trap.
--   3. WITH CHECK now value-gates the columns, not just ownership (trap 4 in
--      the log: a WITH CHECK naming one column is not a value gate for the
--      others). group_id is gated by membership + tenant; dorm_id — which has
--      NO foreign key — must resolve to a dorm of the group's own university,
--      so a row can no longer reference another tenant's dorm or a
--      nonexistent id.
--   4. "Group members can manage shared rankings" (FOR ALL) had no explicit
--      WITH CHECK, silently reusing USING; all three write-capable policies
--      are replaced by ONE policy whose USING and WITH CHECK are explicit.
--
-- ranking_group_university() gets its own name: group_university() is taken
-- by the group-chat helper (20260901000002) and resolves group_conversations.
--
-- Rollback:
--   DROP POLICY "Accepted members manage group rankings" ON public.group_dorm_rankings;
--   re-create the three policies from 20260525032920 §8 / the baseline;
--   DROP FUNCTION public.ranking_group_university(uuid), public.dorm_university(bigint);

-- ── Helpers (SECURITY DEFINER, so policy evaluation never runs another
--    table's RLS in invoker context) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ranking_group_university(p_group_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT university_id FROM public.ranking_collaborations WHERE id = p_group_id;
$$;
REVOKE EXECUTE ON FUNCTION public.ranking_group_university(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ranking_group_university(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.dorm_university(p_dorm_id bigint)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT university_id FROM public.master_housing WHERE id = p_dorm_id;
$$;
REVOKE EXECUTE ON FUNCTION public.dorm_university(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dorm_university(bigint) TO authenticated;

-- ── One explicit write policy ────────────────────────────────────────────────
DROP POLICY IF EXISTS "Members can insert group rankings" ON public.group_dorm_rankings;
DROP POLICY IF EXISTS "Members can update group rankings" ON public.group_dorm_rankings;
DROP POLICY IF EXISTS "Group members can manage shared rankings" ON public.group_dorm_rankings;

-- NULL semantics are fail-closed by construction: a NULL group_id, a group
-- with no university, or a dorm_id that resolves to nothing all yield NULL
-- from the helpers, and NULL = anything is not TRUE. Prod verified 2026-08-02:
-- 0 NULL-university dorms, 0 NULL-university groups, 0 orphan ranking rows.
CREATE POLICY "Accepted members manage group rankings"
  ON public.group_dorm_rankings
  FOR ALL
  TO authenticated
  USING (
    (group_id IN (SELECT public.get_my_accepted_group_ids())
     OR group_id IN (SELECT public.get_groups_i_own()))
    AND public.ranking_group_university(group_id) = public.current_university_id()
  )
  WITH CHECK (
    (group_id IN (SELECT public.get_my_accepted_group_ids())
     OR group_id IN (SELECT public.get_groups_i_own()))
    AND public.ranking_group_university(group_id) = public.current_university_id()
    AND public.dorm_university(dorm_id) = public.ranking_group_university(group_id)
  );

-- "Members can view all group rankings" (SELECT, any-status member) is
-- deliberately untouched: a pending invitee previewing the shared list is the
-- read path get_my_all_group_ids() exists for.
