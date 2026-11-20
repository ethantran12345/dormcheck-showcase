-- Resolve the live reaction-table advisor findings without changing the access model.
--
-- This must run after 20260821000000_message_reactions.sql: a clean local
-- replay creates the reaction tables there. Production already applied these
-- exact statements under its apply-time migration version 20260728231124.
--
-- The unique constraints begin with message_id, so they do not cover FK lookups by
-- user_id. The policy rewrites only wrap auth.uid() in a scalar SELECT, allowing
-- PostgreSQL to evaluate the request identity once per statement (initPlan) rather
-- than once per candidate row.

CREATE INDEX IF NOT EXISTS idx_message_reactions_user
  ON public.message_reactions (user_id);

CREATE INDEX IF NOT EXISTS idx_group_message_reactions_user
  ON public.group_message_reactions (user_id);

DROP POLICY IF EXISTS rls_message_reactions_select ON public.message_reactions;
CREATE POLICY rls_message_reactions_select ON public.message_reactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = message_reactions.conversation_id
        AND (c.participant_1 = (SELECT auth.uid()) OR c.participant_2 = (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS rls_message_reactions_insert ON public.message_reactions;
CREATE POLICY rls_message_reactions_insert ON public.message_reactions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = message_reactions.conversation_id
        AND (c.participant_1 = (SELECT auth.uid()) OR c.participant_2 = (SELECT auth.uid()))
    )
    AND EXISTS (
      SELECT 1
      FROM public.messages m
      WHERE m.id = message_reactions.message_id
        AND m.conversation_id = message_reactions.conversation_id
    )
  );

DROP POLICY IF EXISTS rls_message_reactions_delete ON public.message_reactions;
CREATE POLICY rls_message_reactions_delete ON public.message_reactions
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS rls_group_message_reactions_insert ON public.group_message_reactions;
CREATE POLICY rls_group_message_reactions_insert ON public.group_message_reactions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.is_chat_group_member(group_id)
    AND EXISTS (
      SELECT 1
      FROM public.group_messages gm
      WHERE gm.id = group_message_reactions.message_id
        AND gm.group_id = group_message_reactions.group_id
    )
  );

DROP POLICY IF EXISTS rls_group_message_reactions_delete ON public.group_message_reactions;
CREATE POLICY rls_group_message_reactions_delete ON public.group_message_reactions
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));
