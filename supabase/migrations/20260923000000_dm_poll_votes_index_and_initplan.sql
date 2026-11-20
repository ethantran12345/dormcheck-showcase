-- dm_poll_votes: add the missing FK index and stop re-evaluating auth.uid() per row.
-- Closes Supabase advisor issues #198 (unindexed_foreign_key) and #199/#200/#201/#202
-- (auth_rls_initplan, one per policy).
--
-- Verified against LIVE PROD (abcdefghijklmnopqrst) on 2026-08-16 before writing:
--   · indexes were exactly dm_poll_votes_pkey UNIQUE (message_id, user_id) and
--     idx_dm_poll_votes_conversation (conversation_id). The PK's LEADING column is
--     message_id, so it cannot serve a user_id lookup — the advisor is right, and
--     "the PK already covers it" is the wrong intuition here.
--   · all four policies called bare auth.uid(), confirmed from pg_policy.
--   · the table held 0 rows, so neither the index build nor the policy swap has a
--     data-volume risk today. That will not stay true once polls ship.
--
-- WHY (select auth.uid()) RATHER THAN auth.uid(): a bare call is volatile-looking to
-- the planner and is re-executed for every candidate row; wrapped in a scalar
-- subquery it becomes an InitPlan evaluated ONCE per statement. Same value, same
-- semantics, same security — this is a planner hint, not a policy change.
--
-- WHAT IS DELIBERATELY UNCHANGED: the insert/update WITH CHECK poll-type and
-- option-index guards. They are what stops a vote being forged against a text or
-- photo message, or against an option that does not exist, and they are reproduced
-- below byte-for-byte from the live prod definitions with only the auth.uid() calls
-- wrapped. If you are diffing this against 20260919000000, the predicates are
-- identical apart from that wrapping.
--
-- ALTER POLICY rather than DROP + CREATE: ALTER swaps the expression atomically and
-- keeps the policy's command and role list, so there is no instant — not even inside
-- a transaction that could error later — in which the table is missing a policy.
--
-- Rollback (restores exact pre-migration behaviour):
--   DROP INDEX public.idx_dm_poll_votes_user_id;
--   ALTER POLICY rls_dm_poll_votes_select ON public.dm_poll_votes
--     USING (EXISTS (SELECT 1 FROM public.conversations c
--       WHERE c.id = dm_poll_votes.conversation_id
--         AND (c.participant_1 = auth.uid() OR c.participant_2 = auth.uid())));
--   ALTER POLICY rls_dm_poll_votes_delete ON public.dm_poll_votes
--     USING (user_id = auth.uid());
--   …and the insert/update pair likewise, with auth.uid() unwrapped.

-- ---------------------------------------------------------------------------
-- 1. #198 — the unindexed foreign key
-- ---------------------------------------------------------------------------
-- Every read path that is not "this conversation's votes" is "this user's votes":
-- the DELETE and UPDATE policies both qualify on user_id alone, so without this
-- index each of those is a sequential scan of the whole vote table.
CREATE INDEX IF NOT EXISTS idx_dm_poll_votes_user_id
  ON public.dm_poll_votes (user_id);

COMMENT ON INDEX public.idx_dm_poll_votes_user_id IS
  'FK index for dm_poll_votes.user_id. dm_poll_votes_pkey leads on message_id and '
  'cannot serve user_id lookups, which the UPDATE/DELETE policies qualify on. '
  'Advisor #198, 2026-08-16.';

-- ---------------------------------------------------------------------------
-- 2. #199–#202 — auth.uid() re-evaluated per row, on all four policies
-- ---------------------------------------------------------------------------

-- #199 · SELECT — participants of the conversation read the live tally.
ALTER POLICY rls_dm_poll_votes_select ON public.dm_poll_votes
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = dm_poll_votes.conversation_id
        AND (c.participant_1 = (select auth.uid()) OR c.participant_2 = (select auth.uid()))
    )
  );

-- #200 · INSERT — the vote is yours, in a conversation you are in, against a real
-- poll message in THAT conversation, for an option that exists. All four clauses
-- are load-bearing and none is relaxed here.
ALTER POLICY rls_dm_poll_votes_insert ON public.dm_poll_votes
  WITH CHECK (
    user_id = (select auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = dm_poll_votes.conversation_id
        AND (c.participant_1 = (select auth.uid()) OR c.participant_2 = (select auth.uid()))
    )
    AND EXISTS (
      SELECT 1
      FROM public.messages m
      WHERE m.id = dm_poll_votes.message_id
        AND m.conversation_id = dm_poll_votes.conversation_id
        AND m.metadata ->> 'type' = 'poll'
        AND jsonb_typeof(m.metadata -> 'options') = 'array'
        AND jsonb_array_length(m.metadata -> 'options') > dm_poll_votes.option_index
    )
  );

-- #201 · UPDATE — changing your vote. USING selects the row you own; WITH CHECK is
-- the same full gate as INSERT, so a re-vote cannot be steered onto another
-- message, another conversation, or an out-of-range option.
ALTER POLICY rls_dm_poll_votes_update ON public.dm_poll_votes
  USING (user_id = (select auth.uid()))
  WITH CHECK (
    user_id = (select auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = dm_poll_votes.conversation_id
        AND (c.participant_1 = (select auth.uid()) OR c.participant_2 = (select auth.uid()))
    )
    AND EXISTS (
      SELECT 1
      FROM public.messages m
      WHERE m.id = dm_poll_votes.message_id
        AND m.conversation_id = dm_poll_votes.conversation_id
        AND m.metadata ->> 'type' = 'poll'
        AND jsonb_typeof(m.metadata -> 'options') = 'array'
        AND jsonb_array_length(m.metadata -> 'options') > dm_poll_votes.option_index
    )
  );

-- #202 · DELETE — withdrawing your own vote.
ALTER POLICY rls_dm_poll_votes_delete ON public.dm_poll_votes
  USING (user_id = (select auth.uid()));
