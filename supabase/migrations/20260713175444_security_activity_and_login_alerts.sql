-- Settings R4: deepen the Security section.
--   1. get_my_security_events() - a read-only, caller-scoped feed of REAL
--      security activity (SECURITY DEFINER over auth-schema tables, strictly
--      filtered to auth.uid(), mirroring get_my_sessions from 20260712120000).
--      Sources, all real, never fabricated:
--        - auth.sessions        -> one "sign_in" event per device sign-in
--                                  (created_at + ip + user_agent). This is the
--                                  populated source today.
--        - auth.audit_log_entries -> password changes / recovery / re-auth etc.
--                                  GoTrue's audit log is NOT persisted on this
--                                  project (0 rows as of 2026-07-13, 79 users),
--                                  so this branch returns nothing today but
--                                  lights up automatically if/when audit
--                                  logging is enabled or backfilled. No empty
--                                  history is faked - the UI shows an honest
--                                  empty state and last_sign_in_at as the
--                                  guaranteed-real anchor.
--   2. profiles.login_alerts - a per-user boolean for "email me when a new
--      device signs in." STORES the preference only. The send path (new-device
--      detection + Resend email) is deliberately NOT wired in this chunk: it
--      needs a trigger on auth.sessions INSERT, which gates EVERY sign-in, so
--      it requires its own careful expand/contract rollout + owner sign-off
--      (high stakes during the Pitt IT security review). See TODO(login-alerts-send).
-- Expand-only. PROD APPLY: via Supabase MCP apply_migration, after 20260731060000.

-- ── 1. Login-alerts preference (send path stubbed - see header) ──────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS login_alerts boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.login_alerts IS
  'Settings R4: opt-in to a "new device signed in" email. Preference storage only; '
  'send path (auth.sessions new-device trigger + Resend) is a follow-up. '
  'TODO(login-alerts-send).';

-- ── 2. Caller-scoped security activity feed ──────────────────────────────────
-- Returns jsonb: { last_sign_in_at: timestamptz|null, events: [ {id,type,ip,user_agent,created_at} ] }
-- Every branch filters on auth.uid(); a caller can never read another user's rows.
CREATE OR REPLACE FUNCTION public.get_my_security_events()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH me AS (
    SELECT auth.uid() AS id
  ),
  session_events AS (
    SELECT
      s.id::text                                  AS id,
      'sign_in'::text                             AS type,
      host(s.ip)                                  AS ip,
      s.user_agent                                AS user_agent,
      s.created_at                                AS created_at
    FROM auth.sessions s, me
    WHERE me.id IS NOT NULL AND s.user_id = me.id
  ),
  audit_events AS (
    SELECT
      a.id::text                                  AS id,
      COALESCE(a.payload->>'action', 'activity')  AS type,
      NULLIF(a.ip_address, '')                    AS ip,
      NULL::text                                  AS user_agent,
      a.created_at                                AS created_at
    FROM auth.audit_log_entries a, me
    WHERE me.id IS NOT NULL AND (a.payload->>'actor_id') = me.id::text
  ),
  merged AS (
    SELECT * FROM session_events
    UNION ALL
    SELECT * FROM audit_events
    ORDER BY created_at DESC
    LIMIT 50
  )
  SELECT jsonb_build_object(
    'last_sign_in_at',
      (SELECT u.last_sign_in_at FROM auth.users u, me WHERE me.id IS NOT NULL AND u.id = me.id),
    'events',
      COALESCE(
        (SELECT jsonb_agg(jsonb_build_object(
           'id',         m.id,
           'type',       m.type,
           'ip',         m.ip,
           'user_agent', m.user_agent,
           'created_at', m.created_at
         ) ORDER BY m.created_at DESC)
         FROM merged m),
        '[]'::jsonb
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_security_events() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_my_security_events() TO authenticated;
