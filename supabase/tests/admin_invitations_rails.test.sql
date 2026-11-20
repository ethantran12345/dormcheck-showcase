-- Delegated-admin rails (migration 20260709132034_admin_invitations, as amended by
-- 20260713002250_admin_scopes and 20260714050426_hide_superadmin_from_university_admins).
--
-- WHY THIS FILE EXISTS. The whole delegated-admin feature — admin_invitations, set_admin_role,
-- revoke_admin_invitation, claim_pending_admin_invites, get_university_admins, and the
-- api/admin-invite.ts handler on top of them — shipped and merged with ZERO test coverage.
-- Verified 2026-08-06: `git log --all -S'set_admin_role' -- src/test supabase/tests e2e`
-- returned nothing. The only file in the repo that even mentioned the feature was
-- src/test/notifyPushParity.test.ts, and only to EXEMPT it. It was also the one feature the
-- 2026-08-06 authed UI pass did not touch (it scoped the six marketplace features).
--
-- These are the rails a compromised or curious client attacks, and PostgREST reaches every
-- one of them directly, so they are asserted here rather than in the handler: a check that
-- lives only in api/admin-invite.ts is a check a client can skip by calling the RPC itself.
--
-- WHAT IS ASSERTED
--   §1 admin_invitations RLS: a university_admin may mint ONLY university_admin, ONLY for its
--      own school, ONLY as itself; a plain user and anon may mint nothing; DELETE is revoked.
--   §2 a university_admin cannot SEE a superadmin (get_university_admins) or another school.
--   §3 set_admin_role rails: no touching a superadmin, no minting one, no cross-school, no
--      self-change, non-admins refused — and the legitimate grant still works.
--   §4 revoke_admin_invitation scope.
--   §5 claim_pending_admin_invites claims a matching live invite and refuses an expired one
--      and one belonging to an inactive school.
--   §6 every mutating path writes admin_audit_log.
--   §7 the dormcheck.role_change_authorized transaction flag: not reachable through PostgREST,
--      the set of functions allowed to set it is pinned, and (since 20261006000000) both
--      setters lower it again before returning, so a follow-on write in the same
--      transaction is refused.
--
-- covers: 20261006000000_role_change_flag_reset.sql
--
-- FIDELITY. Every assertion runs through pg_temp._assume(), so session_user='authenticator'
-- exactly as PostgREST presents it — which is what makes protect_profile_role() visible here
-- at all (H1, docs/security/reaudit-2026-08-06.md; fixed 2026-08-06). Before that fix this
-- file could not have been written honestly: the guard would have been silently exempt.
--
-- MUTATION-CHECKED. Each rail was removed in turn against a live stack and the corresponding
-- verdict went red; see docs/handoffs/lane-admin-tests.md for the table.
--
-- Rolled back at the end.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/admin_invitations_rails.test.sql

\set ON_ERROR_STOP on

\set uni_a   '00000000-0000-4000-8000-000000000001'
\set uni_b   'ad0a1000-0000-4000-8000-0000000000b2'
\set uni_off 'ad0a1000-0000-4000-8000-0000000000f3'
\set ua_a    'ad0a1000-0000-4000-8000-0000000000a1'
\set ua_b    'ad0a1000-0000-4000-8000-0000000000b1'
\set sa      'ad0a1000-0000-4000-8000-0000000000c1'
\set plain_a 'ad0a1000-0000-4000-8000-0000000000d1'
\set tgt_a   'ad0a1000-0000-4000-8000-0000000000e1'
\set tgt_b   'ad0a1000-0000-4000-8000-0000000000e2'
\set inv_a   'ad0a1000-0000-4000-8000-00000001a001'
\set inv_b   'ad0a1000-0000-4000-8000-00000001b002'

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

