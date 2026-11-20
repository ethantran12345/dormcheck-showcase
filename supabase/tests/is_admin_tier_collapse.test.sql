-- covers: 20261005000000_admin_policies_drop_is_admin_predicate.sql
--
-- The is_admin tier collapse (migration 20261005000000_admin_policies_drop_is_admin_predicate).
--
-- WHY THIS FILE EXISTS. `profiles.is_admin` is derived as `role <> 'user'`, so every policy
-- that read it admitted a delegated `university_admin` as a superadmin. Counted on prod
-- 2026-09-06: 23 policies, 9 of them on objects with no tenant bound at all (the global
-- Amazon catalog and the dorm-photos bucket). docs/audits/backend-audit-2026-09-06.md BA-01
-- and BA-02. This probe was RED against the stack before that migration and is GREEN after.
--
-- WHAT IS ASSERTED
--   §0 the catalog pin: no policy in public or storage reads `profiles.is_admin` any more.
--   §1 global catalog: a university_admin can neither insert nor update amazon_products;
--      a superadmin still can.
--   §2 other students' content at the SAME school: a university_admin cannot delete or edit
--      another student's marketplace listing or student setup; the owner and a superadmin
--      still can.
--   §3 the school's own dorm catalog: a university_admin CAN edit their own school's
--      master_housing row and write its dorm_edits trail, cannot touch another school's, and
--      a plain student can do neither.
--   §4 dorm-photos objects, scoped through the `<dorm id>/…` path: own-school upload and
--      rename work, other-school upload and rename are refused, a plain student cannot upload
--      at all. (Direct DELETE on storage.objects is refused by the storage schema itself, so
--      the DELETE policy is covered by §0 and the migration's self-check.)
--
-- FIDELITY. Every assertion runs through pg_temp._assume(), so session_user='authenticator'
-- exactly as PostgREST presents it. Two-phase: every action is RECORDED in its own
-- statement and judged afterwards (see admin_invitations_rails.test.sql for why).
--
-- Rolled back at the end.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/is_admin_tier_collapse.test.sql

\set ON_ERROR_STOP on

\set uni_a   '00000000-0000-4000-8000-000000000001'
\set uni_b   'ad1a0000-0000-4000-8000-0000000000b2'
\set ua_a    'ad1a0000-0000-4000-8000-0000000000a1'
\set ua_b    'ad1a0000-0000-4000-8000-0000000000b1'
\set sa      'ad1a0000-0000-4000-8000-0000000000c1'
\set plain_a 'ad1a0000-0000-4000-8000-0000000000d1'
\set l1      'ad1a0000-0000-4000-8000-0000000a0001'
\set l2      'ad1a0000-0000-4000-8000-0000000a0002'
\set l3      'ad1a0000-0000-4000-8000-0000000a0003'
\set prod    'ad1a0000-0000-4000-8000-0000000b0001'

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp._assume(want text) RETURNS text LANGUAGE plpgsql AS $_assume$
BEGIN
  PERFORM set_config('session_authorization', NULL, true);
  PERFORM set_config(
    'session_authorization',
    CASE WHEN want IN ('authenticated', 'anon', 'service_role') THEN 'authenticator' ELSE 'postgres' END,
    true);
  PERFORM set_config('role', want, true);
  RETURN want;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION USING
    MESSAGE = format('pg_temp._assume(%L) needs a SUPERUSER connection; this one is %I.', want, session_user),
    HINT = 'Run the suite through scripts/test-db.sh, which connects as supabase_admin.';
END $_assume$;

SELECT pg_temp._assume('postgres');

CREATE OR REPLACE FUNCTION pg_temp._as_user(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
END $$;

-- Run a statement as `uid`; NULL when permitted, the error text when refused. RLS makes a
-- refused UPDATE/DELETE affect zero rows silently, so those are judged by row state below.
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

-- ── fixtures ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active) VALUES
  (:'uni_a', 'pitt',             'University of Pittsburgh', 'Pitt', ARRAY['pitt.edu'], true),
  (:'uni_b', 'collapse-probe-b', 'Collapse Probe University B', 'CPB', ARRAY['cpb.edu'], true)
ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active, email_domains = EXCLUDED.email_domains;

INSERT INTO auth.users (id, instance_id, aud, role, email,
                        confirmation_token, recovery_token, email_change_token_new, email_change) VALUES
  (:'ua_a'::uuid,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'collapse-ua-a@pitt.edu', '', '', '', ''),
  (:'ua_b'::uuid,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'collapse-ua-b@cpb.edu',  '', '', '', ''),
  (:'sa'::uuid,      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'collapse-sa@pitt.edu',   '', '', '', ''),
  (:'plain_a'::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'collapse-plain@pitt.edu','', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- on_auth_user_created already made each profiles row: DO UPDATE must name every column.
INSERT INTO public.profiles (id, email, full_name, university_id, role) VALUES
  (:'ua_a'::uuid,    'collapse-ua-a@pitt.edu',  'Collapse UA A',  :'uni_a', 'university_admin'),
  (:'ua_b'::uuid,    'collapse-ua-b@cpb.edu',   'Collapse UA B',  :'uni_b', 'university_admin'),
  (:'sa'::uuid,      'collapse-sa@pitt.edu',    'Collapse SA',    :'uni_a', 'superadmin'),
  (:'plain_a'::uuid, 'collapse-plain@pitt.edu', 'Collapse Plain', :'uni_a', 'user')
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email, full_name = EXCLUDED.full_name,
      university_id = EXCLUDED.university_id, role = EXCLUDED.role;

INSERT INTO public.master_housing (id, university_id, details) VALUES
  (990101, :'uni_a', 'collapse-probe-original-a'),
  (990102, :'uni_b', 'collapse-probe-original-b')
ON CONFLICT (id) DO UPDATE SET university_id = EXCLUDED.university_id, details = EXCLUDED.details;

INSERT INTO public.marketplace_listings (id, user_id, title, price, category, university_id, status, moderation_decision) VALUES
  (:'l1'::uuid, :'plain_a'::uuid, 'collapse probe desk lamp',  5, 'other', :'uni_a', 'available', 'approved'),
  (:'l2'::uuid, :'plain_a'::uuid, 'collapse probe desk chair', 5, 'other', :'uni_a', 'available', 'approved'),
  (:'l3'::uuid, :'plain_a'::uuid, 'collapse probe desk fan',   5, 'other', :'uni_a', 'available', 'approved')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.student_setups (id, dorm_name, image_url, caption, user_id, university_id) VALUES
  (990103, 'Litchfield', 'https://example.com/collapse.jpg', 'collapse-probe-original', :'plain_a'::uuid, :'uni_a')
ON CONFLICT (id) DO UPDATE SET caption = EXCLUDED.caption, user_id = EXCLUDED.user_id, university_id = EXCLUDED.university_id;

INSERT INTO public.amazon_products (id, name, price, category, affiliate_link) VALUES
  (:'prod'::uuid, 'collapse probe lamp', 19.99, 'dorm', 'https://www.amazon.com/dp/PROBE?tag=dormcheck-20')
ON CONFLICT (id) DO UPDATE SET price = EXCLUDED.price;

INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES
  ('dorm-photos', '990101/hero/probe-a.jpg', :'sa'::uuid, :'sa'),
  ('dorm-photos', '990102/hero/probe-b.jpg', :'sa'::uuid, :'sa')
ON CONFLICT DO NOTHING;

CREATE TEMP TABLE _r (k text PRIMARY KEY, err text, n bigint);

-- ═══ §0 the catalog pin ══════════════════════════════════════════════════════════════
INSERT INTO _r (k, n) SELECT '0', count(*) FROM pg_policies
  WHERE schemaname IN ('public', 'storage')
    AND (coalesce(qual, '') || coalesce(with_check, '')) ~ 'is_admin = true';

-- ═══ §1 global catalog ═══════════════════════════════════════════════════════════════
INSERT INTO _r (k, err) VALUES ('1a', pg_temp._try_as(:'ua_a'::uuid,
  'INSERT INTO public.amazon_products (name, price, category, affiliate_link) VALUES (''collapse probe ua insert'', 1, ''dorm'', ''https://www.amazon.com/dp/X?tag=dormcheck-20'')'));
INSERT INTO _r (k, err) VALUES ('1b', pg_temp._try_as(:'sa'::uuid,
  'INSERT INTO public.amazon_products (name, price, category, affiliate_link) VALUES (''collapse probe sa insert'', 1, ''dorm'', ''https://www.amazon.com/dp/Y?tag=dormcheck-20'')'));
INSERT INTO _r (k, err) VALUES ('1c', pg_temp._try_as(:'ua_a'::uuid,
  format('UPDATE public.amazon_products SET price = 1 WHERE id = %L', :'prod')));

-- ═══ §2 other students' content at the same school ══════════════════════════════════
INSERT INTO _r (k, err) VALUES ('2a', pg_temp._try_as(:'ua_a'::uuid,
  format('DELETE FROM public.marketplace_listings WHERE id = %L', :'l1')));
INSERT INTO _r (k, err) VALUES ('2b', pg_temp._try_as(:'plain_a'::uuid,
  format('DELETE FROM public.marketplace_listings WHERE id = %L', :'l2')));
INSERT INTO _r (k, err) VALUES ('2c', pg_temp._try_as(:'sa'::uuid,
  format('DELETE FROM public.marketplace_listings WHERE id = %L', :'l3')));
INSERT INTO _r (k, err) VALUES ('2d', pg_temp._try_as(:'ua_a'::uuid,
  format('UPDATE public.marketplace_listings SET title = ''collapse probe edited by ua'' WHERE id = %L', :'l1')));
INSERT INTO _r (k, err) VALUES ('2e', pg_temp._try_as(:'ua_a'::uuid,
  'UPDATE public.student_setups SET caption = ''collapse-probe-edited-by-ua'' WHERE id = 990103'));
INSERT INTO _r (k, err) VALUES ('2f', pg_temp._try_as(:'sa'::uuid,
  'UPDATE public.student_setups SET caption = ''collapse-probe-edited-by-sa'' WHERE id = 990103'));

-- ═══ §3 the school's own dorm catalog ════════════════════════════════════════════════
INSERT INTO _r (k, err) VALUES ('3a', pg_temp._try_as(:'ua_a'::uuid,
  'UPDATE public.master_housing SET details = ''collapse-probe-edited-a'' WHERE id = 990101'));
INSERT INTO _r (k, err) VALUES ('3b', pg_temp._try_as(:'ua_a'::uuid,
  'UPDATE public.master_housing SET details = ''collapse-probe-edited-b'' WHERE id = 990102'));
INSERT INTO _r (k, err) VALUES ('3c', pg_temp._try_as(:'plain_a'::uuid,
  'UPDATE public.master_housing SET details = ''collapse-probe-edited-plain'' WHERE id = 990101'));
INSERT INTO _r (k, err) VALUES ('3d', pg_temp._try_as(:'ua_a'::uuid,
  format('INSERT INTO public.dorm_edits (dorm_id, edited_by, field_name, old_value, new_value) VALUES (990101, %L, ''details'', ''"a"'', ''"b"'')', :'ua_a')));
INSERT INTO _r (k, err) VALUES ('3e', pg_temp._try_as(:'ua_a'::uuid,
  format('INSERT INTO public.dorm_edits (dorm_id, edited_by, field_name, old_value, new_value) VALUES (990102, %L, ''details'', ''"a"'', ''"b"'')', :'ua_a')));
INSERT INTO _r (k, err) VALUES ('3f', pg_temp._try_as(:'plain_a'::uuid,
  format('INSERT INTO public.dorm_edits (dorm_id, edited_by, field_name, old_value, new_value) VALUES (990101, %L, ''details'', ''"a"'', ''"b"'')', :'plain_a')));

-- ═══ §4 dorm-photos objects, scoped through the path ═════════════════════════════════
INSERT INTO _r (k, err) VALUES ('4a', pg_temp._try_as(:'ua_a'::uuid,
  format('INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES (''dorm-photos'', ''990101/hero/ua-upload.jpg'', %L, %L)', :'ua_a', :'ua_a')));
INSERT INTO _r (k, err) VALUES ('4b', pg_temp._try_as(:'ua_a'::uuid,
  format('INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES (''dorm-photos'', ''990102/hero/ua-upload.jpg'', %L, %L)', :'ua_a', :'ua_a')));
-- storage.objects refuses direct DELETE outright (protect_objects_delete: "Use the Storage
-- API instead"), so the DELETE policy is pinned by §0 and the migration's self-check, and the
-- UPDATE policy is exercised here through a rename in place. The rename also proves the new
-- admins_read_dorm_photos SELECT policy: without it an UPDATE whose WHERE reads the row
-- matches nothing, which is exactly how the bucket behaved before the migration.
INSERT INTO _r (k, err) VALUES ('4c', pg_temp._try_as(:'ua_a'::uuid,
  'UPDATE storage.objects SET name = ''990102/hero/renamed-by-ua.jpg'' WHERE bucket_id = ''dorm-photos'' AND name = ''990102/hero/probe-b.jpg'''));
INSERT INTO _r (k, err) VALUES ('4d', pg_temp._try_as(:'plain_a'::uuid,
  format('INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES (''dorm-photos'', ''990101/hero/plain-upload.jpg'', %L, %L)', :'plain_a', :'plain_a')));
INSERT INTO _r (k, err) VALUES ('4e', pg_temp._try_as(:'ua_a'::uuid,
  'UPDATE storage.objects SET name = ''990101/hero/renamed-by-ua.jpg'' WHERE bucket_id = ''dorm-photos'' AND name = ''990101/hero/probe-a.jpg'''));

-- ═══ verdicts ════════════════════════════════════════════════════════════════════════
\echo '--- §0 catalog pin ---'
SELECT CASE WHEN (SELECT n FROM _r WHERE k = '0') = 0 THEN 'PASS'
  ELSE 'FAIL: ' || (SELECT n FROM _r WHERE k = '0') || ' policies still key on profiles.is_admin' END
  AS no_policy_reads_is_admin;

\echo '--- §1 global catalog ---'
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '1a') IS NOT NULL THEN 'PASS'
  ELSE 'FAIL: a university_admin inserted into amazon_products' END AS ua_cannot_insert_amazon_product;
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '1b') IS NULL THEN 'PASS'
  ELSE 'FAIL: superadmin insert refused: ' || (SELECT err FROM _r WHERE k = '1b') END AS sa_can_insert_amazon_product;
SELECT CASE WHEN (SELECT price FROM public.amazon_products WHERE id = :'prod'::uuid) = 19.99 THEN 'PASS'
  ELSE 'FAIL: a university_admin updated an amazon_products row' END AS ua_cannot_update_amazon_product;

\echo '--- §2 other students content, same school ---'
SELECT CASE WHEN EXISTS (SELECT 1 FROM public.marketplace_listings WHERE id = :'l1'::uuid) THEN 'PASS'
  ELSE 'FAIL: a university_admin deleted another student''s listing' END AS ua_cannot_delete_other_listing;
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.marketplace_listings WHERE id = :'l2'::uuid) THEN 'PASS'
  ELSE 'FAIL: the owner could not delete their own listing: ' || coalesce((SELECT err FROM _r WHERE k = '2b'), 'no error, row survived') END AS owner_can_delete_own_listing;
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.marketplace_listings WHERE id = :'l3'::uuid) THEN 'PASS'
  ELSE 'FAIL: superadmin could not delete a listing: ' || coalesce((SELECT err FROM _r WHERE k = '2c'), 'no error, row survived') END AS sa_can_delete_listing;
