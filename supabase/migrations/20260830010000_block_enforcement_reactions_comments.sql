-- P0-2 (security review 2026-08-01): block enforcement was DB-enforced only on
-- conversations/messages INSERT. Reactions and setup comments relied on client
-- filtering, so a blocked user could react to the blocker's messages (arriving
-- live over Realtime) or comment on their room setup via direct PostgREST calls.
--
-- RESTRICTIVE policies AND with the existing permissive ones, reusing the
-- SECURITY DEFINER helpers from 20260603062407_block_enforcement_dms. Client
-- filters stay as the UX layer; the DB is now the boundary.

-- DM reactions: the conversation's participants must not be a blocked pair.
DROP POLICY IF EXISTS rls_message_reactions_insert_block_check ON public.message_reactions;
CREATE POLICY rls_message_reactions_insert_block_check
  ON public.message_reactions AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_conversation_blocked(conversation_id));

-- Group reactions: no reacting to a message from someone in a blocked pair with you.
DROP POLICY IF EXISTS rls_group_message_reactions_insert_block_check ON public.group_message_reactions;
CREATE POLICY rls_group_message_reactions_insert_block_check
  ON public.group_message_reactions AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    NOT EXISTS (
      SELECT 1 FROM public.group_messages gm
      WHERE gm.id = group_message_reactions.message_id
        AND public.is_blocked_between(auth.uid(), gm.sender_id)
    )
  );

-- Setup comments: no commenting on a setup owned by someone in a blocked pair with you.
DROP POLICY IF EXISTS rls_setup_comments_insert_block_check ON public.setup_comments;
CREATE POLICY rls_setup_comments_insert_block_check
  ON public.setup_comments AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    NOT EXISTS (
      SELECT 1 FROM public.student_setups s
      WHERE s.id = setup_comments.setup_id
        AND public.is_blocked_between(auth.uid(), s.user_id)
    )
  );