-- Run a statement as `uid` and return the error text, or NULL when it was permitted.
-- Always returns to the seeding identity, including on the error path, so one denied
-- assertion cannot leave the next one running as somebody else.
CREATE OR REPLACE FUNCTION pg_temp._try_as(uid uuid, stmt text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._as_user(uid);
  EXECUTE stmt;
  PERFORM pg_temp._assume('postgres');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RETURN SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION pg_temp._try_anon(stmt text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._as_anon();
  EXECUTE stmt;
  PERFORM pg_temp._assume('postgres');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RETURN SQLERRM;
END $$;

-- Count rows a given caller can actually SEE. RLS makes "denied" and "invisible" the same
-- outcome for SELECT, so the reads below assert counts rather than errors.
CREATE OR REPLACE FUNCTION pg_temp._count_as(uid uuid, q text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM pg_temp._as_user(uid);
  EXECUTE q INTO n;
  PERFORM pg_temp._assume('postgres');
  RETURN n;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RETURN -1;   -- an error is not the same as "sees nothing"; -1 makes that visible
END $$;

CREATE OR REPLACE FUNCTION pg_temp._audit_count() RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.admin_audit_log;
$$;

-- ── fixtures ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active) VALUES
  (:'uni_a',   'pitt',            'University of Pittsburgh', 'Pitt', ARRAY['pitt.edu'], true),
  (:'uni_b',   'rails-probe-b',   'Rails Probe University B', 'RPB',  ARRAY['rpb.edu'],  true),
  (:'uni_off', 'rails-probe-off', 'Rails Probe Inactive',     'RPO',  ARRAY['rpo.edu'],  false)
ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active, email_domains = EXCLUDED.email_domains;

-- Rolled back, so these auth.users rows never outlive the probe — but the four GoTrue token
-- columns are written anyway, because a fixture that omits them is one COMMIT away from
-- 500ing the whole admin user API (see content_reports_user_type.test.sql).
INSERT INTO auth.users (id, instance_id, aud, role, email,
                        confirmation_token, recovery_token, email_change_token_new, email_change) VALUES
  (:'ua_a'::uuid,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rails-ua-a@pitt.edu', '', '', '', ''),
  (:'ua_b'::uuid,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rails-ua-b@rpb.edu',  '', '', '', ''),
  (:'sa'::uuid,      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rails-sa@pitt.edu',   '', '', '', ''),
  (:'plain_a'::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rails-plain@pitt.edu','', '', '', ''),
  (:'tgt_a'::uuid,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rails-tgt-a@pitt.edu','', '', '', ''),
  (:'tgt_b'::uuid,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rails-tgt-b@rpb.edu', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- The on_auth_user_created trigger has already made each profiles row, so this is the
-- DO UPDATE path: every column an assertion depends on must be named here, not just in the
-- INSERT list. Seeded as session_user='postgres', which protect_profile_role() exempts —
-- that exemption is what makes seeding an admin possible at all.
INSERT INTO public.profiles (id, email, full_name, university_id, role) VALUES
  (:'ua_a'::uuid,    'rails-ua-a@pitt.edu',  'Rails UA A',    :'uni_a', 'university_admin'),
  (:'ua_b'::uuid,    'rails-ua-b@rpb.edu',   'Rails UA B',    :'uni_b', 'university_admin'),
  (:'sa'::uuid,      'rails-sa@pitt.edu',    'Rails SA',      :'uni_a', 'superadmin'),
  (:'plain_a'::uuid, 'rails-plain@pitt.edu', 'Rails Plain',   :'uni_a', 'user'),
  (:'tgt_a'::uuid,   'rails-tgt-a@pitt.edu', 'Rails Target A',:'uni_a', 'user'),
  (:'tgt_b'::uuid,   'rails-tgt-b@rpb.edu',  'Rails Target B',:'uni_b', 'user')
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email, full_name = EXCLUDED.full_name,
      university_id = EXCLUDED.university_id, role = EXCLUDED.role;

-- One pending invitation per school, to exercise read scope and revocation.
INSERT INTO public.admin_invitations (id, email, role, university_id, invited_by) VALUES
  (:'inv_a'::uuid, 'rails-invitee-a@pitt.edu', 'university_admin', :'uni_a', :'ua_a'::uuid),
  (:'inv_b'::uuid, 'rails-invitee-b@rpb.edu',  'university_admin', :'uni_b', :'ua_b'::uuid)
ON CONFLICT (id) DO NOTHING;

-- TWO-PHASE ASSERTIONS. Every action is RECORDED in its own statement and only then judged.
-- This is not style: a volatile function called inside a SELECT does its writes under that
-- statement's snapshot, so a sibling subquery in the same SELECT still reads the OLD row. The
-- first cut of this file asserted `_try_as(...) IS NULL AND (SELECT role …) = 'university_admin'`
-- in one statement and reported the legitimate grant as broken while it was working perfectly.
-- Worse, the same shape can hide a REAL escalation, because the row check reads a snapshot
-- taken before the escalation happened. Record, then judge.
CREATE TEMP TABLE _r (k text PRIMARY KEY, err text, n bigint);

-- ═══ §1 admin_invitations: who may mint an invitation, and for whom ══════════════════════
INSERT INTO _r (k, err) VALUES ('1a', pg_temp._try_as(:'ua_a'::uuid, format(
  'INSERT INTO public.admin_invitations (email, role, university_id, invited_by) VALUES (%L, %L, %L, %L)',
  'rails-new-a@pitt.edu', 'university_admin', :'uni_a', :'ua_a')));
INSERT INTO _r (k, err) VALUES ('1b', pg_temp._try_as(:'ua_a'::uuid, format(
  'INSERT INTO public.admin_invitations (email, role, university_id, invited_by) VALUES (%L, %L, %L, %L)',
  'rails-esc-a@pitt.edu', 'superadmin', :'uni_a', :'ua_a')));
INSERT INTO _r (k, err) VALUES ('1c', pg_temp._try_as(:'ua_a'::uuid, format(
  'INSERT INTO public.admin_invitations (email, role, university_id, invited_by) VALUES (%L, %L, %L, %L)',
  'rails-cross@rpb.edu', 'university_admin', :'uni_b', :'ua_a')));
INSERT INTO _r (k, err) VALUES ('1d', pg_temp._try_as(:'ua_a'::uuid, format(
  'INSERT INTO public.admin_invitations (email, role, university_id, invited_by) VALUES (%L, %L, %L, %L)',
  'rails-forged@pitt.edu', 'university_admin', :'uni_a', :'sa')));
INSERT INTO _r (k, err) VALUES ('1e', pg_temp._try_as(:'plain_a'::uuid, format(
  'INSERT INTO public.admin_invitations (email, role, university_id, invited_by) VALUES (%L, %L, %L, %L)',
  'rails-self@pitt.edu', 'university_admin', :'uni_a', :'plain_a')));
INSERT INTO _r (k, err) VALUES ('1f', pg_temp._try_anon(format(
  'INSERT INTO public.admin_invitations (email, role, university_id, invited_by) VALUES (%L, %L, %L, %L)',
  'rails-anon@pitt.edu', 'university_admin', :'uni_a', :'ua_a')));
INSERT INTO _r (k, err) VALUES ('1g', pg_temp._try_as(:'ua_a'::uuid,
  format('DELETE FROM public.admin_invitations WHERE id = %L', :'inv_a')));

\echo '--- 1a: a university_admin CAN mint a university_admin invite for its own school ---'
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '1a') IS NULL
             AND EXISTS (SELECT 1 FROM public.admin_invitations WHERE email = 'rails-new-a@pitt.edu')
       THEN 'PASS' ELSE 'FAIL: the legitimate own-school peer invite was refused — '
            || coalesce((SELECT err FROM _r WHERE k = '1a'), 'no row landed') END
  AS ua_can_invite_peer;

\echo '--- 1b: a university_admin CANNOT mint a superadmin invite ---'
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '1b') LIKE '%row-level security%'
             AND NOT EXISTS (SELECT 1 FROM public.admin_invitations WHERE email = 'rails-esc-a@pitt.edu')
       THEN 'PASS' ELSE 'FAIL: a superadmin invite was accepted, or refused for another reason' END
  AS ua_cannot_mint_superadmin;

\echo '--- 1c: a university_admin CANNOT mint an invite for another school ---'
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '1c') LIKE '%row-level security%'
             AND NOT EXISTS (SELECT 1 FROM public.admin_invitations WHERE email = 'rails-cross@rpb.edu')
       THEN 'PASS' ELSE 'FAIL: a cross-school invite was accepted' END
  AS ua_cannot_invite_other_school;

\echo '--- 1d: a university_admin CANNOT attribute an invite to someone else ---'
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '1d') LIKE '%row-level security%'
             AND NOT EXISTS (SELECT 1 FROM public.admin_invitations WHERE email = 'rails-forged@pitt.edu')
       THEN 'PASS' ELSE 'FAIL: invited_by was forgeable' END
  AS ua_cannot_forge_inviter;

\echo '--- 1e: a plain user CANNOT seed an admin_invitations row ---'
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '1e') LIKE '%row-level security%'
             AND NOT EXISTS (SELECT 1 FROM public.admin_invitations WHERE email = 'rails-self@pitt.edu')
       THEN 'PASS' ELSE 'FAIL: a non-admin created an invitation' END
  AS plain_user_cannot_invite;

\echo '--- 1f: anon CANNOT seed an admin_invitations row ---'
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '1f') IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM public.admin_invitations WHERE email = 'rails-anon@pitt.edu')
       THEN 'PASS' ELSE 'FAIL: anon reached admin_invitations' END
  AS anon_cannot_invite;

\echo '--- 1g: DELETE on admin_invitations is revoked from authenticated ---'
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '1g') IS NOT NULL
             AND EXISTS (SELECT 1 FROM public.admin_invitations WHERE id = :'inv_a'::uuid)
       THEN 'PASS' ELSE 'FAIL: an invitation was deletable by a client' END
  AS delete_is_revoked;

