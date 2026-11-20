-- covers: 20260830010000_block_enforcement_reactions_comments.sql
-- covers: 20260905000000_rls_initplan_block_checks.sql
-- P0-2 (security review 2026-08-01): block enforcement must extend past DMs to
-- reactions and setup comments (migration 20260830010000). A blocked user must
-- not be able to INSERT a reaction on the blocker's DM/group message, nor a
-- comment on the blocker's room setup, via a direct call. A non-blocked
-- participant/member still can. Inside a rolled-back transaction.
--
-- ALSO COVERS 20260905000000_rls_initplan_block_checks, which rewrites these two
-- exact policies (rls_setup_comments_insert_block_check and
-- rls_group_message_reactions_insert_block_check) to hoist `auth.uid()` into an
-- InitPlan via `(select auth.uid())`. That rewrite is meant to be SEMANTICS-
-- PRESERVING -- planner shape only, identical rows -- and this probe is exactly
-- how that claim is checked: the same four behavioural assertions (blocked denied,
-- non-blocked allowed, on both tables) must pass unchanged before and after. A
-- second probe asserting the same behaviour would add no information; what the
-- rewrite needed was not new coverage but proof that existing coverage still
-- holds. Re-run green against the rewritten policies on 2026-08-05.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/block_enforcement_reactions_comments.test.sql

BEGIN;

-- ── harness role fidelity (docs/security/reaudit-2026-08-06.md H1) ──────────────────────────
-- PostgREST connects as session_user='authenticator' and SET ROLEs to authenticated/anon.
-- `set_config('role', …)` changes current_user but NOT session_user, so under the old idiom
-- session_user stayed superuser — and three shipped triggers (protect_profile_role,
-- protect_profile_is_admin, protect_listing_verified_at) EXEMPT session_user IN
-- ('postgres','supabase_admin'). A plain user's own row took role='superadmin' under the
-- harness and was refused through the real client path: the probe would have passed for the
-- wrong reason, in the direction that says "wide open" about a schema that is sound.
-- pg_temp._assume() reproduces the real client identity — session authorization AND role.
-- Do not go back to set_config('role', …); supabase/tests/harness_role_fidelity.test.sql
-- fails the suite the moment this idiom stops yielding session_user='authenticator'.
CREATE OR REPLACE FUNCTION pg_temp._assume(want text) RETURNS text LANGUAGE plpgsql AS $_assume$
BEGIN
  -- Step back to the connection's own login role first: from 'authenticator' nothing else
  -- is permitted. NULL resets the GUC, so this works whatever the runner connected as.
  PERFORM set_config('session_authorization', NULL, true);
  -- 'postgres' is the identity the seeding phases have always run under, and the one the
  -- three guards exempt, so seeding behaviour is unchanged. Everything else gets the real
  -- client shape: session_user='authenticator', which is NOT exempt.
  PERFORM set_config(
    'session_authorization',
    CASE WHEN want IN ('authenticated', 'anon', 'service_role') THEN 'authenticator' ELSE 'postgres' END,
    true);
  PERFORM set_config('role', want, true);
  RETURN want;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION USING
    MESSAGE = format('pg_temp._assume(%L) needs a SUPERUSER connection; this one is %I.', want, session_user),
    HINT = 'Run the suite through scripts/test-db.sh, which connects as supabase_admin. A '
           'postgres connection cannot set session_authorization, so the harness cannot '
           'reproduce a real client identity and every guard keyed on session_user would be '
           'silently exempt - the failure this helper exists to prevent.';
END $_assume$;

-- Baseline: seeding below runs as session_user='postgres', exactly as it did before this
-- helper existed. Transaction-local on purpose - a session-level set would drop superuser
-- for the whole connection and make the authenticator switch impossible.
SELECT pg_temp._assume('postgres');


INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active)
VALUES ('00000000-0000-4000-8000-000000000001', 'pitt', 'University of Pittsburgh', 'Pitt',
        ARRAY['pitt.edu'], true)
ON CONFLICT (id) DO NOTHING;

