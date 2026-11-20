-- covers: 20260825000000_dm_message_metadata_and_photos.sql
-- Probe for 20260825000000_dm_message_metadata_and_photos.
--
-- That migration does two things with an RLS surface, and this probe covers both
-- because they fail in different ways:
--
--   1. THE dm-photos BUCKET adds three NEW policies on storage.objects, all of
--      the own-folder shape `auth.uid()::text = (storage.foldername(name))[1]`.
--      The bucket is deliberately PUBLIC-READ (stated tradeoff in the migration
--      header: no signing path exists today), so read is NOT the control here --
--      WRITE confinement is the entire guard. If the folder predicate regresses,
--      one student can write, overwrite, or delete photos under another student's
--      prefix, and public read means whatever they plant is world-reachable.
--      INSERT is proven BEHAVIOURALLY, in both directions: a cross-folder write
--      is denied, and the caller's own-folder write still succeeds.
--
--      UPDATE and DELETE are proven STRUCTURALLY instead, and the distinction is
--      deliberate rather than lazy. Neither is reachable from SQL:
--        · DELETE — a `storage.protect_delete()` trigger raises on ANY direct
--          `DELETE FROM storage.objects` ("Use the Storage API instead"), so the
--          statement never reaches the RLS predicate.
--        · UPDATE — the only SELECT policy on storage.objects is
--          `lv_storage_select_own_or_admin` (listing verifications). An
--          authenticated caller therefore cannot SEE a dm-photos row in SQL, and
--          an UPDATE that matches no visible row changes nothing WHETHER OR NOT
--          the policy is doing anything. Public read of this bucket is served by
--          the Storage API off the bucket's `public` flag, not by RLS.
--      This was found the hard way: the first version of this probe asserted
--      "cross-folder UPDATE changes nothing", it passed, and it would have kept
--      passing with the UPDATE policy DELETED. A green assertion that cannot fail
--      is worse than no assertion, because it is counted as coverage. So those
--      two are asserted against the catalog (policy present, predicate still
--      own-folder), which does catch the realistic regression -- someone dropping
--      or loosening the policy -- and claims nothing more than that.
--
--   2. THE messages.metadata COLUMN ships with no policy of its own. The
--      migration's explicit claim is "no policy changes because the column
--      inherits the row's RLS". That is the kind of claim that is true when
--      written and silently false later -- a column-level GRANT, a definer view,
--      or a projection table can re-expose it without touching any policy. So
--      the claim is asserted rather than trusted: a non-participant selecting the
--      message gets zero rows, INCLUDING its metadata, while a participant reads
--      the payload back intact.
--
-- Rolled back at the end.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/dm_message_metadata_and_photos.test.sql

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
VALUES
  ('00000000-0000-4000-8000-000000000001', 'pitt', 'University of Pittsburgh', 'Pitt',
   ARRAY['pitt.edu'], true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('71111111-aaaa-4aaa-8aaa-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL), -- Sender (participant)
  ('72222222-bbbb-4bbb-8bbb-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL), -- Recipient (participant)
  ('73333333-cccc-4ccc-8ccc-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)  -- Outsider (not in the conversation)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, full_name, university_id) VALUES
  ('71111111-aaaa-4aaa-8aaa-111111111111', 'DM Sender',    '00000000-0000-4000-8000-000000000001'),
  ('72222222-bbbb-4bbb-8bbb-222222222222', 'DM Recipient', '00000000-0000-4000-8000-000000000001'),
  ('73333333-cccc-4ccc-8ccc-333333333333', 'DM Outsider',  '00000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO UPDATE SET university_id = EXCLUDED.university_id;

-- Seeded as postgres so RLS stays out of the fixtures' way.
INSERT INTO public.conversations (id, participant_1, participant_2, status) VALUES
  ('79000071-0000-4000-8000-000000000001',
   '71111111-aaaa-4aaa-8aaa-111111111111',
   '72222222-bbbb-4bbb-8bbb-222222222222',
   'accepted');  -- conversations_status_check allows only 'pending' | 'accepted'

-- A DM carrying a metadata payload: exactly the shape the migration introduced.
INSERT INTO public.messages (id, conversation_id, sender_id, content, metadata) VALUES
  (7900000000000071,
   '79000071-0000-4000-8000-000000000001',
   '71111111-aaaa-4aaa-8aaa-111111111111',
   'sent you a photo',
   '{"type":"image","url":"dm-photos/71111111-aaaa-4aaa-8aaa-111111111111/probe.jpg"}'::jsonb);

CREATE OR REPLACE FUNCTION pg_temp._as_user(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp._assert(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('postgres');
  IF cond IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: %', label;
  END IF;
  RAISE NOTICE 'ok: %', label;
END $$;

DO $$
DECLARE
  sender_u    uuid := '71111111-aaaa-4aaa-8aaa-111111111111';
  recipient_u uuid := '72222222-bbbb-4bbb-8bbb-222222222222';
  outsider_u  uuid := '73333333-cccc-4ccc-8ccc-333333333333';
  msg_id      bigint := 7900000000000071;
  n int;
  v_meta jsonb;
  denied boolean;
BEGIN
  -- ── 1. messages.metadata inherits the row's RLS ──────────────────────────
  -- Outsider sees NO row at all, so there is no path to the metadata payload.
  PERFORM pg_temp._as_user(outsider_u);
  SELECT count(*) INTO n FROM public.messages WHERE id = msg_id;
  PERFORM pg_temp._assert('dm: outsider cannot read the message row', n = 0);

  PERFORM pg_temp._as_user(outsider_u);
  SELECT count(*) INTO n FROM public.messages WHERE id = msg_id AND metadata IS NOT NULL;
  PERFORM pg_temp._assert('dm: outsider cannot read metadata', n = 0);

  -- The recipient (the other participant) reads the payload back intact --
  -- proving the gate above is a real predicate and not a broken query.
  PERFORM pg_temp._as_user(recipient_u);
  SELECT metadata INTO v_meta FROM public.messages WHERE id = msg_id;
  PERFORM pg_temp._assert('dm: participant reads metadata intact',
    v_meta ->> 'type' = 'image');

  -- ── 2. dm-photos own-folder write confinement ────────────────────────────
  -- The recipient may not write into the SENDER's folder.
  PERFORM pg_temp._as_user(recipient_u);
  denied := false;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner, owner_id)
    VALUES ('dm-photos', sender_u::text || '/planted.jpg', recipient_u, recipient_u::text);
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM pg_temp._assert('dm-photos: cross-folder INSERT denied', denied);

  -- Own folder still works (the guard must not be a blanket deny).
  PERFORM pg_temp._as_user(recipient_u);
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id)
  VALUES ('dm-photos', recipient_u::text || '/mine.jpg', recipient_u, recipient_u::text);
  PERFORM pg_temp._assume('postgres');
  SELECT count(*) INTO n FROM storage.objects
   WHERE bucket_id = 'dm-photos' AND name = recipient_u::text || '/mine.jpg';
  PERFORM pg_temp._assert('dm-photos: own-folder INSERT succeeds', n = 1);

  -- ── 3. UPDATE / DELETE: structural assertion, NOT behavioural ────────────
  -- See the header. These two cannot be exercised from SQL, so what is checked
  -- is that each policy still EXISTS and still carries the own-folder predicate.
  -- That catches the realistic regression (a policy dropped or its predicate
  -- loosened) without pretending to have proven runtime behaviour.
  PERFORM pg_temp._assume('postgres');

  SELECT count(*) INTO n FROM pg_policy
   WHERE polrelid = 'storage.objects'::regclass
     AND polname = 'Users can update own dm photos'
     AND pg_get_expr(polqual, polrelid) LIKE '%dm-photos%'
     AND pg_get_expr(polqual, polrelid) LIKE '%foldername%'
     AND pg_get_expr(polwithcheck, polrelid) LIKE '%foldername%';
  PERFORM pg_temp._assert('dm-photos: UPDATE policy present with own-folder predicate on USING and WITH CHECK', n = 1);

  SELECT count(*) INTO n FROM pg_policy
   WHERE polrelid = 'storage.objects'::regclass
     AND polname = 'Users can delete own dm photos'
     AND pg_get_expr(polqual, polrelid) LIKE '%dm-photos%'
     AND pg_get_expr(polqual, polrelid) LIKE '%foldername%';
  PERFORM pg_temp._assert('dm-photos: DELETE policy present with own-folder predicate', n = 1);

  -- The bucket is public-read BY DESIGN (migration header). Pin that it is not
  -- silently flipped private, which would break every rendered DM photo, and
  -- equally that its size/MIME limits survive -- they are the only thing standing
  -- between "photo bucket" and "arbitrary file host".
  SELECT count(*) INTO n FROM storage.buckets
   WHERE id = 'dm-photos' AND public IS true AND file_size_limit = 10485760;
  PERFORM pg_temp._assert('dm-photos: bucket still public-read with a 10MB cap', n = 1);

  PERFORM pg_temp._assume('postgres');
END $$;

ROLLBACK;
