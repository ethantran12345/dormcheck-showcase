-- covers: 20260901000006_security_group_dorm_rankings_write_scope.sql
-- Probe for 20260901000006_security_group_dorm_rankings_write_scope: every
-- write to group_dorm_rankings must be gated by ACCEPTED membership (or group
-- ownership) AND university, with a WITH CHECK that value-gates group_id and
-- dorm_id — not just row ownership. Guards are proven in BOTH directions:
-- each attack is shown to fail AND each legitimate path is shown to succeed.
--   Attacks: outsider insert, pending-invitee insert, cross-university
--   accepted member insert (membership passes, tenant gate must fire),
--   other-tenant dorm_id, nonexistent dorm_id, UPDATE retarget of group_id
--   into a group the writer does not belong to.
--   Legitimate: accepted-member insert/update/delete, owner insert,
--   pending-invitee SELECT (the read path get_my_all_group_ids exists for).
-- Rolled back at the end.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/group_dorm_rankings_write_scope.test.sql

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
   ARRAY['pitt.edu'], true),
  ('00000000-0000-4000-8000-0000000000c2', 'gdr-other', 'GDR Other University', 'GDRB',
   ARRAY['gdrb.test'], true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('61111111-aaaa-4aaa-8aaa-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL), -- Owner (uni1)
  ('62222222-bbbb-4bbb-8bbb-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL), -- Accepted member (uni1)
  ('63333333-cccc-4ccc-8ccc-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL), -- Pending invitee (uni1)
  ('64444444-dddd-4ddd-8ddd-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL), -- Outsider (uni2, no membership)
  ('65555555-eeee-4eee-8eee-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)  -- Cross-uni accepted member (uni2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, full_name, university_id) VALUES
  ('61111111-aaaa-4aaa-8aaa-111111111111', 'GDR Owner',    '00000000-0000-4000-8000-000000000001'),
  ('62222222-bbbb-4bbb-8bbb-222222222222', 'GDR Member',   '00000000-0000-4000-8000-000000000001'),
  ('63333333-cccc-4ccc-8ccc-333333333333', 'GDR Pending',  '00000000-0000-4000-8000-000000000001'),
  ('64444444-dddd-4ddd-8ddd-444444444444', 'GDR Outsider', '00000000-0000-4000-8000-0000000000c2'),
  ('65555555-eeee-4eee-8eee-555555555555', 'GDR CrossUni', '00000000-0000-4000-8000-0000000000c2')
ON CONFLICT (id) DO UPDATE SET university_id = EXCLUDED.university_id;

-- Dorms: three at uni1, one at uni2. Seeded as postgres (auth.uid() IS NULL),
-- so RLS stays out of the fixtures' way.
INSERT INTO public.master_housing (id, residence_hall, university_id) VALUES
  (990061, 'GDR Hall A',     '00000000-0000-4000-8000-000000000001'),
  (990063, 'GDR Hall B',     '00000000-0000-4000-8000-000000000001'),
  (990064, 'GDR Hall C',     '00000000-0000-4000-8000-000000000001'),
  (990062, 'GDR Rival Hall', '00000000-0000-4000-8000-0000000000c2')
ON CONFLICT (id) DO NOTHING;

-- G1: uni1 group. The cross-uni ACCEPTED membership is deliberately seeded as
-- postgres (bypassing rgm's tenant_confined INSERT policy) so the probe can
-- show the tenant gate firing where the membership gate alone would pass.
-- G2: a second uni1 group the accepted member does NOT belong to (retarget bait).
INSERT INTO public.ranking_collaborations (id, owner_id, status, group_name, university_id) VALUES
  ('99000061-0000-4000-8000-000000000001', '61111111-aaaa-4aaa-8aaa-111111111111', 'active', 'gdr group 1', '00000000-0000-4000-8000-000000000001'),
  ('99000061-0000-4000-8000-000000000002', '63333333-cccc-4ccc-8ccc-333333333333', 'active', 'gdr group 2', '00000000-0000-4000-8000-000000000001');

INSERT INTO public.ranking_group_members (group_id, user_id, status) VALUES
  ('99000061-0000-4000-8000-000000000001', '62222222-bbbb-4bbb-8bbb-222222222222', 'accepted'),
  ('99000061-0000-4000-8000-000000000001', '63333333-cccc-4ccc-8ccc-333333333333', 'pending'),
  ('99000061-0000-4000-8000-000000000001', '65555555-eeee-4eee-8eee-555555555555', 'accepted');

-- Pre-existing ranking row (update/retarget target).
INSERT INTO public.group_dorm_rankings (id, group_id, dorm_id, rank_order) VALUES
  ('99000062-0000-4000-8000-000000000001', '99000061-0000-4000-8000-000000000001', 990061, 1);

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
  owner_u    uuid := '61111111-aaaa-4aaa-8aaa-111111111111';
  member_u   uuid := '62222222-bbbb-4bbb-8bbb-222222222222';
  pending_u  uuid := '63333333-cccc-4ccc-8ccc-333333333333';
  outsider_u uuid := '64444444-dddd-4ddd-8ddd-444444444444';
  crossuni_u uuid := '65555555-eeee-4eee-8eee-555555555555';
  g1 uuid := '99000061-0000-4000-8000-000000000001';
  g2 uuid := '99000061-0000-4000-8000-000000000002';
  r1 uuid := '99000062-0000-4000-8000-000000000001';
  n int;
  v_rank int;
  v_group uuid;
  v_dorm bigint;
  denied boolean;
BEGIN
  -- ── Attacks (each must be denied) ────────────────────────────────────────
  -- 1. Outsider (other university, no membership) cannot insert.
  PERFORM pg_temp._as_user(outsider_u);
  denied := false;
  BEGIN
    INSERT INTO public.group_dorm_rankings (group_id, dorm_id, rank_order) VALUES (g1, 990063, 2);
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM pg_temp._assert('gdr: outsider INSERT denied', denied);

  -- 2. Pending invitee cannot insert (read helper must not leak onto writes).
  PERFORM pg_temp._as_user(pending_u);
  denied := false;
  BEGIN
    INSERT INTO public.group_dorm_rankings (group_id, dorm_id, rank_order) VALUES (g1, 990063, 2);
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM pg_temp._assert('gdr: pending invitee INSERT denied', denied);

  -- 3. Cross-university ACCEPTED member: membership passes, tenant gate fires.
  PERFORM pg_temp._as_user(crossuni_u);
  denied := false;
  BEGIN
    INSERT INTO public.group_dorm_rankings (group_id, dorm_id, rank_order) VALUES (g1, 990063, 2);
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM pg_temp._assert('gdr: cross-university accepted member INSERT denied', denied);

  -- 4. Accepted member cannot rank another university''s dorm (value gate).
  PERFORM pg_temp._as_user(member_u);
  denied := false;
  BEGIN
    INSERT INTO public.group_dorm_rankings (group_id, dorm_id, rank_order) VALUES (g1, 990062, 2);
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM pg_temp._assert('gdr: other-tenant dorm_id INSERT denied', denied);

  -- 5. …nor a dorm that does not exist (dorm_id has no FK; NULL fails closed).
  PERFORM pg_temp._as_user(member_u);
  denied := false;
  BEGIN
    INSERT INTO public.group_dorm_rankings (group_id, dorm_id, rank_order) VALUES (g1, 999999999, 2);
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM pg_temp._assert('gdr: nonexistent dorm_id INSERT denied', denied);

  -- 6. UPDATE cannot retarget a row into a group the writer is not part of.
  PERFORM pg_temp._as_user(member_u);
  denied := false;
  BEGIN
    UPDATE public.group_dorm_rankings SET group_id = g2 WHERE id = r1;
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM pg_temp._assert('gdr: UPDATE retarget of group_id denied', denied);
  PERFORM pg_temp._assume('postgres');
  SELECT group_id INTO v_group FROM public.group_dorm_rankings WHERE id = r1;
  PERFORM pg_temp._assert('gdr: row still points at its original group', v_group = g1);

  -- ── Legitimate paths (each must SUCCEED) ─────────────────────────────────
  -- 7. Accepted member inserts a same-university dorm.
  PERFORM pg_temp._as_user(member_u);
  INSERT INTO public.group_dorm_rankings (group_id, dorm_id, rank_order) VALUES (g1, 990063, 2);
  PERFORM pg_temp._assume('postgres');
  SELECT count(*) INTO n FROM public.group_dorm_rankings WHERE group_id = g1 AND dorm_id = 990063;
  PERFORM pg_temp._assert('gdr: accepted member INSERT succeeds', n = 1);

  -- 8. The owner (not in ranking_group_members at all) inserts via ownership.
  PERFORM pg_temp._as_user(owner_u);
  INSERT INTO public.group_dorm_rankings (group_id, dorm_id, rank_order) VALUES (g1, 990064, 3);
  PERFORM pg_temp._assume('postgres');
  SELECT count(*) INTO n FROM public.group_dorm_rankings WHERE group_id = g1 AND dorm_id = 990064;
  PERFORM pg_temp._assert('gdr: owner INSERT succeeds', n = 1);

  -- 9. Accepted member reorders (benign UPDATE).
  PERFORM pg_temp._as_user(member_u);
  UPDATE public.group_dorm_rankings SET rank_order = 5 WHERE id = r1;
  PERFORM pg_temp._assume('postgres');
  SELECT rank_order INTO v_rank FROM public.group_dorm_rankings WHERE id = r1;
  PERFORM pg_temp._assert('gdr: accepted member UPDATE rank_order succeeds', v_rank = 5);

  -- 10. Accepted member deletes a ranking row.
  PERFORM pg_temp._as_user(member_u);
  DELETE FROM public.group_dorm_rankings WHERE group_id = g1 AND dorm_id = 990063;
  PERFORM pg_temp._assume('postgres');
  SELECT count(*) INTO n FROM public.group_dorm_rankings WHERE group_id = g1 AND dorm_id = 990063;
  PERFORM pg_temp._assert('gdr: accepted member DELETE succeeds', n = 0);

  -- 11. Pending invitee still SELECTs the shared list (read path preserved).
  PERFORM pg_temp._as_user(pending_u);
  SELECT count(*) INTO n FROM public.group_dorm_rankings WHERE group_id = g1;
  PERFORM pg_temp._assert('gdr: pending invitee can still read the list', n >= 1);

  PERFORM pg_temp._assume('postgres');
END $$;

ROLLBACK;
