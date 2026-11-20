-- covers: 20260811205118_private_dm_audio_moderation_helper.sql
-- covers: 20260919000000_dm_audio_and_polls.sql
-- covers: 20260923000000_dm_poll_votes_index_and_initplan.sql
-- RLS probe for 20260919000000_dm_audio_and_polls,
-- 20260811205118_private_dm_audio_moderation_helper, and
-- 20260923000000_dm_poll_votes_index_and_initplan.
--
-- 20260923000000 rewrites all four dm_poll_votes policies from auth.uid() to
-- (select auth.uid()) — an InitPlan optimisation, not a rule change — and adds the
-- missing user_id FK index. It is covered here because the BEHAVIOURAL assertions
-- that must survive it (outsider cannot vote, participant can, out-of-range option
-- refused, other participant reads the live tally) are already in this file: that
-- is the whole point of calling a rewrite semantics-preserving, and a rewrite whose
-- own probe only checked the new spelling would prove nothing. The catalog
-- assertions at the end additionally pin the spelling and the index, so a
-- silent revert to the per-row form is caught too.
--
-- Both migrations declare the SAME end state and this one probe pins it, which
-- is why 20260811205118 is cited here rather than given a probe of its own.
-- 20260811205118 is the convergence migration: prod already had the helper in
-- the API-exposed `public` schema, so it moves the predicate into `private`,
-- recreates the "DM participants can read private audio" policy against
-- private.can_moderate_reported_dm_audio(), and drops the public overload.
-- 20260919000000 creates the same private function and the same policy from
-- zero. On a clean replay 20260811205118 sorts FIRST and 20260919000000
-- rewrites its objects; on prod the order was reversed. Either way the object
-- this file asserts on is the private-schema one, so the assertions below are
-- the coverage for both — the guard being proven is "the moderation predicate
-- is not callable from the API schema and only a reported, tenant-scoped
-- moderator gets the read".
--
-- Proves private audio is participant-only until a report grants the scoped
-- moderator exception, and that a DM poll vote cannot be read or forged by an
-- outsider. Run via npm run test:db.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp._assume(want text) RETURNS text LANGUAGE plpgsql AS $_assume$
BEGIN
  PERFORM set_config('session_authorization', NULL, true);
  PERFORM set_config('session_authorization',
    CASE WHEN want IN ('authenticated', 'anon', 'service_role') THEN 'authenticator' ELSE 'postgres' END, true);
  PERFORM set_config('role', want, true);
  RETURN want;
END $_assume$;

