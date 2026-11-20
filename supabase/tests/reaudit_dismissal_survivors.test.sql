-- covers: 20260913000000_reaudit_dismissal_survivors.sql
-- Probe for 20260913000000_reaudit_dismissal_survivors — the four findings that
-- survived the re-audit of the 2026-08-02 dismissals
-- (docs/security/reaudit-2026-08-06.md). Every assertion here failed BEFORE that
-- migration; each was reproduced against a live stack first.
--
--  R1 ranking_collaborations UPDATE was still on get_my_all_group_ids() after the
--     08-02 DELETE fix — a never-accepted invitee could rewrite the group and
--     take owner_id.
--  R2 ranking_group_members UPDATE named user_id only, so a membership row could
--     be relocated into any same-tenant group with status='accepted' — which
--     re-opens the DELETE the 08-02 fix closed.
--  R3 marketplace_listings moderation columns were frozen at INSERT and free at
--     UPDATE, so a listing owner could lift their own HELD row out of the
--     admin_list_held_listings() queue.
--  R4 private.marketplace_public had no tenant predicate at all, so an inactive
--     (pre-launch) school's listings were published to signed-out visitors.
--
-- NOTE ON FIDELITY — SUPERSEDED 2026-08-06. This file used to warn that pg_temp._as_user()
-- set the `role` GUC only, changing current_user (so RLS applies) but NOT session_user, which
-- left guards exempting session_user IN ('postgres','supabase_admin') — protect_profile_role(),
-- protect_profile_is_admin(), protect_listing_verified_at() — INVISIBLE here and unsafe to
-- assert. That was H1 of the re-audit, and it is now FIXED: pg_temp._assume() below sets
-- session_authorization as well, so the harness presents session_user='authenticator', the
-- identity PostgREST actually uses, and those three guards deny exactly as they do through the
-- real client path. supabase/tests/harness_role_fidelity.test.sql asserts both the mechanism
-- and the three denials, and pins the set of session_user-keyed functions so a new one cannot
-- land without coverage. The triggers this file exercises still gate on auth.uid()/auth.role()
-- only, which remains the right default — a guard nobody has to think about to test.
--
-- Rolled back at the end.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/reaudit_dismissal_survivors.test.sql

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


INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at) VALUES
  ('61111111-aaaa-4aaa-8aaa-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ra-owner@pitt.edu',   now()),
  ('62222222-bbbb-4bbb-8bbb-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ra-pending@pitt.edu',  now()),
  ('63333333-cccc-4ccc-8ccc-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ra-outsider@pitt.edu', now()),
  ('64444444-dddd-4ddd-8ddd-444444444444','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ra-member@pitt.edu',   now()),
  ('65555555-eeee-4eee-8eee-555555555555','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ra-admin@pitt.edu',    now())
ON CONFLICT (id) DO NOTHING;

-- The auth.users trigger creates the profiles row first, so seed columns belong
-- in ON CONFLICT DO UPDATE, not in the VALUES list alone.
INSERT INTO public.profiles (id, full_name, university_id, current_dorm) VALUES
  ('61111111-aaaa-4aaa-8aaa-111111111111','RA Owner',    '00000000-0000-4000-8000-000000000001','Litchfield Towers'),
  ('62222222-bbbb-4bbb-8bbb-222222222222','RA Pending',  '00000000-0000-4000-8000-000000000001','Litchfield Towers'),
  ('63333333-cccc-4ccc-8ccc-333333333333','RA Outsider', '00000000-0000-4000-8000-000000000001','Litchfield Towers'),
  ('64444444-dddd-4ddd-8ddd-444444444444','RA Member',   '00000000-0000-4000-8000-000000000001','Litchfield Towers'),
  ('65555555-eeee-4eee-8eee-555555555555','RA Admin',    '00000000-0000-4000-8000-000000000001','Litchfield Towers')
ON CONFLICT (id) DO UPDATE
  SET university_id = EXCLUDED.university_id,
      current_dorm  = EXCLUDED.current_dorm;

-- A real moderator is a ROLE, not the derived column. Until 2026-09-06 this line wrote
-- `is_admin = true` directly, which left role='user' — a shape no account can reach — and
-- passed only because every admin policy read the derived column (the is_admin tier
-- collapse, 20261005000000). Seeded as postgres, which protect_profile_role() exempts;
-- sync_is_admin_from_role() projects is_admin from the role.
UPDATE public.profiles SET role = 'superadmin' WHERE id = '65555555-eeee-4eee-8eee-555555555555';

-- Victim group: owned by RA Owner, one PENDING invitee, one ACCEPTED member.
INSERT INTO public.ranking_collaborations (id, owner_id, status, group_name, university_id) VALUES
  ('99000061-0000-4000-8000-000000000001','61111111-aaaa-4aaa-8aaa-111111111111','active','victim group','00000000-0000-4000-8000-000000000001'),
  ('99000061-0000-4000-8000-000000000002','63333333-cccc-4ccc-8ccc-333333333333','active','outsider group','00000000-0000-4000-8000-000000000001');

