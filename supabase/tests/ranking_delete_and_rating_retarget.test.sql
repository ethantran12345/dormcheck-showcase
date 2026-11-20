-- covers: 20260901000004_security_ranking_delete_and_rating_retarget.sql
-- Probe for 20260901000004_security_ranking_delete_and_rating_retarget:
--  1. A PENDING ranking invitee cannot delete the group; an ACCEPTED member and
--     the owner can. (get_my_all_group_ids() deliberately includes pending, so
--     the delete policy must use get_my_accepted_group_ids() instead.)
--  2. A rater cannot retarget an existing rating at a different seller by
--     updating seller_id — the WITH CHECK constrained rater_id only, so the
--     freeze is enforced by trigger.
-- Rolled back at the end.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/ranking_delete_and_rating_retarget.test.sql

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


INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('51111111-aaaa-4aaa-8aaa-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL), -- Owner
  ('52222222-bbbb-4bbb-8bbb-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL), -- Pending invitee
  ('53333333-cccc-4ccc-8ccc-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL), -- Accepted member
  ('54444444-dddd-4ddd-8ddd-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)  -- Other seller
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, full_name, university_id) VALUES
  ('51111111-aaaa-4aaa-8aaa-111111111111', 'RDR Owner',    '00000000-0000-4000-8000-000000000001'),
  ('52222222-bbbb-4bbb-8bbb-222222222222', 'RDR Pending',  '00000000-0000-4000-8000-000000000001'),
  ('53333333-cccc-4ccc-8ccc-333333333333', 'RDR Accepted', '00000000-0000-4000-8000-000000000001'),
  ('54444444-dddd-4ddd-8ddd-444444444444', 'RDR Other',    '00000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO UPDATE SET university_id = EXCLUDED.university_id;

-- Two identical groups so the pending-invitee denial and the accepted-member
-- allowance are tested independently (a delete consumes its row).
INSERT INTO public.ranking_collaborations (id, owner_id, status, group_name, university_id) VALUES
  ('99000051-0000-4000-8000-000000000001', '51111111-aaaa-4aaa-8aaa-111111111111', 'active', 'rdr group A', '00000000-0000-4000-8000-000000000001'),
  ('99000051-0000-4000-8000-000000000002', '51111111-aaaa-4aaa-8aaa-111111111111', 'active', 'rdr group B', '00000000-0000-4000-8000-000000000001');

INSERT INTO public.ranking_group_members (group_id, user_id, status) VALUES
  ('99000051-0000-4000-8000-000000000001', '52222222-bbbb-4bbb-8bbb-222222222222', 'pending'),
  ('99000051-0000-4000-8000-000000000001', '53333333-cccc-4ccc-8ccc-333333333333', 'accepted'),
  ('99000051-0000-4000-8000-000000000002', '52222222-bbbb-4bbb-8bbb-222222222222', 'pending');

-- Rating fixture: Alice-as-rater has an accepted conversation with the seller.
INSERT INTO public.conversations (participant_1, participant_2, status) VALUES
  ('51111111-aaaa-4aaa-8aaa-111111111111', '53333333-cccc-4ccc-8ccc-333333333333', 'accepted');
INSERT INTO public.seller_ratings (id, rater_id, seller_id, stars) VALUES
  ('99000052-0000-4000-8000-000000000001', '51111111-aaaa-4aaa-8aaa-111111111111',
   '53333333-cccc-4ccc-8ccc-333333333333', 5);

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
  owner_u    uuid := '51111111-aaaa-4aaa-8aaa-111111111111';
  pending_u  uuid := '52222222-bbbb-4bbb-8bbb-222222222222';
  accepted_u uuid := '53333333-cccc-4ccc-8ccc-333333333333';
  other_u    uuid := '54444444-dddd-4ddd-8ddd-444444444444';
  n int;
  v_seller uuid;
  v_stars int;
BEGIN
  -- 1. A PENDING invitee cannot delete the group.
  PERFORM pg_temp._as_user(pending_u);
  DELETE FROM public.ranking_collaborations WHERE id = '99000051-0000-4000-8000-000000000001';
  PERFORM pg_temp._assume('postgres');
  SELECT count(*) INTO n FROM public.ranking_collaborations WHERE id = '99000051-0000-4000-8000-000000000001';
  PERFORM pg_temp._assert('ranking: pending invitee CANNOT delete the group', n = 1);

  -- 2. An ACCEPTED member still can (unchanged behavior).
  PERFORM pg_temp._as_user(accepted_u);
  DELETE FROM public.ranking_collaborations WHERE id = '99000051-0000-4000-8000-000000000001';
  PERFORM pg_temp._assume('postgres');
  SELECT count(*) INTO n FROM public.ranking_collaborations WHERE id = '99000051-0000-4000-8000-000000000001';
  PERFORM pg_temp._assert('ranking: accepted member CAN delete the group', n = 0);

  -- 3. The owner can delete a group with only pending invitees.
  PERFORM pg_temp._as_user(owner_u);
  DELETE FROM public.ranking_collaborations WHERE id = '99000051-0000-4000-8000-000000000002';
  PERFORM pg_temp._assume('postgres');
  SELECT count(*) INTO n FROM public.ranking_collaborations WHERE id = '99000051-0000-4000-8000-000000000002';
  PERFORM pg_temp._assert('ranking: owner CAN delete own group', n = 0);

  -- 4. Retargeting a rating at a different seller is a no-op (seller frozen).
  PERFORM pg_temp._as_user(owner_u);
  UPDATE public.seller_ratings
     SET seller_id = other_u, stars = 1
   WHERE id = '99000052-0000-4000-8000-000000000001';
  PERFORM pg_temp._assume('postgres');
  SELECT seller_id, stars INTO v_seller, v_stars
    FROM public.seller_ratings WHERE id = '99000052-0000-4000-8000-000000000001';
  PERFORM pg_temp._assert('rating: seller_id frozen against retarget', v_seller = accepted_u);
  PERFORM pg_temp._assert('rating: benign star edit still applies', v_stars = 1);

  PERFORM pg_temp._assume('postgres');
END $$;

ROLLBACK;
