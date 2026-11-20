-- covers: 20260918000000_shared_marketplace_group.sql
-- Live cross-tenant isolation probe (CI companion to scripts/verify-tenant-isolation.sql,
-- which remains the against-prod recipe). Seeds two tenants' users + one row per root/child
-- surface, then asserts zero cross-visibility and creation-time confinement — all inside a
-- rolled-back transaction.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/tenant_isolation.test.sql

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
-- CMU tenant exists via migration 20260723000000; ensure it here too so the test
-- doesn't depend on seed order.
INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active)
VALUES ('00000000-0000-4000-8000-000000000002', 'cmu', 'Carnegie Mellon University', 'CMU',
        ARRAY['andrew.cmu.edu','cmu.edu'], true)
ON CONFLICT (id) DO NOTHING;

-- A third tenant that shares its marketplace with NOBODY (marketplace_group IS
-- NULL). Without it the shared-marketplace assertions below cannot tell
-- "Pitt and CMU share a group" apart from "the policy stopped filtering", which
-- is the only failure mode of this change that actually matters.
INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active, marketplace_group)
VALUES ('00000000-0000-4000-8000-000000000009', 'isolatedu', 'Isolated University', 'Iso',
        ARRAY['isolated.edu'], true, NULL)
ON CONFLICT (id) DO UPDATE SET marketplace_group = NULL;

-- Pitt and CMU must be in one group for the shared-marketplace assertions; set
-- it here rather than relying on the seed migration having run.
UPDATE public.universities SET marketplace_group = 'pittsburgh'
 WHERE slug IN ('pitt', 'cmu');