-- ═══ §2 visibility: a university_admin sees its own school, and never a superadmin ═══════
\echo '--- 2a: a university_admin reads ONLY its own school''s invitations ---'
SELECT CASE
  WHEN pg_temp._count_as(:'ua_a'::uuid, 'SELECT count(*) FROM public.admin_invitations WHERE university_id = ''' || :'uni_b' || '''') = 0
   AND pg_temp._count_as(:'ua_a'::uuid, 'SELECT count(*) FROM public.admin_invitations WHERE university_id = ''' || :'uni_a' || '''') > 0
  THEN 'PASS' ELSE 'FAIL: invitation read scope is wrong' END
  AS invitation_read_scope;

\echo '--- 2b: get_university_admins hides superadmins and other schools from a university_admin ---'
SELECT CASE
  WHEN pg_temp._count_as(:'ua_a'::uuid, 'SELECT count(*) FROM public.get_university_admins() WHERE role = ''superadmin''') = 0
   AND pg_temp._count_as(:'ua_a'::uuid, 'SELECT count(*) FROM public.get_university_admins() WHERE university_id <> ''' || :'uni_a' || '''') = 0
   AND pg_temp._count_as(:'ua_a'::uuid, 'SELECT count(*) FROM public.get_university_admins() WHERE id = ''' || :'ua_a' || '''') = 1
  THEN 'PASS' ELSE 'FAIL: a university_admin can see a superadmin or another school' END
  AS superadmin_invisible_to_university_admin;

-- The flag must be off for an ordinary client transaction that has called no authorized RPC.
-- Asserted HERE, before any RPC runs — see §7d for why the placement is load-bearing.
\echo '--- 2c: dormcheck.role_change_authorized is not ambient ---'
SELECT CASE WHEN coalesce(current_setting('dormcheck.role_change_authorized', true), '') <> 'on'
  THEN 'PASS' ELSE 'FAIL: the role-change flag is set outside any authorized RPC' END
  AS flag_not_ambient;

-- ═══ §3 set_admin_role rails ═════════════════════════════════════════════════════════════
INSERT INTO _r (k, err) VALUES ('3a', pg_temp._try_as(:'ua_a'::uuid, format('SELECT public.set_admin_role(%L, %L)', :'sa', 'user')));
INSERT INTO _r (k, err) VALUES ('3b', pg_temp._try_as(:'ua_a'::uuid, format('SELECT public.set_admin_role(%L, %L)', :'tgt_a', 'superadmin')));
INSERT INTO _r (k, err) VALUES ('3c', pg_temp._try_as(:'ua_a'::uuid, format('SELECT public.set_admin_role(%L, %L)', :'tgt_b', 'university_admin')));
INSERT INTO _r (k, err) VALUES ('3d', pg_temp._try_as(:'ua_a'::uuid, format('SELECT public.set_admin_role(%L, %L)', :'ua_a', 'superadmin')));
INSERT INTO _r (k, err) VALUES ('3e', pg_temp._try_as(:'plain_a'::uuid, format('SELECT public.set_admin_role(%L, %L)', :'tgt_a', 'university_admin')));
INSERT INTO _r (k, err) VALUES ('3f', pg_temp._try_anon(format('SELECT public.set_admin_role(%L, %L)', :'tgt_a', 'university_admin')));

\echo '--- 3a: a university_admin cannot touch a superadmin ---'
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '3a') LIKE '%cannot_touch_superadmin%'
             AND (SELECT role FROM public.profiles WHERE id = :'sa'::uuid) = 'superadmin'
       THEN 'PASS' ELSE 'FAIL: a superadmin was demotable by a university_admin' END
  AS cannot_demote_superadmin;

\echo '--- 3b: a university_admin cannot MINT a superadmin ---'
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '3b') LIKE '%cannot_touch_superadmin%'
             AND (SELECT role FROM public.profiles WHERE id = :'tgt_a'::uuid) = 'user'
       THEN 'PASS' ELSE 'FAIL: a university_admin minted a superadmin' END
  AS cannot_mint_superadmin;

\echo '--- 3c: a university_admin cannot reach another school''s user ---'
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '3c') LIKE '%wrong_university%'
             AND (SELECT role FROM public.profiles WHERE id = :'tgt_b'::uuid) = 'user'
       THEN 'PASS' ELSE 'FAIL: a cross-school role change succeeded' END
  AS cannot_cross_school;

\echo '--- 3d: nobody changes their own role through the RPC ---'
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '3d') LIKE '%cannot_change_own_role%'
             AND (SELECT role FROM public.profiles WHERE id = :'ua_a'::uuid) = 'university_admin'
       THEN 'PASS' ELSE 'FAIL: a self role change succeeded' END
  AS cannot_change_own_role;

\echo '--- 3e: a plain user cannot call set_admin_role at all ---'
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '3e') LIKE '%not_authorized%'
             AND (SELECT role FROM public.profiles WHERE id = :'tgt_a'::uuid) = 'user'
       THEN 'PASS' ELSE 'FAIL: a non-admin granted a role' END
  AS non_admin_cannot_grant;

\echo '--- 3f: anon cannot call set_admin_role ---'
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '3f') IS NOT NULL
             AND (SELECT role FROM public.profiles WHERE id = :'tgt_a'::uuid) = 'user'
       THEN 'PASS' ELSE 'FAIL: anon granted a role' END
  AS anon_cannot_grant;

-- The positive control. Without it the six denials above are equally satisfied by a function
-- that refuses everything, which is not the feature.
INSERT INTO _r (k, err) VALUES ('3g', pg_temp._try_as(:'ua_a'::uuid, format('SELECT public.set_admin_role(%L, %L)', :'tgt_a', 'university_admin')));

\echo '--- 3g: the legitimate grant still works, and is audited ---'
SELECT CASE
  WHEN (SELECT err FROM _r WHERE k = '3g') IS NULL
   AND (SELECT role FROM public.profiles WHERE id = :'tgt_a'::uuid) = 'university_admin'
   AND EXISTS (SELECT 1 FROM public.admin_audit_log
               WHERE actor_id = :'ua_a'::uuid AND target_id = :'tgt_a'::uuid AND action = 'admin.role_change')
  THEN 'PASS' ELSE 'FAIL: the legitimate grant did not apply, or wrote no audit row — '
       || coalesce((SELECT err FROM _r WHERE k = '3g'), 'no error') END
  AS legitimate_grant_works_and_audits;

-- ═══ §4 revoke_admin_invitation scope ════════════════════════════════════════════════════
INSERT INTO _r (k, err) VALUES ('4a', pg_temp._try_as(:'ua_a'::uuid, format('SELECT public.revoke_admin_invitation(%L)', :'inv_b')));
INSERT INTO _r (k, err) VALUES ('4b', pg_temp._try_as(:'plain_a'::uuid, format('SELECT public.revoke_admin_invitation(%L)', :'inv_a')));

\echo '--- 4a: a university_admin cannot revoke another school''s invitation ---'
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '4a') LIKE '%wrong_university%'
             AND (SELECT status FROM public.admin_invitations WHERE id = :'inv_b'::uuid) = 'pending'
       THEN 'PASS' ELSE 'FAIL: a cross-school revocation succeeded' END
  AS cannot_revoke_other_school;

\echo '--- 4b: a plain user cannot revoke anything ---'
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '4b') LIKE '%not_authorized%'
             AND (SELECT status FROM public.admin_invitations WHERE id = :'inv_a'::uuid) = 'pending'
       THEN 'PASS' ELSE 'FAIL: a non-admin revoked an invitation' END
  AS non_admin_cannot_revoke;

INSERT INTO _r (k, err) VALUES ('4c', pg_temp._try_as(:'ua_a'::uuid, format('SELECT public.revoke_admin_invitation(%L)', :'inv_a')));

\echo '--- 4c: own-school revocation works and is audited ---'
SELECT CASE
  WHEN (SELECT err FROM _r WHERE k = '4c') IS NULL
   AND (SELECT status FROM public.admin_invitations WHERE id = :'inv_a'::uuid) = 'revoked'
   AND EXISTS (SELECT 1 FROM public.admin_audit_log
               WHERE actor_id = :'ua_a'::uuid AND target_id = :'inv_a'::uuid AND action = 'admin.invite_revoked')
  THEN 'PASS' ELSE 'FAIL: own-school revocation did not apply, or wrote no audit row — '
       || coalesce((SELECT err FROM _r WHERE k = '4c'), 'no error') END
  AS own_school_revocation_works;

-- ═══ §5 claim_pending_admin_invites ══════════════════════════════════════════════════════
-- Three invitations for the same plain user: one live at an active school, one EXPIRED, one at
-- an INACTIVE (pre-launch) school. Exactly one must be claimed. The two refusals matter more
-- than the claim: an expired or pre-launch invitation is how a stale grant becomes a live admin.
INSERT INTO public.admin_invitations (email, role, university_id, invited_by, expires_at) VALUES
  ('rails-plain@pitt.edu', 'university_admin', :'uni_a',   :'ua_a'::uuid, now() + interval '7 days'),
  ('rails-plain@pitt.edu', 'university_admin', :'uni_b',   :'ua_b'::uuid, now() - interval '1 day'),
  ('rails-plain@pitt.edu', 'university_admin', :'uni_off', :'sa'::uuid,   now() + interval '7 days');

INSERT INTO _r (k, n) VALUES ('5', pg_temp._count_as(:'plain_a'::uuid, 'SELECT public.claim_pending_admin_invites()'));

\echo '--- 5: exactly the live, active-school invitation is claimed, and it is audited ---'
SELECT CASE
  WHEN (SELECT n FROM _r WHERE k = '5') = 1
   AND (SELECT role FROM public.profiles WHERE id = :'plain_a'::uuid) = 'university_admin'
   AND (SELECT university_id FROM public.profiles WHERE id = :'plain_a'::uuid) = :'uni_a'::uuid
   AND (SELECT count(*) FROM public.admin_invitations
        WHERE email = 'rails-plain@pitt.edu' AND status = 'pending') = 2
   AND EXISTS (SELECT 1 FROM public.admin_audit_log
               WHERE actor_id = :'plain_a'::uuid AND action = 'admin.invite_accepted')
  THEN 'PASS' ELSE 'FAIL: claim scope wrong (expected exactly 1 claimed, 2 left pending), got '
       || coalesce((SELECT n FROM _r WHERE k = '5')::text, 'null') END
  AS claim_only_live_active_invite;

-- ═══ §6 audit coverage ═══════════════════════════════════════════════════════════════════
-- §3g, §4c and §5 each assert their own audit row. This is the complement: the DENIED paths
-- must write NOTHING, so a refused attempt can never be read back as an action that happened.
\echo '--- 6: refused attempts leave no audit trail of an action that never happened ---'
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                   WHERE actor_id = :'plain_a'::uuid AND action IN ('admin.role_change', 'admin.revoke', 'admin.invite_revoked'))
   AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                   WHERE actor_id = :'ua_a'::uuid AND target_id = :'tgt_b'::uuid)
   AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                   WHERE actor_id = :'ua_a'::uuid AND target_id = :'sa'::uuid)
   AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                   WHERE actor_id = :'ua_a'::uuid AND target_id = :'inv_b'::uuid)
  THEN 'PASS' ELSE 'FAIL: a refused attempt wrote an audit row' END
  AS refusals_write_no_audit;

-- ═══ §7 the dormcheck.role_change_authorized transaction flag ════════════════════════════
-- This flag is the only thing between "a definer RPC that checked its rails" and "any UPDATE
-- on profiles.role". §2c already proved it is not ambient. The rest is about reachability.
\echo '--- 7a: no GUC-setting function is exposed to PostgREST ---'
SELECT CASE WHEN (
    SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'graphql_public') AND p.proname IN ('set_config', 'current_setting')
  ) = 0
  THEN 'PASS' ELSE 'FAIL: a GUC-setting function is callable through PostgREST' END
  AS set_config_not_exposed;

-- The forcing function. Only these three may mention the flag: two definer RPCs that set it
-- after validating their own rails, and the trigger that reads it. A fourth name here means
-- someone taught a new path to bypass the role guard, and it must arrive with the test that
-- proves the new path checks something first.
\echo '--- 7b: the set of functions that may mention the flag is unchanged ---'
SELECT CASE WHEN missing = '' AND unexpected = '' THEN 'PASS'
            ELSE 'FAIL: missing=[' || missing || '] unexpected=[' || unexpected || ']' END
       AS role_change_flag_inventory
FROM (
  WITH expected(name) AS (
    VALUES ('claim_pending_admin_invites'), ('protect_profile_role'), ('set_admin_role')
  ),
  actual(name) AS (
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosrc LIKE '%role_change_authorized%'
  )
  SELECT
    coalesce((SELECT string_agg(name, ', ' ORDER BY name) FROM (SELECT name FROM expected EXCEPT SELECT name FROM actual) m), '') AS missing,
    coalesce((SELECT string_agg(name, ', ' ORDER BY name) FROM (SELECT name FROM actual EXCEPT SELECT name FROM expected) u), '') AS unexpected
) q;

-- Both setters must use the TRANSACTION-LOCAL form. `set_config(name, value, true)` is the
-- entire reason the flag cannot outlive one PostgREST request: PostgREST runs each request in
-- its own transaction, so a session-level set here would leave the role guard disabled for
-- every later request on that pooled connection. A missing `true` would be catastrophic and
-- completely invisible in review.
\echo '--- 7c: both setters set the flag transaction-locally ---'
SELECT CASE WHEN (
    SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('claim_pending_admin_invites', 'set_admin_role')
      AND p.prosrc LIKE '%set_config(''dormcheck.role_change_authorized'', ''on'', true)%'
  ) = 2
  THEN 'PASS' ELSE 'FAIL: a setter does not use the transaction-local form of set_config' END
  AS flag_is_transaction_local;

-- ── 7d: the flag is DOWN once an authorized RPC returns ──────────────────────────────────
-- Recorded 2026-08-06 as a PINNED HAZARD, fixed by 20261006000000_role_change_flag_reset:
-- neither authorized RPC used to lower dormcheck.role_change_authorized before returning, so
-- once set_admin_role() or claim_pending_admin_invites() had run, protect_profile_role() was
-- disabled for the REST OF THAT TRANSACTION and a raw UPDATE on profiles.role — including a
-- self-escalation to superadmin — applied unchecked. This verdict performed that escalation
-- and reported PASS when it succeeded, on purpose, so the hazard could not be forgotten.
--
-- It was never reachable from a client (PostgREST: one RPC per transaction, §7a), but the
-- containment was §7c's `true` and nothing else; a future definer RPC, batched transaction
-- or server-side job that chained "call the RPC, then touch profiles" would have inherited
-- an open window.
--
-- NOW: §3g and §5 have already run set_admin_role() and claim_pending_admin_invites() in
-- THIS transaction, so the flag would still read 'on' under the old bodies. It must read
-- lowered, and the same self-escalation must be refused by the guard. Both directions are
-- asserted so a body that simply never raises the flag (breaking the legitimate grant,
-- which 3g catches) cannot pass here by accident either.
\echo '--- 7d: the flag is lowered after an authorized RPC, so a follow-on escalation is refused ---'
INSERT INTO _r (k, err) VALUES ('7d', pg_temp._try_as(:'ua_a'::uuid,
  format('UPDATE public.profiles SET role = %L WHERE id = %L', 'superadmin', :'ua_a')));

SELECT CASE
  WHEN coalesce(current_setting('dormcheck.role_change_authorized', true), '') <> 'on'
   AND (SELECT err FROM _r WHERE k = '7d') LIKE '%Cannot modify your own role%'
   AND (SELECT role FROM public.profiles WHERE id = :'ua_a'::uuid) = 'university_admin'
  THEN 'PASS'
  ELSE 'FAIL: the in-transaction flag leak reproduces — flag='
       || coalesce(current_setting('dormcheck.role_change_authorized', true), '<unset>')
       || ', escalation error=' || coalesce((SELECT err FROM _r WHERE k = '7d'), '<none: the UPDATE applied>')
       || ', role=' || (SELECT role::text FROM public.profiles WHERE id = :'ua_a'::uuid) END
  AS flag_lowered_after_authorized_rpc;

ROLLBACK;
