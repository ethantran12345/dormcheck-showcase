-- Auth RLS Initialization Plan: wrap `auth.uid()` in a scalar subquery on the two
-- remaining block-check policies (advisor findings for
-- rls_setup_comments_insert_block_check and
-- rls_group_message_reactions_insert_block_check).
--
-- WHAT THIS CHANGES: nothing semantically. `auth.uid()` written bare is re-evaluated
-- PER ROW; `(select auth.uid())` is hoisted into an InitPlan and evaluated ONCE per
-- statement. Same value, same predicate, same rows -- this is purely the planner
-- optimization Supabase's advisor asks for, and it is the same rewrite already
-- applied across the rest of this schema.
--
-- WHY IT IS WORTH DOING RATHER THAN BASELINING: both of these are BLOCK checks --
-- they run `is_blocked_between(...)` for every candidate row on insert. That is the
-- one shape where per-row re-evaluation is not merely wasteful but compounding: the
-- function itself does a lookup, so a bare auth.uid() multiplies a subquery by the
-- row count. Correctness is unaffected either way, which is exactly why this is safe
-- to apply unattended; the cost is only ever paid at scale, which is when nobody
-- wants to be rewriting policies.
--
-- The predicate text below is a verbatim copy of what is live in prod (read via
-- pg_get_expr on 2026-08-05), with the single `auth.uid()` -> `(select auth.uid())`
-- substitution. Nothing else in either policy is touched.

DROP POLICY IF EXISTS "rls_setup_comments_insert_block_check" ON public.setup_comments;
CREATE POLICY "rls_setup_comments_insert_block_check" ON public.setup_comments
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT EXISTS (
      SELECT 1
        FROM public.student_setups s
       WHERE s.id = setup_comments.setup_id
         AND public.is_blocked_between((select auth.uid()), s.user_id)
    )
  );

DROP POLICY IF EXISTS "rls_group_message_reactions_insert_block_check" ON public.group_message_reactions;
CREATE POLICY "rls_group_message_reactions_insert_block_check" ON public.group_message_reactions
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT EXISTS (
      SELECT 1
        FROM public.group_messages gm
       WHERE gm.id = group_message_reactions.message_id
         AND public.is_blocked_between((select auth.uid()), gm.sender_id)
    )
  );