-- Null-email throwaway users (null email skips the signup domain gate).
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('11111111-aaaa-4aaa-8aaa-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('22222222-bbbb-4bbb-8bbb-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('33333333-cccc-4ccc-8ccc-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, full_name, university_id) VALUES
  ('11111111-aaaa-4aaa-8aaa-111111111111', 'Iso Test Pitt', '00000000-0000-4000-8000-000000000001'),
  ('22222222-bbbb-4bbb-8bbb-222222222222', 'Iso Test CMU',  '00000000-0000-4000-8000-000000000002'),
  ('33333333-cccc-4ccc-8ccc-333333333333', 'Iso Test Ungrouped', '00000000-0000-4000-8000-000000000009')
ON CONFLICT (id) DO UPDATE SET university_id = EXCLUDED.university_id;

-- One row per tenant on each root surface (inserted as postgres; university_id explicit).
INSERT INTO public.master_housing (id, university_id) VALUES
  (99000001, '00000000-0000-4000-8000-000000000001'),
  (99000002, '00000000-0000-4000-8000-000000000002');

INSERT INTO public.marketplace_listings (id, user_id, title, price, category, university_id) VALUES
  ('99000001-0000-4000-8000-000000000001', '11111111-aaaa-4aaa-8aaa-111111111111', 'iso pitt listing', 10, 'other', '00000000-0000-4000-8000-000000000001'),
  ('99000002-0000-4000-8000-000000000002', '22222222-bbbb-4bbb-8bbb-222222222222', 'iso cmu listing', 10, 'other', '00000000-0000-4000-8000-000000000002'),
  -- The ungrouped school's own listing: proves the group members cannot see OUT,
  -- not merely that the ungrouped user cannot see IN.
  ('99000009-0000-4000-8000-000000000009', '33333333-cccc-4ccc-8ccc-333333333333', 'iso ungrouped listing', 10, 'other', '00000000-0000-4000-8000-000000000009');

INSERT INTO public.marketplace_listing_items (listing_id, name, price) VALUES
  ('99000001-0000-4000-8000-000000000001', 'iso pitt item', 5),
  ('99000002-0000-4000-8000-000000000002', 'iso cmu item', 5);

INSERT INTO public.dorm_questions (id, dorm_id, user_id, question, university_id) VALUES
  ('99000011-0000-4000-8000-000000000001', 99000001, '11111111-aaaa-4aaa-8aaa-111111111111', 'iso pitt q?', '00000000-0000-4000-8000-000000000001'),
  ('99000012-0000-4000-8000-000000000002', 99000002, '22222222-bbbb-4bbb-8bbb-222222222222', 'iso cmu q?', '00000000-0000-4000-8000-000000000002');

INSERT INTO public.dorm_answers (question_id, user_id, answer) VALUES
  ('99000011-0000-4000-8000-000000000001', '11111111-aaaa-4aaa-8aaa-111111111111', 'iso pitt a'),
  ('99000012-0000-4000-8000-000000000002', '22222222-bbbb-4bbb-8bbb-222222222222', 'iso cmu a');

INSERT INTO public.student_setups (id, user_id, dorm_name, image_url, university_id) VALUES
  (99000001, '11111111-aaaa-4aaa-8aaa-111111111111', 'iso pitt dorm', 'x.jpg', '00000000-0000-4000-8000-000000000001'),
  (99000002, '22222222-bbbb-4bbb-8bbb-222222222222', 'iso cmu dorm', 'x.jpg', '00000000-0000-4000-8000-000000000002');

INSERT INTO public.setup_photos (id, setup_id, image_url) VALUES
  (99000001, 99000001, 'x.jpg'),
  (99000002, 99000002, 'x.jpg');

INSERT INTO public.business_listings (id, user_id, business_name, category, description, university_id) VALUES
  ('99000021-0000-4000-8000-000000000001', '11111111-aaaa-4aaa-8aaa-111111111111', 'iso pitt biz', 'other', 'x', '00000000-0000-4000-8000-000000000001'),
  ('99000022-0000-4000-8000-000000000002', '22222222-bbbb-4bbb-8bbb-222222222222', 'iso cmu biz', 'other', 'x', '00000000-0000-4000-8000-000000000002');

INSERT INTO public.roommate_search_posts (id, user_id, post_type, content, university_id) VALUES
  ('99000031-0000-4000-8000-000000000001', '11111111-aaaa-4aaa-8aaa-111111111111', 'looking-for-roommates', 'iso pitt post', '00000000-0000-4000-8000-000000000001'),
  ('99000032-0000-4000-8000-000000000002', '22222222-bbbb-4bbb-8bbb-222222222222', 'looking-for-roommates', 'iso cmu post', '00000000-0000-4000-8000-000000000002');

-- ── Harness ──────────────────────────────────────────────────────────────────
CREATE TEMP TABLE test_results (name text, pass boolean, detail text);

CREATE OR REPLACE FUNCTION _assert(label text, cond boolean, detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO test_results VALUES (label, cond, detail);
  IF NOT cond THEN RAISE NOTICE 'FAIL: % - %', label, detail;
  ELSE RAISE NOTICE 'PASS: %', label; END IF;
END;
$$;

-- Count rows visible to an authenticated user (auth.uid() = p_uid).
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
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RAISE;
END;
$$;

-- Run a statement as an authenticated user; returns SQLERRM or NULL.
CREATE OR REPLACE FUNCTION pg_temp._exec_as(p_uid uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  EXECUTE p_sql;
  PERFORM pg_temp._assume('postgres');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RETURN SQLERRM;
END;
$$;

-- ── Cross-visibility: each user sees own tenant's row and not the other's ────
DO $$
DECLARE
  pitt uuid := '11111111-aaaa-4aaa-8aaa-111111111111';
  cmu  uuid := '22222222-bbbb-4bbb-8bbb-222222222222';
  ungrouped uuid := '33333333-cccc-4ccc-8ccc-333333333333';
  surface record;
BEGIN
  FOR surface IN SELECT * FROM (VALUES
    ('master_housing',        'SELECT 1 FROM master_housing WHERE id = 99000001',                                        'SELECT 1 FROM master_housing WHERE id = 99000002'),
    -- marketplace_listings and marketplace_listing_items are NOT in this loop
    -- any more: they are the shared surface. Their (asymmetric) rules are
    -- asserted in the block below, including that the widening is bounded.
    ('dorm_questions',        'SELECT 1 FROM dorm_questions WHERE id = ''99000011-0000-4000-8000-000000000001''',        'SELECT 1 FROM dorm_questions WHERE id = ''99000012-0000-4000-8000-000000000002'''),
    ('dorm_answers',          'SELECT 1 FROM dorm_answers WHERE question_id = ''99000011-0000-4000-8000-000000000001''', 'SELECT 1 FROM dorm_answers WHERE question_id = ''99000012-0000-4000-8000-000000000002'''),
    ('student_setups',        'SELECT 1 FROM student_setups WHERE id = 99000001',                                        'SELECT 1 FROM student_setups WHERE id = 99000002'),
    ('setup_photos',          'SELECT 1 FROM setup_photos WHERE setup_id = 99000001',                                    'SELECT 1 FROM setup_photos WHERE setup_id = 99000002'),
    ('business_listings',     'SELECT 1 FROM business_listings WHERE id = ''99000021-0000-4000-8000-000000000001''',     'SELECT 1 FROM business_listings WHERE id = ''99000022-0000-4000-8000-000000000002'''),
    ('roommate_search_posts', 'SELECT 1 FROM roommate_search_posts WHERE id = ''99000031-0000-4000-8000-000000000001''', 'SELECT 1 FROM roommate_search_posts WHERE id = ''99000032-0000-4000-8000-000000000002''')
  ) AS t(name, pitt_row, cmu_row)
  LOOP
    PERFORM _assert(surface.name || ': pitt user sees own row',      pg_temp._count_as(pitt, surface.pitt_row) >= 1);
    PERFORM _assert(surface.name || ': pitt user sees zero CMU rows', pg_temp._count_as(pitt, surface.cmu_row) = 0);
    PERFORM _assert(surface.name || ': cmu user sees own row',       pg_temp._count_as(cmu, surface.cmu_row) >= 1);
    PERFORM _assert(surface.name || ': cmu user sees zero Pitt rows', pg_temp._count_as(cmu, surface.pitt_row) = 0);
  END LOOP;

  -- Identity surface: public_profiles is TENANT-SCOPED as of the 20260820*
  -- projection-table migrations, WIDENED to the marketplace group by
  -- 20260918000000 (otherwise every shared listing shows a faceless seller).
  -- Identity is visible in-tenant and in-group; outside the group it is hidden.
  PERFORM _assert('public_profiles: pitt user CAN see a CMU profile (same marketplace group)',
    pg_temp._count_as(pitt, 'SELECT 1 FROM public_profiles WHERE id = ''' || cmu || '''') >= 1);
  PERFORM _assert('public_profiles: pitt user cannot see an UNGROUPED school''s profile',
    pg_temp._count_as(pitt, 'SELECT 1 FROM public_profiles WHERE id = ''' || ungrouped || '''') = 0);
  PERFORM _assert('public_profiles: ungrouped user cannot see a Pitt profile',
    pg_temp._count_as(ungrouped, 'SELECT 1 FROM public_profiles WHERE id = ''' || pitt || '''') = 0);
END $$;

-- ── Shared marketplace: read across the group, write only into your own school ─
-- 20260918000000 made marketplace_listings deliberately asymmetric. The point of
-- this block is that the widening is BOUNDED: an ungrouped school must still see
-- nothing, and nobody may post into a school that is not theirs.
DO $$
DECLARE
  pitt      uuid := '11111111-aaaa-4aaa-8aaa-111111111111';
  cmu       uuid := '22222222-bbbb-4bbb-8bbb-222222222222';
  ungrouped uuid := '33333333-cccc-4ccc-8ccc-333333333333';
  pitt_row  text := 'SELECT 1 FROM marketplace_listings WHERE id = ''99000001-0000-4000-8000-000000000001''';
  cmu_row   text := 'SELECT 1 FROM marketplace_listings WHERE id = ''99000002-0000-4000-8000-000000000002''';
  pitt_item text := 'SELECT 1 FROM marketplace_listing_items WHERE listing_id = ''99000001-0000-4000-8000-000000000001''';
  cmu_item  text := 'SELECT 1 FROM marketplace_listing_items WHERE listing_id = ''99000002-0000-4000-8000-000000000002''';
  err text;
BEGIN
  -- Reads, within the group.
  PERFORM _assert('marketplace_listings: pitt user sees own row',  pg_temp._count_as(pitt, pitt_row) >= 1);
  PERFORM _assert('marketplace_listings: pitt user SEES the CMU row (shared group)',
    pg_temp._count_as(pitt, cmu_row) >= 1);
  PERFORM _assert('marketplace_listings: cmu user SEES the Pitt row (shared group)',
    pg_temp._count_as(cmu, pitt_row) >= 1);
  -- Children follow their parent (class B, EXISTS on marketplace_listings).
  PERFORM _assert('marketplace_listing_items: pitt user sees the CMU listing''s items',
    pg_temp._count_as(pitt, cmu_item) >= 1);
  PERFORM _assert('marketplace_listing_items: cmu user sees the Pitt listing''s items',
    pg_temp._count_as(cmu, pitt_item) >= 1);

  -- The bound. If shares_marketplace() ever degrades to "true", these are the
  -- assertions that catch it — everything above would still pass.
  PERFORM _assert('marketplace_listings: UNGROUPED user sees zero Pitt rows',
    pg_temp._count_as(ungrouped, pitt_row) = 0);
  PERFORM _assert('marketplace_listings: UNGROUPED user sees zero CMU rows',
    pg_temp._count_as(ungrouped, cmu_row) = 0);
  PERFORM _assert('marketplace_listing_items: UNGROUPED user sees zero Pitt items',
    pg_temp._count_as(ungrouped, pitt_item) = 0);
  PERFORM _assert('marketplace_listings: pitt user sees zero rows of an UNGROUPED school',
    pg_temp._count_as(pitt,
      'SELECT 1 FROM marketplace_listings WHERE id = ''99000009-0000-4000-8000-000000000009''') = 0);

  -- Writes stay confined to your own school, group or no group. This is the
  -- WITH CHECK half, and it is the half a widened USING clause could quietly
  -- take with it.
  err := pg_temp._exec_as(pitt,
    'INSERT INTO public.marketplace_listings (id, user_id, title, price, category, university_id) VALUES '
    || '(''99000097-0000-4000-8000-000000000097'', ''' || pitt || ''', ''cross-post'', 1, ''other'', '
    || '''00000000-0000-4000-8000-000000000002'')');
  PERFORM _assert('marketplace_listings: posting INTO another group school is blocked',
    err IS NOT NULL, coalesce(err, 'insert succeeded'));

  err := pg_temp._exec_as(pitt,
    'INSERT INTO public.marketplace_listings (id, user_id, title, price, category, university_id) VALUES '
    || '(''99000098-0000-4000-8000-000000000098'', ''' || pitt || ''', ''own-post'', 1, ''other'', '
    || '''00000000-0000-4000-8000-000000000001'')');
  PERFORM _assert('marketplace_listings: posting into your OWN school still works',
    err IS NULL, coalesce(err, ''));
END $$;

-- ── Creation-time confinement + tenant trigger ───────────────────────────────
DO $$
DECLARE
  pitt uuid := '11111111-aaaa-4aaa-8aaa-111111111111';
  cmu  uuid := '22222222-bbbb-4bbb-8bbb-222222222222';
  ungrouped uuid := '33333333-cccc-4ccc-8ccc-333333333333';
  err text;
  v uuid;
BEGIN
  -- 20260918000000: a DM may cross schools that SHARE a marketplace group — a
  -- shared listing you cannot ask about is not a listing. Consent is unchanged
  -- and is not carried by this policy: conversations.status + initiated_by and
  -- rls_conversations_insert_privacy_gate still make it a request to accept.
  err := pg_temp._exec_as(pitt,
    'INSERT INTO public.conversations (participant_1, participant_2) VALUES (''' || pitt || ''', ''' || cmu || ''')');
  PERFORM _assert('conversation INSERT across a SHARED group is allowed', err IS NULL, coalesce(err, ''));

  -- …and the bound: no group, no cross-school DM. This is the assertion that
  -- fails if tenant_confined ever degrades into "any two authenticated users".
  err := pg_temp._exec_as(pitt,
    'INSERT INTO public.conversations (participant_1, participant_2) VALUES (''' || pitt || ''', ''' || ungrouped || ''')');
  PERFORM _assert('conversation INSERT to an UNGROUPED school is still blocked',
    err IS NOT NULL, coalesce(err, 'insert succeeded'));

  err := pg_temp._exec_as(pitt,
    'INSERT INTO public.conversations (participant_1, participant_2) VALUES (''' || pitt || ''', ''' || pitt || ''')');
  PERFORM _assert('same-tenant conversation INSERT still works', err IS NULL, coalesce(err, ''));

  -- Insert without university_id must land in the inserter''s tenant via
  -- set_university_id_from_profile().
  err := pg_temp._exec_as(pitt,
    'INSERT INTO public.dorm_questions (id, dorm_id, user_id, question) VALUES ' ||
    '(''99000099-0000-4000-8000-000000000009'', 99000001, ''' || pitt || ''', ''trigger test?'')');
  PERFORM _assert('root insert without university_id succeeds', err IS NULL, coalesce(err, ''));
  SELECT university_id INTO v FROM public.dorm_questions WHERE id = '99000099-0000-4000-8000-000000000009';
  PERFORM _assert('trigger derives university_id from inserter profile',
    v = '00000000-0000-4000-8000-000000000001', 'got ' || coalesce(v::text, 'NULL'));
END $$;

-- ── Summary / hard fail ──────────────────────────────────────────────────────
DO $$
DECLARE failed int;
BEGIN
  SELECT count(*) INTO failed FROM test_results WHERE NOT pass;
  RAISE NOTICE 'tenant_isolation: % assertions, % failed',
    (SELECT count(*) FROM test_results), failed;
  IF failed > 0 THEN
    RAISE EXCEPTION 'tenant_isolation FAILED: % assertion(s) — see FAIL notices above', failed;
  END IF;
END $$;

ROLLBACK;