INSERT INTO public.ranking_group_members (id, group_id, user_id, status) VALUES
  ('99000062-0000-4000-8000-000000000001','99000061-0000-4000-8000-000000000001','62222222-bbbb-4bbb-8bbb-222222222222','pending'),
  ('99000062-0000-4000-8000-000000000002','99000061-0000-4000-8000-000000000001','64444444-dddd-4ddd-8ddd-444444444444','accepted'),
  ('99000062-0000-4000-8000-000000000003','99000061-0000-4000-8000-000000000002','63333333-cccc-4ccc-8ccc-333333333333','accepted');

CREATE OR REPLACE FUNCTION pg_temp._as_user(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp._as_anon() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('anon');
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp._as_service() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('postgres');
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
END $$;

-- Verdict rows are printed, not just raised: scripts/test-db.sh counts PASS
-- lines because silence is indistinguishable from an assertion that never ran.
CREATE OR REPLACE FUNCTION pg_temp._assert(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('postgres');
  IF cond IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: %', label;
  END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

DO $$
DECLARE
  owner_u    uuid := '61111111-aaaa-4aaa-8aaa-111111111111';
  pending_u  uuid := '62222222-bbbb-4bbb-8bbb-222222222222';
  outsider_u uuid := '63333333-cccc-4ccc-8ccc-333333333333';
  member_u   uuid := '64444444-dddd-4ddd-8ddd-444444444444';
  admin_u    uuid := '65555555-eeee-4eee-8eee-555555555555';
  victim     uuid := '99000061-0000-4000-8000-000000000001';
  v_name text; v_owner uuid; v_gid uuid; v_status text; v_dec text; v_title text;
  n int; lid uuid;
BEGIN
  -- ── R1 ───────────────────────────────────────────────────────────────────
  PERFORM pg_temp._as_user(pending_u);
  UPDATE public.ranking_collaborations SET group_name = 'HIJACKED' WHERE id = victim;
  PERFORM pg_temp._assume('postgres');
  SELECT group_name INTO v_name FROM public.ranking_collaborations WHERE id = victim;
  PERFORM pg_temp._assert('R1: pending invitee CANNOT rename the group', v_name = 'victim group');

  PERFORM pg_temp._as_user(member_u);
  UPDATE public.ranking_collaborations SET group_name = 'renamed by member' WHERE id = victim;
  PERFORM pg_temp._assume('postgres');
  SELECT group_name INTO v_name FROM public.ranking_collaborations WHERE id = victim;
  PERFORM pg_temp._assert('R1: accepted member CAN still rename the group', v_name = 'renamed by member');

  -- Ownership is frozen even for a legitimately accepted member.
  PERFORM pg_temp._as_user(member_u);
  UPDATE public.ranking_collaborations SET owner_id = member_u WHERE id = victim;
  PERFORM pg_temp._assume('postgres');
  SELECT owner_id INTO v_owner FROM public.ranking_collaborations WHERE id = victim;
  PERFORM pg_temp._assert('R1: accepted member CANNOT seize owner_id', v_owner = owner_u);

  -- ── R2 ───────────────────────────────────────────────────────────────────
  PERFORM pg_temp._as_user(outsider_u);
  UPDATE public.ranking_group_members
     SET group_id = victim, status = 'accepted', role = 'owner'
   WHERE id = '99000062-0000-4000-8000-000000000003';
  PERFORM pg_temp._assume('postgres');
  SELECT group_id INTO v_gid FROM public.ranking_group_members
   WHERE id = '99000062-0000-4000-8000-000000000003';
  PERFORM pg_temp._assert('R2: a membership row CANNOT be relocated into another group',
                          v_gid = '99000061-0000-4000-8000-000000000002');

  PERFORM pg_temp._as_user(outsider_u);
  SELECT count(*) INTO n FROM public.get_my_accepted_group_ids() g WHERE g = victim;
  PERFORM pg_temp._assume('postgres');
  PERFORM pg_temp._assert('R2: outsider is NOT an accepted member of the victim group', n = 0);

  PERFORM pg_temp._as_user(outsider_u);
  DELETE FROM public.ranking_collaborations WHERE id = victim;
  PERFORM pg_temp._assume('postgres');
  SELECT count(*) INTO n FROM public.ranking_collaborations WHERE id = victim;
  PERFORM pg_temp._assert('R2: outsider CANNOT delete the victim group', n = 1);

  -- The accept flow the policy exists for still works.
  PERFORM pg_temp._as_user(pending_u);
  UPDATE public.ranking_group_members SET status = 'accepted'
   WHERE id = '99000062-0000-4000-8000-000000000001';
  PERFORM pg_temp._assume('postgres');
  SELECT status INTO v_status FROM public.ranking_group_members
   WHERE id = '99000062-0000-4000-8000-000000000001';
  PERFORM pg_temp._assert('R2: an invitee CAN still accept their own invite', v_status = 'accepted');

  -- ── R3 ───────────────────────────────────────────────────────────────────
  PERFORM pg_temp._as_user(owner_u);
  INSERT INTO public.marketplace_listings (user_id, title, description, price, category, condition)
  VALUES (owner_u, 'RA probe listing', 'desc', 10, 'Furniture', 'good')
  RETURNING id INTO lid;

  PERFORM pg_temp._as_service();
  UPDATE public.marketplace_listings
     SET status = 'under_review', moderation_decision = 'held',
         moderation_reason = 'probe hold', moderated_at = now()
   WHERE id = lid;
  SELECT count(*) INTO n FROM public.marketplace_listings ml
   WHERE ml.id = lid AND ml.status = 'under_review'
     AND ml.moderation_decision = ANY (ARRAY['held','rejected']);
  PERFORM pg_temp._assert('R3: fixture is held and inside the admin queue predicate', n = 1);

  PERFORM pg_temp._as_user(owner_u);
  UPDATE public.marketplace_listings
     SET moderation_decision = 'approved', moderation_reason = NULL,
         moderation_categories = NULL, moderated_at = NULL
   WHERE id = lid;
  PERFORM pg_temp._assume('postgres');
  SELECT moderation_decision INTO v_dec FROM public.marketplace_listings WHERE id = lid;
  PERFORM pg_temp._assert('R3: owner CANNOT rewrite moderation_decision', v_dec = 'held');

  SELECT count(*) INTO n FROM public.marketplace_listings ml
   WHERE ml.id = lid AND ml.status = 'under_review'
     AND ml.moderation_decision = ANY (ARRAY['held','rejected']);
  PERFORM pg_temp._assert('R3: the held listing stays in the admin queue predicate', n = 1);

  -- A benign owner edit is untouched (the trigger restores OLD, it does not raise).
  PERFORM pg_temp._as_user(owner_u);
  UPDATE public.marketplace_listings SET description = 'edited desc' WHERE id = lid;
  PERFORM pg_temp._assume('postgres');
  SELECT description INTO v_title FROM public.marketplace_listings WHERE id = lid;
  PERFORM pg_temp._assert('R3: a benign owner edit still applies', v_title = 'edited desc');

  -- An admin still moderates.
  PERFORM pg_temp._as_user(admin_u);
  UPDATE public.marketplace_listings SET moderation_decision = 'approved' WHERE id = lid;
  PERFORM pg_temp._assume('postgres');
  SELECT moderation_decision INTO v_dec FROM public.marketplace_listings WHERE id = lid;
  PERFORM pg_temp._assert('R3: an admin CAN still set moderation_decision', v_dec = 'approved');

  -- ── R4 ───────────────────────────────────────────────────────────────────
  -- Two approved, live listings; one moved to an INACTIVE school. Both would be
  -- published before the fix.
  PERFORM pg_temp._assume('postgres');
  INSERT INTO public.marketplace_listings
    (id, user_id, title, description, price, category, condition, status, moderation_decision, university_id)
  VALUES
    ('99000081-0000-4000-8000-000000000001', owner_u, 'RA active lamp',   'd', 5, 'Furniture', 'good', 'available', 'approved', '00000000-0000-4000-8000-000000000001'),
    ('99000081-0000-4000-8000-000000000002', owner_u, 'RA inactive lamp', 'd', 5, 'Furniture', 'good', 'available', 'approved', '00000000-0000-4000-8000-000000000001');
  UPDATE public.universities SET is_active = false WHERE id = '00000000-0000-4000-8000-000000000002';
  UPDATE public.marketplace_listings SET university_id = '00000000-0000-4000-8000-000000000002'
   WHERE id = '99000081-0000-4000-8000-000000000002';

  PERFORM pg_temp._as_anon();
  SELECT count(*) INTO n FROM public.marketplace_public
   WHERE id = '99000081-0000-4000-8000-000000000001';
  PERFORM pg_temp._assume('postgres');
  PERFORM pg_temp._assert('R4: a live school''s listing IS still published to guests', n = 1);

  PERFORM pg_temp._as_anon();
  SELECT count(*) INTO n FROM public.marketplace_public
   WHERE id = '99000081-0000-4000-8000-000000000002';
  PERFORM pg_temp._assume('postgres');
  PERFORM pg_temp._assert('R4: an INACTIVE school''s listing is NOT published to guests', n = 0);

  PERFORM pg_temp._assume('postgres');
END $$;

ROLLBACK;