SELECT CASE WHEN (SELECT title FROM public.marketplace_listings WHERE id = :'l1'::uuid) = 'collapse probe desk lamp' THEN 'PASS'
  ELSE 'FAIL: a university_admin edited another student''s listing' END AS ua_cannot_edit_other_listing;
SELECT CASE WHEN (SELECT caption FROM public.student_setups WHERE id = 990103) IN ('collapse-probe-original', 'collapse-probe-edited-by-sa') THEN 'PASS'
  ELSE 'FAIL: a university_admin edited another student''s setup' END AS ua_cannot_edit_other_setup;
SELECT CASE WHEN (SELECT caption FROM public.student_setups WHERE id = 990103) = 'collapse-probe-edited-by-sa' THEN 'PASS'
  ELSE 'FAIL: superadmin could not edit a setup: ' || coalesce((SELECT err FROM _r WHERE k = '2f'), 'no error, row unchanged') END AS sa_can_edit_setup;

\echo '--- §3 own dorm catalog ---'
SELECT CASE WHEN (SELECT details FROM public.master_housing WHERE id = 990101) = 'collapse-probe-edited-a' THEN 'PASS'
  ELSE 'FAIL: a university_admin could not edit their own school''s dorm: ' || coalesce((SELECT err FROM _r WHERE k = '3a'), 'no error, row unchanged') END AS ua_can_edit_own_school_dorm;
