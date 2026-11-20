-- covers: 20260821000000_message_reactions.sql
-- RLS probe for emoji reactions (public.message_reactions + group_message_reactions).
-- Asserts that a non-participant / non-member can neither SEE nor INSERT a reaction on
-- either table, while the participant/member can — the exact membership predicates the
-- parent message tables already enforce. Everything runs inside a rolled-back transaction.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/message_reactions_rls.test.sql

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


-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- Null-email throwaway users (null email skips the signup domain gate).
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('aaaaaaaa-0000-4000-8000-00000000aaaa', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('bbbbbbbb-0000-4000-8000-00000000bbbb', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('cccccccc-0000-4000-8000-00000000cccc', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, full_name, university_id) VALUES
  ('aaaaaaaa-0000-4000-8000-00000000aaaa', 'React A', '00000000-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-00000000bbbb', 'React B', '00000000-0000-4000-8000-000000000001'),
  ('cccccccc-0000-4000-8000-00000000cccc', 'React C', '00000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- DM thread A<->B and a message; group thread with only A as member.
INSERT INTO public.conversations (id, participant_1, participant_2, status)
  VALUES ('dddddddd-0000-4000-8000-00000000dddd',
          'aaaaaaaa-0000-4000-8000-00000000aaaa', 'bbbbbbbb-0000-4000-8000-00000000bbbb', 'accepted');

-- One DM message from A in that conversation (bigint identity id captured below).
INSERT INTO public.messages (conversation_id, sender_id, content)
  VALUES ('dddddddd-0000-4000-8000-00000000dddd',
          'aaaaaaaa-0000-4000-8000-00000000aaaa', 'dm');

INSERT INTO public.group_conversations (id, name, created_at, updated_at, created_by)
  VALUES ('eeeeeeee-0000-4000-8000-00000000eeee', 'reaction probe', now(), now(),
          'aaaaaaaa-0000-4000-8000-00000000aaaa');
INSERT INTO public.group_members (group_id, user_id)
  VALUES ('eeeeeeee-0000-4000-8000-00000000eeee', 'aaaaaaaa-0000-4000-8000-00000000aaaa');
INSERT INTO public.group_messages (id, group_id, sender_id, content)
  VALUES ('ffffffff-0000-4000-8000-00000000ffff', 'eeeeeeee-0000-4000-8000-00000000eeee',
          'aaaaaaaa-0000-4000-8000-00000000aaaa', 'gm');

-- ── Harness ──────────────────────────────────────────────────────────────────
CREATE TEMP TABLE test_results (name text, pass boolean, detail text);

CREATE OR REPLACE FUNCTION pg_temp._assert(label text, cond boolean, detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO test_results VALUES (label, cond, detail);
  IF NOT cond THEN RAISE NOTICE 'FAIL: % - %', label, detail;
  ELSE RAISE NOTICE 'PASS: %', label; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp._count_as(p_uid uuid, p_sql text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') s' INTO n;
  PERFORM pg_temp._assume('postgres');
  RETURN n;
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp._assume('postgres'); RAISE;
END;
$$;

-- Returns SQLERRM if the statement is rejected (RLS deny), NULL if it succeeds.
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

-- ── Assertions ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  a uuid := 'aaaaaaaa-0000-4000-8000-00000000aaaa';
  c uuid := 'cccccccc-0000-4000-8000-00000000cccc';
  conv text := 'dddddddd-0000-4000-8000-00000000dddd';
  grp  text := 'eeeeeeee-0000-4000-8000-00000000eeee';
  gmsg text := 'ffffffff-0000-4000-8000-00000000ffff';
  msgid bigint;
BEGIN
  -- Message id is a bigint identity; capture the row we just seeded.
  SELECT id INTO msgid FROM public.messages
    WHERE conversation_id = conv::uuid ORDER BY id DESC LIMIT 1;

  -- Seed one reaction from A on each table (as owner/postgres, bypassing RLS).
  INSERT INTO public.message_reactions (message_id, conversation_id, user_id, emoji)
    VALUES (msgid, conv::uuid, a, U&'\+01F44D');
  INSERT INTO public.group_message_reactions (message_id, group_id, user_id, emoji)
    VALUES (gmsg::uuid, grp::uuid, a, U&'\+01F44D');

  -- SELECT visibility
  PERFORM pg_temp._assert('dm: member A sees the reaction',
    pg_temp._count_as(a, 'SELECT 1 FROM public.message_reactions WHERE conversation_id = '''||conv||'''') >= 1);
  PERFORM pg_temp._assert('dm: outsider C sees zero reactions',
    pg_temp._count_as(c, 'SELECT 1 FROM public.message_reactions WHERE conversation_id = '''||conv||'''') = 0);
  PERFORM pg_temp._assert('group: member A sees the reaction',
    pg_temp._count_as(a, 'SELECT 1 FROM public.group_message_reactions WHERE group_id = '''||grp||'''') >= 1);
  PERFORM pg_temp._assert('group: outsider C sees zero reactions',
    pg_temp._count_as(c, 'SELECT 1 FROM public.group_message_reactions WHERE group_id = '''||grp||'''') = 0);

  -- INSERT deny for the outsider on both tables
  PERFORM pg_temp._assert('dm: outsider C cannot insert a reaction',
    pg_temp._exec_as(c, 'INSERT INTO public.message_reactions (message_id, conversation_id, user_id, emoji) VALUES ('||msgid||', '''||conv||''', '''||c||''', ''x'')') IS NOT NULL);
  PERFORM pg_temp._assert('group: outsider C cannot insert a reaction',
    pg_temp._exec_as(c, 'INSERT INTO public.group_message_reactions (message_id, group_id, user_id, emoji) VALUES ('''||gmsg||''', '''||grp||''', '''||c||''', ''x'')') IS NOT NULL);

  -- INSERT allowed for the member
  PERFORM pg_temp._assert('dm: member A can insert a reaction',
    pg_temp._exec_as(a, 'INSERT INTO public.message_reactions (message_id, conversation_id, user_id, emoji) VALUES ('||msgid||', '''||conv||''', '''||a||''', ''y'')') IS NULL);
END $$;

-- ── Verdict ──────────────────────────────────────────────────────────────────
DO $$
DECLARE failed int;
BEGIN
  SELECT count(*) INTO failed FROM test_results WHERE NOT pass;
  IF failed > 0 THEN
    RAISE EXCEPTION 'message_reactions RLS test: % assertion(s) failed', failed;
  END IF;
  RAISE NOTICE 'message_reactions RLS test: all % assertions passed', (SELECT count(*) FROM test_results);
END $$;

ROLLBACK;
