-- P0.3 in-app 2FA (TOTP) + backup codes + active sessions. Expand-only.
-- TOTP enroll/challenge/verify is native GoTrue (supabase.auth.mfa.*); this
-- migration adds the two pieces GoTrue lacks:
--   1. mfa_backup_codes - one-time recovery codes (SHA-256 hex, hashed
--      client-side before insert; plaintext never reaches the DB). Recovery
--      via use_backup_code() burns the code and deletes the user's TOTP
--      factors, letting them back in to re-enroll.
--   2. Session RPCs over auth.sessions (GoTrue already stores user_agent/ip
--      per session) - list own sessions, revoke one, revoke all others.
--      auth.refresh_tokens cascades on session delete, so revocation kills
--      the refresh path; the access token dies at its normal expiry (<=1h).
-- PROD APPLY: via Supabase MCP apply_migration, after 20260712100000.

-- ── 1. Backup codes ──────────────────────────────────────────────────────────

CREATE TABLE public.mfa_backup_codes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_hash)
);

CREATE INDEX mfa_backup_codes_user_idx ON public.mfa_backup_codes (user_id);

ALTER TABLE public.mfa_backup_codes ENABLE ROW LEVEL SECURITY;

-- Owner can list (hashes only - used to show "N codes remaining"), mint a new
-- set, and clear the old set on regenerate/unenroll. used_at flips only inside
-- use_backup_code() - no UPDATE policy by construction.
CREATE POLICY mfa_backup_codes_select_own ON public.mfa_backup_codes
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY mfa_backup_codes_insert_own ON public.mfa_backup_codes
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY mfa_backup_codes_delete_own ON public.mfa_backup_codes
  FOR DELETE USING (auth.uid() = user_id);

REVOKE ALL ON TABLE public.mfa_backup_codes FROM anon;
GRANT SELECT, INSERT, DELETE ON TABLE public.mfa_backup_codes TO authenticated;

-- Burn a backup code: marks it used and removes the user's TOTP factors so an
-- AAL1 session stuck at the MFA challenge can get back in and re-enroll.
-- Callable at AAL1 by design - that is the locked-out state it exists for.
CREATE OR REPLACE FUNCTION public.use_backup_code(p_code text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_hash text;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  v_hash := encode(digest(lower(replace(trim(p_code), '-', '')), 'sha256'), 'hex');
  UPDATE public.mfa_backup_codes
     SET used_at = now()
   WHERE user_id = auth.uid() AND code_hash = v_hash AND used_at IS NULL
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN false;
  END IF;
  -- MFA is now off for this user: drop TOTP factors (challenges cascade) and
  -- the rest of the code set - a fresh set mints on re-enroll.
  DELETE FROM auth.mfa_factors WHERE user_id = auth.uid() AND factor_type = 'totp';
  DELETE FROM public.mfa_backup_codes WHERE user_id = auth.uid();
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.use_backup_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.use_backup_code(text) TO authenticated;

-- ── 2. Active sessions ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_sessions()
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  last_seen_at timestamptz,
  user_agent text,
  ip text,
  is_current boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    s.id,
    s.created_at,
    COALESCE(s.refreshed_at AT TIME ZONE 'UTC', s.updated_at, s.created_at) AS last_seen_at,
    s.user_agent,
    host(s.ip) AS ip,
    (s.id::text = (auth.jwt() ->> 'session_id')) AS is_current
  FROM auth.sessions s
  WHERE s.user_id = auth.uid()
  ORDER BY (s.id::text = (auth.jwt() ->> 'session_id')) DESC, s.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.revoke_my_session(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  -- Current session is excluded: signing yourself out goes through
  -- supabase.auth.signOut() so the client clears its own state.
  DELETE FROM auth.sessions
   WHERE id = p_session_id
     AND user_id = auth.uid()
     AND id::text <> (auth.jwt() ->> 'session_id')
  RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_my_other_sessions()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM auth.sessions
   WHERE user_id = auth.uid()
     AND id::text <> (auth.jwt() ->> 'session_id');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_sessions() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_my_session(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_my_other_sessions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_sessions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_my_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_my_other_sessions() TO authenticated;