SELECT CASE WHEN (SELECT details FROM public.master_housing WHERE id = 990102) = 'collapse-probe-original-b' THEN 'PASS'
  ELSE 'FAIL: a university_admin edited another school''s dorm' END AS ua_cannot_edit_other_school_dorm;
SELECT CASE WHEN (SELECT details FROM public.master_housing WHERE id = 990101) <> 'collapse-probe-edited-plain' THEN 'PASS'
  ELSE 'FAIL: a plain student edited a dorm row' END AS plain_cannot_edit_dorm;
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '3d') IS NULL THEN 'PASS'
  ELSE 'FAIL: own-school dorm_edits insert refused: ' || (SELECT err FROM _r WHERE k = '3d') END AS ua_can_log_own_school_dorm_edit;
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '3e') IS NOT NULL THEN 'PASS'
  ELSE 'FAIL: a university_admin logged a dorm edit for another school''s dorm' END AS ua_cannot_log_other_school_dorm_edit;
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '3f') IS NOT NULL THEN 'PASS'
  ELSE 'FAIL: a plain student wrote to dorm_edits' END AS plain_cannot_log_dorm_edit;

\echo '--- §4 dorm-photos objects ---'
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '4a') IS NULL THEN 'PASS'
  ELSE 'FAIL: own-school dorm photo upload refused: ' || (SELECT err FROM _r WHERE k = '4a') END AS ua_can_upload_own_school_dorm_photo;
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '4b') IS NOT NULL THEN 'PASS'
  ELSE 'FAIL: a university_admin uploaded a photo into another school''s dorm folder' END AS ua_cannot_upload_other_school_dorm_photo;
SELECT CASE WHEN EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'dorm-photos' AND name = '990102/hero/probe-b.jpg') THEN 'PASS'
  ELSE 'FAIL: a university_admin renamed another school''s dorm photo' END AS ua_cannot_rename_other_school_dorm_photo;
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '4d') IS NOT NULL THEN 'PASS'
  ELSE 'FAIL: a plain student uploaded a dorm photo' END AS plain_cannot_upload_dorm_photo;
SELECT CASE WHEN EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'dorm-photos' AND name = '990101/hero/renamed-by-ua.jpg') THEN 'PASS'
  ELSE 'FAIL: a university_admin could not rename their own school''s dorm photo: ' || coalesce((SELECT err FROM _r WHERE k = '4e'), 'no error, row unchanged') END AS ua_can_rename_own_school_dorm_photo;

ROLLBACK;