CREATE OR REPLACE FUNCTION pg_temp._as_user(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp._assert(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('postgres');
  IF cond IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
  RAISE NOTICE 'ok: %', label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp._exec_as(uid uuid, statement text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._as_user(uid);
  EXECUTE statement;
  PERFORM pg_temp._assume('postgres');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RETURN SQLERRM;
END $$;

SELECT pg_temp._assume('postgres');

INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active)
VALUES ('00000000-0000-4000-8000-000000000001', 'pitt', 'University of Pittsburgh', 'Pitt', ARRAY['pitt.edu'], true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('81111111-aaaa-4aaa-8aaa-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('82222222-bbbb-4bbb-8bbb-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('83333333-cccc-4ccc-8ccc-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('84444444-dddd-4ddd-8ddd-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)
ON CONFLICT (id) DO NOTHING;

-- `is_admin` is derived from app_role by the schema trigger; seed a genuine
-- university_admin rather than trying to write its derived boolean directly.
INSERT INTO public.profiles (id, full_name, university_id, role) VALUES
  ('81111111-aaaa-4aaa-8aaa-111111111111', 'Audio sender', '00000000-0000-4000-8000-000000000001', 'user'),
  ('82222222-bbbb-4bbb-8bbb-222222222222', 'Audio recipient', '00000000-0000-4000-8000-000000000001', 'user'),
  ('83333333-cccc-4ccc-8ccc-333333333333', 'Audio outsider', '00000000-0000-4000-8000-000000000001', 'user'),
  ('84444444-dddd-4ddd-8ddd-444444444444', 'Audio moderator', '00000000-0000-4000-8000-000000000001', 'university_admin')
ON CONFLICT (id) DO UPDATE
  SET university_id = EXCLUDED.university_id,
      role = EXCLUDED.role;

INSERT INTO public.conversations (id, participant_1, participant_2, status) VALUES
  ('89000081-0000-4000-8000-000000000001', '81111111-aaaa-4aaa-8aaa-111111111111', '82222222-bbbb-4bbb-8bbb-222222222222', 'accepted');

INSERT INTO public.messages (id, conversation_id, sender_id, content, metadata) VALUES
  (8900000000000081, '89000081-0000-4000-8000-000000000001', '81111111-aaaa-4aaa-8aaa-111111111111', 'Voice message',
   '{"type":"audio","path":"89000081-0000-4000-8000-000000000001/81111111-aaaa-4aaa-8aaa-111111111111/probe.m4a","durationMs":1200}'::jsonb),
  (8900000000000082, '89000081-0000-4000-8000-000000000001', '81111111-aaaa-4aaa-8aaa-111111111111', 'Poll: dinner?',
   '{"type":"poll","question":"Dinner?","options":["Five","Six"]}'::jsonb);

INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES
  ('dm-audio', '89000081-0000-4000-8000-000000000001/81111111-aaaa-4aaa-8aaa-111111111111/probe.m4a',
   '81111111-aaaa-4aaa-8aaa-111111111111', '81111111-aaaa-4aaa-8aaa-111111111111');

DO $$
DECLARE
  sender_u uuid := '81111111-aaaa-4aaa-8aaa-111111111111';
  recipient_u uuid := '82222222-bbbb-4bbb-8bbb-222222222222';
  outsider_u uuid := '83333333-cccc-4ccc-8ccc-333333333333';
  admin_u uuid := '84444444-dddd-4ddd-8ddd-444444444444';
  conv uuid := '89000081-0000-4000-8000-000000000001';
  audio_message bigint := 8900000000000081;
  poll_message bigint := 8900000000000082;
  audio_path text := '89000081-0000-4000-8000-000000000001/81111111-aaaa-4aaa-8aaa-111111111111/probe.m4a';
  report_id uuid;
  n int;
  err text;
  is_admin boolean;
  moderator_university uuid;
  sender_university uuid;
  can_review boolean;
BEGIN
  PERFORM pg_temp._as_user(recipient_u);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'dm-audio' AND name = audio_path;
  PERFORM pg_temp._assert('dm-audio: participant can read private object', n = 1);

  PERFORM pg_temp._as_user(outsider_u);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'dm-audio' AND name = audio_path;
  PERFORM pg_temp._assert('dm-audio: outsider cannot read private object', n = 0);

  err := pg_temp._exec_as(outsider_u,
    format('INSERT INTO public.dm_poll_votes (message_id, conversation_id, user_id, option_index) VALUES (%s, %L, %L, 0)', poll_message, conv, outsider_u));
  PERFORM pg_temp._assert('dm-poll: outsider cannot insert a vote', err IS NOT NULL);

  err := pg_temp._exec_as(recipient_u,
    format('INSERT INTO public.dm_poll_votes (message_id, conversation_id, user_id, option_index) VALUES (%s, %L, %L, 1)', poll_message, conv, recipient_u));
  PERFORM pg_temp._assert('dm-poll: participant can vote', err IS NULL);

  PERFORM pg_temp._as_user(sender_u);
  SELECT count(*) INTO n FROM public.dm_poll_votes WHERE message_id = poll_message AND option_index = 1;
  PERFORM pg_temp._assert('dm-poll: other participant reads live vote', n = 1);

  err := pg_temp._exec_as(recipient_u,
    format('UPDATE public.dm_poll_votes SET option_index = 5 WHERE message_id = %s AND user_id = %L', poll_message, recipient_u));
  PERFORM pg_temp._assert('dm-poll: out-of-range option update denied', err IS NOT NULL);

  SELECT report_uuid INTO report_id FROM public.messages WHERE id = audio_message;
  INSERT INTO public.content_reports (content_type, content_id, reporter_id, reason)
  VALUES ('dm_message', report_id, recipient_u, 'Needs review');

  PERFORM pg_temp._as_user(admin_u);
  SELECT p.is_admin, public.current_university_id(), public.profile_university(sender_u),
         private.can_moderate_reported_dm_audio(audio_path)
    INTO is_admin, moderator_university, sender_university, can_review
  FROM public.profiles p
  WHERE p.id = auth.uid();
  PERFORM pg_temp._assert('dm-audio: moderator has the expected admin role', is_admin IS true);
  PERFORM pg_temp._assert('dm-audio: moderator and sender share a university', moderator_university = sender_university);
  PERFORM pg_temp._assert('dm-audio: report-gated moderation helper authorizes the object', can_review IS true);

  PERFORM pg_temp._as_user(admin_u);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'dm-audio' AND name = audio_path;
  PERFORM pg_temp._assert('dm-audio: reported object is readable by the scoped moderator', n = 1);

  -- 20260811205118_private_dm_audio_moderation_helper's own claim: the predicate
  -- lives in `private`, NOT in the API-exposed `public` schema, and anon can
  -- reach neither the schema nor the function. Asserted on the catalog because
  -- the absence of a public overload is not observable from a successful call to
  -- the private one — and a `public.` overload is exactly what a PostgREST
  -- caller could invoke as an RPC.
  PERFORM pg_temp._assume('postgres');
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE p.proname = 'can_moderate_reported_dm_audio' AND ns.nspname = 'public';
  PERFORM pg_temp._assert('dm-audio: no public.can_moderate_reported_dm_audio overload survives', n = 0);

  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE p.proname = 'can_moderate_reported_dm_audio' AND ns.nspname = 'private';
  PERFORM pg_temp._assert('dm-audio: the moderation predicate lives in private', n = 1);

  SELECT has_function_privilege('anon', 'private.can_moderate_reported_dm_audio(text)', 'EXECUTE')
    INTO is_admin;
  PERFORM pg_temp._assert('dm-audio: anon cannot execute the moderation predicate', is_admin IS false);

  SELECT has_function_privilege('authenticated', 'private.can_moderate_reported_dm_audio(text)', 'EXECUTE')
    INTO can_review;
  PERFORM pg_temp._assert('dm-audio: authenticated CAN execute it (the policy evaluates as the caller)',
    can_review IS true);

  -- Deliberately NOT asserted: "anon has no USAGE on schema private". Checked
  -- against prod 2026-08-16 and anon DOES hold schema USAGE there — correctly, because
  -- private.marketplace_public and private.seller_rating_stats grant anon SELECT and
  -- an object grant is unusable without schema USAGE. The `private` schema is
  -- "not API-exposed", not "anon-free"; the boundary that matters for this
  -- migration is the per-object EXECUTE asserted above, and anon holds none.

  -- 20260923000000_dm_poll_votes_index_and_initplan: the FK index exists, and no
  -- dm_poll_votes policy still calls auth.uid() in the per-row form. The behaviour
  -- assertions above are the real coverage; these two stop a silent revert.
  PERFORM pg_temp._assume('postgres');
  SELECT count(*) INTO n FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'dm_poll_votes'
     AND indexdef LIKE '%(user_id)';
  PERFORM pg_temp._assert('dm-poll: user_id has its own FK index (advisor #198)', n >= 1);

  -- pg_get_expr renders the wrapped form as "( SELECT auth.uid() AS uid)", so a
  -- naive search for "auth.uid()" matches BOTH forms. Strip the wrapped
  -- occurrences first; anything still standing is a bare per-row call.
  SELECT count(*) INTO n
    FROM pg_policy pp JOIN pg_class c ON c.oid = pp.polrelid
   WHERE c.relname = 'dm_poll_votes'
     AND (
       replace(coalesce(pg_get_expr(pp.polqual, pp.polrelid), ''),
               'SELECT auth.uid()', '') LIKE '%auth.uid()%'
       OR replace(coalesce(pg_get_expr(pp.polwithcheck, pp.polrelid), ''),
                  'SELECT auth.uid()', '') LIKE '%auth.uid()%'
     );
  PERFORM pg_temp._assert('dm-poll: every policy uses the InitPlan (select auth.uid()) form (advisors #199-#202)',
    n = 0);

  SELECT count(*) INTO n FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'dm_poll_votes';
  PERFORM pg_temp._assert('dm-poll: realtime publication includes votes', n = 1);
END $$;

ROLLBACK;
