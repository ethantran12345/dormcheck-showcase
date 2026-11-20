-- Behavior-equivalence probe for the 5 advisor-flagged cross-user views.
-- Three are converted by the 20260813* migrations to security_invoker wrappers
-- over verbatim definer bodies in `private` (seller_rating_stats,
-- marketplace_listings_contact, roommate_search_posts_contact); the last two
-- (public_profiles, roommate_profiles) are converted by the 20260820*
-- migrations to security_invoker views over RLS'd projection tables
-- (profiles_public / profiles_roommate, synced from `profiles` by trigger) —
-- the PostgREST embeds they serve now resolve through FKs to the projection
-- tables. This probe pins the exact visibility matrix for ALL five —
-- cross-user reads, show_* contact masking with owner override, tenant
-- scoping, and logged-out parity — inside a rolled-back transaction, so any
-- future mechanism change must preserve it.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/definer_view_invoker.test.sql

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
INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active)
VALUES ('00000000-0000-4000-8000-000000000002', 'cmu', 'Carnegie Mellon University', 'CMU',
        ARRAY['andrew.cmu.edu','cmu.edu'], true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('31111111-aaaa-4aaa-8aaa-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL), -- Alice (Pitt)
  ('32222222-bbbb-4bbb-8bbb-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL), -- Bob   (Pitt, public roommate profile + seller + listings)
  ('33333333-cccc-4ccc-8ccc-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)  -- Carol (other tenant)
ON CONFLICT (id) DO NOTHING;

-- Carol's tenant shares its marketplace with NOBODY (marketplace_group IS NULL).
-- She used to be a CMU student, but 20260918000000 put Pitt and CMU in one
-- marketplace group, which legitimately makes several "other uni sees nothing"
-- assertions below false. This suite is about DEFINER-vs-INVOKER view
-- semantics, not about the group, so Carol moves to an ungrouped school and
-- every assertion keeps testing exactly what it was written to test — now
-- against the group boundary rather than the plain tenant boundary. The
-- in-group cross-visibility that replaced it is asserted in
-- supabase/tests/tenant_isolation.test.sql, where it belongs.
INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active, marketplace_group)
VALUES ('00000000-0000-4000-8000-000000000009', 'isolatedu', 'Isolated University', 'Iso',
        ARRAY['isolated.edu'], true, NULL)
ON CONFLICT (id) DO UPDATE SET marketplace_group = NULL;

INSERT INTO public.profiles (id, full_name, university_id, is_public) VALUES
  ('31111111-aaaa-4aaa-8aaa-111111111111', 'DVI Alice Pitt', '00000000-0000-4000-8000-000000000001', false),
  ('32222222-bbbb-4bbb-8bbb-222222222222', 'DVI Bob Pitt',   '00000000-0000-4000-8000-000000000001', true),
  ('33333333-cccc-4ccc-8ccc-333333333333', 'DVI Carol Iso',  '00000000-0000-4000-8000-000000000009', true)
ON CONFLICT (id) DO UPDATE SET university_id = EXCLUDED.university_id, is_public = EXCLUDED.is_public;

-- Bob's marketplace listing: phone hidden, instagram shown.
INSERT INTO public.marketplace_listings (id, user_id, title, price, category, university_id,
                                         phone_number, instagram_handle, snapchat_handle,
                                         show_phone, show_instagram, show_snapchat) VALUES
  ('99000031-0000-4000-8000-000000000001', '32222222-bbbb-4bbb-8bbb-222222222222', 'dvi listing', 10, 'other',
   '00000000-0000-4000-8000-000000000001', '412-555-0000', 'bob_ig', 'bob_snap', false, true, false);

-- Bob's roommate search post: phone hidden, snapchat shown.
INSERT INTO public.roommate_search_posts (id, user_id, post_type, content, university_id,
                                          phone_number, instagram, snapchat,
                                          show_phone, show_instagram, show_snapchat, is_active) VALUES
  ('99000032-0000-4000-8000-000000000001', '32222222-bbbb-4bbb-8bbb-222222222222', 'looking-for-roommates', 'dvi post',
   '00000000-0000-4000-8000-000000000001', '412-555-0001', 'bob_ig2', 'bob_snap2', false, false, true, true);

-- Alice rates seller Bob.
INSERT INTO public.seller_ratings (rater_id, seller_id, stars) VALUES
  ('31111111-aaaa-4aaa-8aaa-111111111111', '32222222-bbbb-4bbb-8bbb-222222222222', 4);

-- ── Helpers ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp._as_user(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp._as_anon() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  PERFORM pg_temp._assume('anon');
END $$;

CREATE OR REPLACE FUNCTION pg_temp._reset_role() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('postgres');
  PERFORM set_config('request.jwt.claims', '', true);
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
  alice uuid := '31111111-aaaa-4aaa-8aaa-111111111111';
  bob   uuid := '32222222-bbbb-4bbb-8bbb-222222222222';
  carol uuid := '33333333-cccc-4ccc-8ccc-333333333333';
  n int; ph text; ig text; sc text; avg_s numeric;
  denied boolean;
BEGIN
  -- 1. roommate_profiles: cross-user feed non-empty, tenant-scoped, own row always visible
  PERFORM pg_temp._as_user(alice);
  SELECT count(*) INTO n FROM public.roommate_profiles WHERE id = bob;
  PERFORM pg_temp._assert('roommate_profiles: Alice sees Bob (cross-user, same uni)', n = 1);
  PERFORM pg_temp._as_user(alice);
  SELECT count(*) INTO n FROM public.roommate_profiles WHERE id = carol;
  PERFORM pg_temp._assert('roommate_profiles: Alice cannot see Carol (other uni)', n = 0);
  PERFORM pg_temp._as_user(alice);
  SELECT count(*) INTO n FROM public.roommate_profiles WHERE id = alice;
  PERFORM pg_temp._assert('roommate_profiles: Alice sees own row though is_public=false', n = 1);
  PERFORM pg_temp._as_user(bob);
  SELECT count(*) INTO n FROM public.roommate_profiles WHERE id = alice;
  PERFORM pg_temp._assert('roommate_profiles: Bob cannot see private Alice', n = 0);

  -- 2. public_profiles: identity is tenant-scoped as of 20260820* (the change
  --    the 2026-07-17 "public_profiles unscoped" note deferred): same-tenant
  --    users always see name/avatar regardless of is_public (a DM needs a
  --    sender), cross-tenant identity is hidden (superadmins excepted).
  PERFORM pg_temp._as_user(alice);
  SELECT count(*) INTO n FROM public.public_profiles WHERE id = bob;
  PERFORM pg_temp._assert('public_profiles: Alice sees Bob', n = 1);
  PERFORM pg_temp._as_user(alice);
  SELECT count(*) INTO n FROM public.public_profiles WHERE id = carol;
  PERFORM pg_temp._assert('public_profiles: Alice cannot see Carol (tenant-scoped)', n = 0);
  PERFORM pg_temp._as_user(carol);
  SELECT count(*) INTO n FROM public.public_profiles WHERE id = alice;
  PERFORM pg_temp._assert('public_profiles: Carol (other uni) cannot see Alice', n = 0);
  PERFORM pg_temp._as_user(bob);
  SELECT count(*) INTO n FROM public.public_profiles WHERE id = alice;
  PERFORM pg_temp._assert('public_profiles: Bob sees non-public Alice (identity has no opt-out)', n = 1);
  PERFORM pg_temp._as_user(carol);
  SELECT count(*) INTO n FROM public.public_profiles WHERE id = carol;
  PERFORM pg_temp._assert('public_profiles: Carol sees own row', n = 1);

  -- 3. seller_rating_stats: visible cross-user within tenant, not cross-tenant
  PERFORM pg_temp._as_user(alice);
  SELECT avg_stars, rating_count INTO avg_s, n FROM public.seller_rating_stats WHERE seller_id = bob;
  PERFORM pg_temp._assert('seller_rating_stats: Alice sees Bob''s stats', avg_s = 4.0 AND n = 1);
  PERFORM pg_temp._as_user(bob);
  SELECT count(*) INTO n FROM public.seller_rating_stats WHERE seller_id = bob;
  PERFORM pg_temp._assert('seller_rating_stats: Bob sees own stats', n = 1);
  PERFORM pg_temp._as_user(carol);
  SELECT count(*) INTO n FROM public.seller_rating_stats WHERE seller_id = bob;
  PERFORM pg_temp._assert('seller_rating_stats: Carol (other uni) sees nothing', n = 0);

  -- 4. marketplace_listings_contact: show_* masking, owner override, tenant scope
  PERFORM pg_temp._as_user(alice);
  SELECT phone_number, instagram_handle, snapchat_handle INTO ph, ig, sc
    FROM public.marketplace_listings_contact WHERE id = '99000031-0000-4000-8000-000000000001';
  PERFORM pg_temp._assert('mlc: non-owner phone hidden (show_phone=false)', ph IS NULL);
  PERFORM pg_temp._assert('mlc: non-owner instagram visible (show_instagram=true)', ig = 'bob_ig');
  PERFORM pg_temp._assert('mlc: non-owner snapchat hidden', sc IS NULL);
  PERFORM pg_temp._as_user(bob);
  SELECT phone_number INTO ph FROM public.marketplace_listings_contact WHERE id = '99000031-0000-4000-8000-000000000001';
  PERFORM pg_temp._assert('mlc: owner sees own phone despite show_phone=false', ph = '412-555-0000');
  PERFORM pg_temp._as_user(carol);
  SELECT count(*) INTO n FROM public.marketplace_listings_contact WHERE id = '99000031-0000-4000-8000-000000000001';
  PERFORM pg_temp._assert('mlc: other-uni user sees zero rows', n = 0);

  -- 5. roommate_search_posts_contact: show_* masking + owner override
  PERFORM pg_temp._as_user(alice);
  SELECT phone_number, instagram, snapchat INTO ph, ig, sc
    FROM public.roommate_search_posts_contact WHERE id = '99000032-0000-4000-8000-000000000001';
  PERFORM pg_temp._assert('rspc: non-owner phone hidden', ph IS NULL);
  PERFORM pg_temp._assert('rspc: non-owner instagram hidden', ig IS NULL);
  PERFORM pg_temp._assert('rspc: non-owner snapchat visible (show_snapchat=true)', sc = 'bob_snap2');
  PERFORM pg_temp._as_user(bob);
  SELECT phone_number INTO ph FROM public.roommate_search_posts_contact WHERE id = '99000032-0000-4000-8000-000000000001';
  PERFORM pg_temp._assert('rspc: owner sees own phone', ph = '412-555-0001');

  -- 6. logged-out gets nothing. Anon parity holds across mechanisms: the
  -- wrapper views calling is_superadmin()/current_university_id() error on
  -- function EXECUTE (checked as the CALLER even inside definer views);
  -- public_profiles/roommate_profiles now deny on the missing anon SELECT
  -- grant on the view itself. Either way: insufficient_privilege, as before.
  PERFORM pg_temp._as_anon();
  BEGIN
    SELECT count(*) INTO n FROM public.public_profiles;
    denied := false;
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM pg_temp._assert('anon: public_profiles denied (no anon grant, as before)', denied);
  PERFORM pg_temp._as_anon();
  BEGIN
    SELECT count(*) INTO n FROM public.seller_rating_stats;
    denied := false;
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM pg_temp._assert('anon: seller_rating_stats denied (as before)', denied);
  PERFORM pg_temp._as_anon();
  BEGIN
    SELECT count(*) INTO n FROM public.marketplace_listings_contact;
    denied := false;
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM pg_temp._assert('anon: marketplace_listings_contact denied (as before)', denied);
  PERFORM pg_temp._as_anon();
  BEGIN
    SELECT count(*) INTO n FROM public.roommate_profiles;
    denied := false;
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM pg_temp._assert('anon: roommate_profiles permission denied (no anon grant, as before)', denied);
  PERFORM pg_temp._as_anon();
  BEGIN
    SELECT count(*) INTO n FROM public.roommate_search_posts_contact;
    denied := false;
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM pg_temp._assert('anon: roommate_search_posts_contact permission denied (as before)', denied);

  PERFORM pg_temp._reset_role();
  RAISE NOTICE 'definer_view_invoker: all assertions passed';
END $$;

ROLLBACK;
