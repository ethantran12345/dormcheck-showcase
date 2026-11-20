-- Private DM voice messages and live DM polls.
--
-- Messages remain the single timeline model: audio and polls are typed payloads
-- in messages.metadata, while `content` keeps the accessible fallback and inbox
-- preview. Only poll votes need a child table, because they change independently
-- and must be realtime-synchronised without rewriting the parent message.
--
-- Audio is deliberately a PRIVATE bucket. Object keys are
-- `<conversation-id>/<sender-id>/<random>.m4a`; every storage policy checks the
-- conversation segment against the caller's actual membership. That gives both
-- participants playback, lets a sender retract their own clip, and never turns
-- a copied object URL into public media.

-- ── Private voice-message storage ───────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dm-audio',
  'dm-audio',
  false,
  15728640,
  ARRAY['audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/webm']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- University admins intentionally cannot SELECT `content_reports` directly;
-- their tenant-scoped review queue is the definer RPC. Storage RLS runs as the
-- caller too, so the report lookup needs this narrowly-scoped definer predicate
-- rather than an inline EXISTS that silently sees zero rows for every
-- university_admin. It returns only an authorization boolean, never message,
-- report, or object data.
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.can_moderate_reported_dm_audio(p_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.content_reports cr
    JOIN public.messages m ON m.report_uuid = cr.content_id
    JOIN public.profiles moderator ON moderator.id = auth.uid()
    WHERE cr.content_type = 'dm_message'
      AND m.metadata ->> 'type' = 'audio'
      AND m.metadata ->> 'path' = p_path
      AND moderator.is_admin = true
      AND (
        public.is_superadmin()
        OR public.profile_university(m.sender_id) = public.current_university_id()
      )
  );
$function$;

REVOKE ALL ON FUNCTION private.can_moderate_reported_dm_audio(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_moderate_reported_dm_audio(text) TO authenticated;

DROP POLICY IF EXISTS "DM participants can read private audio" ON storage.objects;
CREATE POLICY "DM participants can read private audio" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'dm-audio'
    AND (
      -- Normal playback: only a participant of the key's conversation.
      EXISTS (
        SELECT 1
        FROM public.conversations c
        WHERE c.id::text = (storage.foldername(name))[1]
          AND (c.participant_1 = auth.uid() OR c.participant_2 = auth.uid())
      )
      -- Moderation exception: see the security-definer predicate above. This
      -- is report-gated and university-scoped; it never grants an admin a DM
      -- audio object just because they are an admin.
      OR private.can_moderate_reported_dm_audio(storage.objects.name)
    )
  );

DROP POLICY IF EXISTS "DM participants can upload own private audio" ON storage.objects;
CREATE POLICY "DM participants can upload own private audio" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'dm-audio'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id::text = (storage.foldername(name))[1]
        AND (c.participant_1 = auth.uid() OR c.participant_2 = auth.uid())
    )
  );

-- Audio is immutable. A sender who retracts a message removes the object rather
-- than overwriting it, keeping the retained object exactly aligned with the
-- message timeline and avoiding mutable evidence in moderation reports.
DROP POLICY IF EXISTS "DM senders can delete own private audio" ON storage.objects;
CREATE POLICY "DM senders can delete own private audio" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'dm-audio'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id::text = (storage.foldername(name))[1]
        AND (c.participant_1 = auth.uid() OR c.participant_2 = auth.uid())
    )
  );

-- ── One vote per participant, kept live separately from the message ─────────
CREATE TABLE IF NOT EXISTS public.dm_poll_votes (
  message_id bigint NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  option_index smallint NOT NULL CHECK (option_index >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

COMMENT ON TABLE public.dm_poll_votes IS
  'One current DM poll selection per participant. Poll question/options live in messages.metadata; this table exists only for realtime votes.';

CREATE INDEX IF NOT EXISTS idx_dm_poll_votes_conversation
  ON public.dm_poll_votes (conversation_id);

ALTER TABLE public.dm_poll_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_poll_votes REPLICA IDENTITY FULL;

DROP POLICY IF EXISTS rls_dm_poll_votes_select ON public.dm_poll_votes;
CREATE POLICY rls_dm_poll_votes_select ON public.dm_poll_votes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = dm_poll_votes.conversation_id
        AND (c.participant_1 = auth.uid() OR c.participant_2 = auth.uid())
    )
  );

-- The target must be a real poll message in the same conversation, and the
-- selection must address an existing option. This makes the denormalized thread
-- key trustworthy and prevents a crafted vote for a text/photo message.
DROP POLICY IF EXISTS rls_dm_poll_votes_insert ON public.dm_poll_votes;
CREATE POLICY rls_dm_poll_votes_insert ON public.dm_poll_votes
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = dm_poll_votes.conversation_id
        AND (c.participant_1 = auth.uid() OR c.participant_2 = auth.uid())
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

DROP POLICY IF EXISTS rls_dm_poll_votes_update ON public.dm_poll_votes;
CREATE POLICY rls_dm_poll_votes_update ON public.dm_poll_votes
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = dm_poll_votes.conversation_id
        AND (c.participant_1 = auth.uid() OR c.participant_2 = auth.uid())
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

DROP POLICY IF EXISTS rls_dm_poll_votes_delete ON public.dm_poll_votes;
CREATE POLICY rls_dm_poll_votes_delete ON public.dm_poll_votes
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dm_poll_votes TO authenticated;
GRANT ALL ON public.dm_poll_votes TO service_role;

-- Realtime payloads include conversation_id even on DELETE (REPLICA IDENTITY
-- FULL), so clients can subscribe to only their open DM thread.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'dm_poll_votes'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dm_poll_votes;
  END IF;
END;
$$;
