-- P1.9 privacy controls. Expand-only.
--   1. profiles.message_privacy - who can OPEN a new conversation with you:
--      'anyone' (default, current behavior) or 'connections' (people you
--      share a group chat with, or an existing accepted conversation).
--      Enforced server-side with a RESTRICTIVE policy on conversations
--      INSERT, alongside the existing block + tenant-confined gates.
--   2. profiles.discoverable - whether you appear in user search
--      (search_users RPC). Existing connections are unaffected.
--   3. search_users() hardened: honors discoverable and (bonus, consistent
--      with the tenancy model) only ever returns the caller's own school.
-- PROD APPLY: via Supabase MCP apply_migration, after 20260712160000.

-- ── 1+2. Preference columns ──────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS message_privacy text NOT NULL DEFAULT 'anyone'
    CONSTRAINT profiles_message_privacy_check CHECK (message_privacy IN ('anyone', 'connections')),
  ADD COLUMN IF NOT EXISTS discoverable boolean NOT NULL DEFAULT true;

-- ── 1. Enforcement: new-conversation gate ────────────────────────────────────
-- Applies only at conversation creation (message requests). Existing
-- conversations, group chats, and blocks are governed by their own policies.

-- SECURITY DEFINER helper (mirrors is_blocked_between): the policy cannot
-- query conversations/group_members directly - referencing conversations
-- inside its own policy recurses (42P17), and group_members has its own
-- membership RLS.
CREATE OR REPLACE FUNCTION public.can_start_conversation(p_sender uuid, p_recipient uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE((SELECT p.message_privacy FROM public.profiles p WHERE p.id = p_recipient), 'anyone') = 'anyone'
    OR EXISTS (
      SELECT 1
      FROM public.group_members gm_me
      JOIN public.group_members gm_them ON gm_them.group_id = gm_me.group_id
      WHERE gm_me.user_id = p_sender AND gm_them.user_id = p_recipient
    )
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.status = 'accepted'
        AND ((c.participant_1 = p_sender AND c.participant_2 = p_recipient)
          OR (c.participant_1 = p_recipient AND c.participant_2 = p_sender))
    );
$$;
REVOKE EXECUTE ON FUNCTION public.can_start_conversation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_start_conversation(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS rls_conversations_insert_privacy_gate ON public.conversations;
CREATE POLICY rls_conversations_insert_privacy_gate ON public.conversations
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.can_start_conversation(
      (SELECT auth.uid()),
      CASE WHEN participant_1 = (SELECT auth.uid()) THEN participant_2 ELSE participant_1 END
    )
  );

-- ── 3. search_users honors discoverable + caller's school ────────────────────

CREATE OR REPLACE FUNCTION public.search_users(search_query text)
RETURNS TABLE (
  id uuid,
  full_name text,
  avatar_url text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  IF search_query IS NULL OR length(trim(search_query)) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.avatar_url
  FROM public.profiles p
  WHERE p.id <> auth.uid()
    AND p.discoverable = true
    AND p.university_id IS NOT DISTINCT FROM (
      SELECT me.university_id FROM public.profiles me WHERE me.id = auth.uid()
    )
    AND (
      p.full_name ILIKE '%' || trim(search_query) || '%'
      OR p.email ILIKE '%' || trim(search_query) || '%'
    )
  ORDER BY p.full_name NULLS LAST, p.id
  LIMIT 20;
END;
$$;

COMMENT ON FUNCTION public.search_users(text) IS
'Authenticated user search by name or email substring, same-school only, honoring
profiles.discoverable. Returns id, full_name, avatar_url only; never exposes
email or phone. Empty when unauthenticated or query shorter than 2 characters.';