-- A blocks B. C is an unrelated third member.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('bbbbbbbb-0000-4000-8000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('cccccccc-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)
ON CONFLICT (id) DO NOTHING;
-- DO UPDATE, not DO NOTHING: a handle_new_user trigger on auth.users auto-creates
-- a null-university profile, so we must overwrite university_id here or
-- current_university_id() reads NULL and tenant_isolation rejects everything.
INSERT INTO public.profiles (id, full_name, university_id) VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'Block A', '00000000-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-0000000000b1', 'Block B', '00000000-0000-4000-8000-000000000001'),
  ('cccccccc-0000-4000-8000-0000000000c1', 'Block C', '00000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO UPDATE SET university_id = EXCLUDED.university_id;

INSERT INTO public.blocked_users (blocker_id, blocked_id)
  VALUES ('aaaaaaaa-0000-4000-8000-0000000000a1', 'bbbbbbbb-0000-4000-8000-0000000000b1');

-- DM thread A<->C (accepted) with a message from A; B is NOT a participant here,
-- so we test group + setup surfaces for B, and DM reactions between A and C stay allowed.
INSERT INTO public.conversations (id, participant_1, participant_2, status)
  VALUES ('dddddddd-0000-4000-8000-0000000000d1',
          'aaaaaaaa-0000-4000-8000-0000000000a1', 'cccccccc-0000-4000-8000-0000000000c1', 'accepted');
INSERT INTO public.messages (conversation_id, sender_id, content)
  VALUES ('dddddddd-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'dm');

-- Group with A and B both members; A sends a message. B is blocked by A.
INSERT INTO public.group_conversations (id, name, created_at, updated_at, created_by)
  VALUES ('eeeeeeee-0000-4000-8000-0000000000e1', 'block probe', now(), now(),
          'aaaaaaaa-0000-4000-8000-0000000000a1');
INSERT INTO public.group_members (group_id, user_id) VALUES
  ('eeeeeeee-0000-4000-8000-0000000000e1', 'aaaaaaaa-0000-4000-8000-0000000000a1'),
  ('eeeeeeee-0000-4000-8000-0000000000e1', 'bbbbbbbb-0000-4000-8000-0000000000b1'),
  ('eeeeeeee-0000-4000-8000-0000000000e1', 'cccccccc-0000-4000-8000-0000000000c1');
INSERT INTO public.group_messages (id, group_id, sender_id, content)
  VALUES ('ffffffff-0000-4000-8000-0000000000f1', 'eeeeeeee-0000-4000-8000-0000000000e1',
          'aaaaaaaa-0000-4000-8000-0000000000a1', 'gm');

-- A room setup owned by A.
INSERT INTO public.student_setups (id, dorm_name, image_url, user_id, university_id)
  VALUES (900001, 'Litchfield', 'https://example.com/x.jpg',
          'aaaaaaaa-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001');

CREATE TEMP TABLE test_results (name text, pass boolean, detail text);
CREATE OR REPLACE FUNCTION pg_temp._assert(label text, cond boolean, detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO test_results VALUES (label, cond, detail);
  IF NOT cond THEN RAISE NOTICE 'FAIL: % - %', label, detail;
  ELSE RAISE NOTICE 'PASS: %', label; END IF;
END;
$$;
CREATE OR REPLACE FUNCTION pg_temp._exec_as(p_uid uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  EXECUTE p_sql;
  PERFORM pg_temp._assume('postgres');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp._assume('postgres'); RETURN SQLERRM;
END;
$$;

DO $$
DECLARE
  b uuid := 'bbbbbbbb-0000-4000-8000-0000000000b1';
  c uuid := 'cccccccc-0000-4000-8000-0000000000c1';
  gmsg text := 'ffffffff-0000-4000-8000-0000000000f1';
  grp  text := 'eeeeeeee-0000-4000-8000-0000000000e1';
BEGIN
  -- Group reaction: blocked B cannot react to A's group message.
  PERFORM pg_temp._assert('blocked B cannot react to A group message',
    pg_temp._exec_as(b,
      'INSERT INTO public.group_message_reactions (message_id, group_id, user_id, emoji) VALUES ('''
      ||gmsg||''', '''||grp||''', '''||b||''', ''x'')') IS NOT NULL);

  -- Non-blocked C can react to the same group message.
  PERFORM pg_temp._assert('non-blocked C can react to A group message',
    pg_temp._exec_as(c,
      'INSERT INTO public.group_message_reactions (message_id, group_id, user_id, emoji) VALUES ('''
      ||gmsg||''', '''||grp||''', '''||c||''', ''y'')') IS NULL);

  -- Setup comment: blocked B cannot comment on A's setup.
  PERFORM pg_temp._assert('blocked B cannot comment on A setup',
    pg_temp._exec_as(b,
      'INSERT INTO public.setup_comments (setup_id, user_id, author_name, content) VALUES (900001, '''||b||''', ''X'', ''hi'')')
      IS NOT NULL);

  -- Non-blocked C can comment on A's setup.
  PERFORM pg_temp._assert('non-blocked C can comment on A setup',
    pg_temp._exec_as(c,
      'INSERT INTO public.setup_comments (setup_id, user_id, author_name, content) VALUES (900001, '''||c||''', ''X'', ''hi'')')
      IS NULL);
END $$;

DO $$
DECLARE fails int;
BEGIN
  SELECT count(*) INTO fails FROM test_results WHERE NOT pass;
  IF fails > 0 THEN
    RAISE EXCEPTION '% assertion(s) FAILED in block_enforcement_reactions_comments', fails;
  END IF;
  RAISE NOTICE 'ALL % assertions passed', (SELECT count(*) FROM test_results);
END $$;

ROLLBACK;
