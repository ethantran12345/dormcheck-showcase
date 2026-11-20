-- Gate DM message inserts to match client request UX:
-- - accepted conversations: participants may send
-- - pending conversations: only initiator, and only while zero messages exist (one request message)

DROP POLICY IF EXISTS rls_messages_insert ON public.messages;

CREATE POLICY rls_messages_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (auth.uid() = c.participant_1 OR auth.uid() = c.participant_2)
        AND (
          c.status = 'accepted'
          OR (
            c.status = 'pending'
            AND c.initiated_by = auth.uid()
            AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.conversation_id = c.id)
          )
        )
    )
  );
