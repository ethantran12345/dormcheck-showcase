-- covers: 20260712220332_listing_verifications.sql
-- covers: 20260918000000_shared_marketplace_group.sql
-- covers: 20260926000000_listing_verifications_superadmin_only.sql
--
-- DELEGATED OUTSIDER DENIAL — the LV-1 class, pinned as it behaves TODAY.
--
-- A permissive policy can deny an outsider two ways. It can say so itself
-- ("user_id = auth.uid()"), or it can say nothing and let the RESTRICTIVE
-- tenant policy do the denying. The second shape is invisible on inspection:
-- the policy reads as admin-scoped, the tenant policy reads as tenant-scoped,
-- and nothing in either says the pair only works when the tenant policy's own
-- predicate is narrow.
--
-- On the 32 tenant-guarded tables, 47 of 111 permissive policies delegate.
-- 16 of those tables carry a tenant policy of the form
--     EXISTS (SELECT 1 FROM <parent> WHERE <parent>.id = <child>.<fk>)
-- which is not a tenant test at all: it is a PARENT-VISIBILITY test, and it is
-- worth exactly as much as the parent's own tenant predicate. When the parent's
-- predicate was widened for the shared marketplace (20260918000000), every
-- delegating policy on its children silently widened with it.
--
-- listing_verifications is where that lands on private data: a student's lease
-- document path or attested street address. Its §5 comment says "Class B tenant
-- isolation: scoped through the parent listing's school", and the parent listing
-- is deliberately NOT scoped to one school any more.
--
-- EVERY ASSERTION BELOW IS CURRENT BEHAVIOUR, NOT DESIRED BEHAVIOUR. The
-- cross-school reads and writes in §2 and §3 are pinned so that a fix has to
-- come here and turn them red on purpose. Do not "fix the test".
--
-- 2026-09-06: the fix came. 20261005000000_admin_policies_drop_is_admin_predicate
-- retired the derived is_admin column as a predicate on all 23 policies that read it,
-- and ml3a, sr4c, st6b and st6c below were turned on purpose from "pinned hazard" to
-- "denied". The parent-delegation shape (st6a) is unchanged and still pinned.
--
-- Measured 2026-08-16 by the mutation matrix in
-- docs/security/rls-delegated-denial-audit.md (3294 measurements, phases A/B/C,
-- pg_policy dump byte-identical before and after).
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/delegated_tenant_denial.test.sql

BEGIN;

-- ── harness role fidelity (docs/security/reaudit-2026-08-06.md H1) ──────────
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

-- ── fixtures ────────────────────────────────────────────────────────────────
-- Pitt and CMU share a marketplace group; "Isolated University" shares with
-- nobody. Without the third school every assertion below could be explained by
-- "the tenant policy stopped filtering" instead of "the group widened it",
-- which is the only reading that matters.
INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active, marketplace_group)
VALUES ('00000000-0000-4000-8000-000000000002', 'cmu', 'Carnegie Mellon University', 'CMU',
        ARRAY['andrew.cmu.edu','cmu.edu'], true, 'pittsburgh')
ON CONFLICT (id) DO UPDATE SET marketplace_group = 'pittsburgh', is_active = true;
INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active, marketplace_group)
VALUES ('00000000-0000-4000-8000-000000000009', 'isolatedu', 'Isolated University', 'Iso',
        ARRAY['isolated.edu'], true, NULL)
ON CONFLICT (id) DO UPDATE SET marketplace_group = NULL, is_active = true;
UPDATE public.universities SET marketplace_group = 'pittsburgh'
 WHERE id = '00000000-0000-4000-8000-000000000001';

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('aaaa0001-0000-4000-8000-00000000aaa1','00000000-0000-0000-0000-000000000000','authenticated','authenticated',NULL),
  ('aaaa0002-0000-4000-8000-00000000aaa2','00000000-0000-0000-0000-000000000000','authenticated','authenticated',NULL),
  ('aaaa0005-0000-4000-8000-00000000aaa5','00000000-0000-0000-0000-000000000000','authenticated','authenticated',NULL),
  ('aaaa0006-0000-4000-8000-00000000aaa6','00000000-0000-0000-0000-000000000000','authenticated','authenticated',NULL),
  ('aaaa0007-0000-4000-8000-00000000aaa7','00000000-0000-0000-0000-000000000000','authenticated','authenticated',NULL),
  ('aaaa0009-0000-4000-8000-00000000aaa9','00000000-0000-0000-0000-000000000000','authenticated','authenticated',NULL)
ON CONFLICT (id) DO NOTHING;

-- The auth.users trigger creates the profiles row first, so every seeded column
-- has to appear in the ON CONFLICT DO UPDATE or it is silently dropped.
-- profiles.is_admin is DERIVED from profiles.role by a trigger; writing it
-- directly is overwritten, which is why these set role and never is_admin.
INSERT INTO public.profiles (id, full_name, university_id, role) VALUES
  ('aaaa0001-0000-4000-8000-00000000aaa1','DTD Pitt student',  '00000000-0000-4000-8000-000000000001','user'),
  ('aaaa0002-0000-4000-8000-00000000aaa2','DTD Pitt uniadmin', '00000000-0000-4000-8000-000000000001','university_admin'),
  ('aaaa0005-0000-4000-8000-00000000aaa5','DTD Iso uniadmin',  '00000000-0000-4000-8000-000000000009','university_admin'),
  ('aaaa0006-0000-4000-8000-00000000aaa6','DTD CMU owner',     '00000000-0000-4000-8000-000000000002','user'),
  ('aaaa0007-0000-4000-8000-00000000aaa7','DTD CMU second',    '00000000-0000-4000-8000-000000000002','user'),
  -- The tier that KEEPS review after 20260926000000. Pitt-homed on purpose, so a superadmin
  -- assertion against the CMU row cannot pass by sharing a university with it.
  ('aaaa0009-0000-4000-8000-00000000aaa9','DTD superadmin',    '00000000-0000-4000-8000-000000000001','superadmin')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name,
                               university_id = EXCLUDED.university_id,
                               role = EXCLUDED.role;

INSERT INTO public.master_housing (id, university_id) VALUES
  (91000002, '00000000-0000-4000-8000-000000000002');

INSERT INTO public.marketplace_listings (id, user_id, title, price, category, university_id) VALUES
  ('cccc0007-0000-4000-8000-000000000002','aaaa0006-0000-4000-8000-00000000aaa6','DTD CMU listing',10,'other','00000000-0000-4000-8000-000000000002'),
  ('cccc001a-0000-4000-8000-000000000002','aaaa0006-0000-4000-8000-00000000aaa6','DTD CMU listing 2',10,'other','00000000-0000-4000-8000-000000000002');

-- The row the whole file is about: a CMU student's attested street address.
INSERT INTO public.listing_verifications (id, listing_id, user_id, method, address_confirmation) VALUES
  ('cccc0009-0000-4000-8000-000000000002','cccc0007-0000-4000-8000-000000000002',
   'aaaa0006-0000-4000-8000-00000000aaa6','address','5000 Forbes Ave, Pittsburgh');

INSERT INTO public.seller_ratings (id, rater_id, seller_id, listing_id, stars) VALUES
  ('cccc000a-0000-4000-8000-000000000002','aaaa0007-0000-4000-8000-00000000aaa7',
   'aaaa0006-0000-4000-8000-00000000aaa6','cccc0007-0000-4000-8000-000000000002',5);

INSERT INTO public.ranking_collaborations (id, owner_id, university_id, group_name, status) VALUES
  ('cccc0012-0000-4000-8000-000000000002','aaaa0006-0000-4000-8000-00000000aaa6',
   '00000000-0000-4000-8000-000000000002','DTD CMU group','accepted');
INSERT INTO public.checklist_share_links (id, group_id, created_by, label) VALUES
  ('cccc0015-0000-4000-8000-000000000002','cccc0012-0000-4000-8000-000000000002',
   'aaaa0006-0000-4000-8000-00000000aaa6','DTD CMU link');

-- ── harness ─────────────────────────────────────────────────────────────────
CREATE TEMP TABLE test_results (name text, pass boolean, detail text);

CREATE OR REPLACE FUNCTION pg_temp._assert(label text, cond boolean, detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- A NULL condition is a broken assertion, not a pass.
  INSERT INTO test_results VALUES (label, COALESCE(cond, false), detail);
  IF COALESCE(cond, false) THEN RAISE NOTICE 'PASS: %', label;
  ELSE RAISE NOTICE 'FAIL: % - %', label, detail; END IF;
END $$;

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
  RETURN -1;   -- an error is NOT zero rows; -1 makes the two impossible to confuse
END $$;

-- Attempt a write as p_uid and report how many rows it touched, then UNDO it.
-- The RAISE aborts the plpgsql subtransaction, which rolls the write back; the
-- count survives because plpgsql variables are memory, not transactional state.
-- Without the undo, assertion N would be measuring the wreckage of assertion N-1.
CREATE OR REPLACE FUNCTION pg_temp._write_as(p_uid uuid, p_sql text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint := -1;
BEGIN
  BEGIN
    PERFORM pg_temp._assume('authenticated');
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION 'DTD_UNDO';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> 'DTD_UNDO' THEN n := -1; END IF;   -- a real RAISE from a trigger
    WHEN OTHERS THEN
      n := -1;                                          -- denied, or refused by a constraint
  END;
  PERFORM pg_temp._assume('postgres');
  RETURN n;
END $$;

-- ── §0 positive controls ────────────────────────────────────────────────────
-- If the identity predicates below were wrong, every count would be 0 and the
-- whole file would read as "nothing leaks" — the most dangerous green there is.
DO $$
BEGIN
  PERFORM pg_temp._assert('c0a owner reads own verification',
    pg_temp._count_as('aaaa0006-0000-4000-8000-00000000aaa6',
      $q$SELECT 1 FROM public.listing_verifications WHERE id='cccc0009-0000-4000-8000-000000000002'$q$) = 1,
    'the CMU owner must see its own row or the fixture is broken');
  PERFORM pg_temp._assert('c0b owner reads own listing',
    pg_temp._count_as('aaaa0006-0000-4000-8000-00000000aaa6',
      $q$SELECT 1 FROM public.marketplace_listings WHERE id='cccc0007-0000-4000-8000-000000000002'$q$) = 1,
    'fixture');
  PERFORM pg_temp._assert('c0c Pitt uni-admin really is an admin',
    (SELECT is_admin FROM public.profiles WHERE id='aaaa0002-0000-4000-8000-00000000aaa2'),
    'is_admin is derived from role by trigger; if it is false the admin-policy assertions prove nothing');
  PERFORM pg_temp._assert('c0d ungrouped uni-admin really is an admin',
    (SELECT is_admin FROM public.profiles WHERE id='aaaa0005-0000-4000-8000-00000000aaa5'),
    'the ungrouped control must differ from the Pitt admin ONLY by school');
END $$;

-- ── §1 LV-1: the read ───────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM pg_temp._assert('lv1a Pitt STUDENT reads 0 CMU verifications',
    pg_temp._count_as('aaaa0001-0000-4000-8000-00000000aaa1',
      $q$SELECT 1 FROM public.listing_verifications WHERE id='cccc0009-0000-4000-8000-000000000002'$q$) = 0,
    'lv_select_own denies on its own predicate — this is why student-vs-student testing missed LV-1');

  -- FIXED by 20260926000000. This asserted the hazard as CURRENT BEHAVIOUR and said a fix
  -- must turn it red; it did, and this is the rewrite. lv_select_admin tested is_admin and
  -- nothing else, while the RESTRICTIVE tenant_isolation policy only asks whether the parent
  -- listing is visible — which the shared marketplace group makes it. The admin branch now
  -- gates on is_superadmin(), so the delegation is bypassed rather than re-derived.
  PERFORM pg_temp._assert('lv1b FIXED Pitt UNI-ADMIN reads 0 CMU verifications',
    pg_temp._count_as('aaaa0002-0000-4000-8000-00000000aaa2',
      $q$SELECT 1 FROM public.listing_verifications WHERE id='cccc0009-0000-4000-8000-000000000002'$q$) = 0,
    'LV-1: a Pitt admin no longer reads a CMU student attested address');

  PERFORM pg_temp._assert('lv1c ungrouped UNI-ADMIN reads 0',
    pg_temp._count_as('aaaa0005-0000-4000-8000-00000000aaa5',
      $q$SELECT 1 FROM public.listing_verifications WHERE id='cccc0009-0000-4000-8000-000000000002'$q$) = 0,
    'the delegation still denies a school OUTSIDE the marketplace group — the group is the mechanism');

  -- STAYS GREEN, AND ITS SUBJECT MOVES. This asserts a DATA fact — CMU's marketplace_group
  -- equals Pitt's — which no policy change can falsify, so it could never have measured the
  -- fix. It earns its place now as the severity multiplier for what is STILL delegated:
  -- cross-school marketplace DELETE (rls_marketplace_listings_delete, rls_seller_ratings_delete)
  -- continues to follow the group, so a Pitt university_admin can still DELETE a CMU listing
  -- and its seller ratings. That was decided not-intended on 2026-08-16 and DEFERRED to its
  -- own lane; this assertion is what keeps the dial visible until then. Each additional school
  -- in the group is another set of admins holding that DELETE.
  PERFORM pg_temp._assert('lv1d reach follows the marketplace group, not the policy',
    (SELECT u.marketplace_group IS NOT NULL
            AND u.marketplace_group = (SELECT marketplace_group FROM public.universities
                                        WHERE id = '00000000-0000-4000-8000-000000000001')
       FROM public.universities u WHERE u.id = '00000000-0000-4000-8000-000000000002'),
    'each additional school in a marketplace group is another set of admins who still hold cross-school DELETE');

  -- NEW with 20260926000000, and the assertion that actually MOVED: a grouped-but-foreign
  -- admin reads zero. Paired with the superadmin case deliberately — "reads 0" alone also
  -- passes against a broken fixture, a deleted row, or a policy that denies everyone, and
  -- one of those would look exactly like a fix.
  PERFORM pg_temp._assert('lv1e grouped-but-foreign UNI-ADMIN reads 0 verifications',
    pg_temp._count_as('aaaa0002-0000-4000-8000-00000000aaa2',
      $q$SELECT 1 FROM public.listing_verifications WHERE id='cccc0009-0000-4000-8000-000000000002'$q$) = 0,
    'the admin branch no longer delegates its outsider denial to the parent listing');
  PERFORM pg_temp._assert('lv1e SUPERADMIN still reads it — the row and the fixture are both intact',
    pg_temp._count_as('aaaa0009-0000-4000-8000-00000000aaa9',
      $q$SELECT 1 FROM public.listing_verifications WHERE id='cccc0009-0000-4000-8000-000000000002'$q$) = 1,
    'is_superadmin() admits the surviving review tier, so the 0 above is scoping and not absence');
END $$;

-- ── §2 LV-1 has a write twin ────────────────────────────────────────────────
-- lv_update_admin is the same shape as lv_select_admin. The audit's mutation
-- matrix measured it failing for the same role, and reviewing a verification is
-- what sets the buyer-visible verified badge on the listing.
DO $$
BEGIN
  -- FIXED by 20260926000000, same shape as lv1b. Reviewing a verification is what sets the
  -- buyer-visible verified badge, via trg_sync_listing_verified_flag — which is AFTER UPDATE
  -- OF status and therefore only fires behind an UPDATE that already passed this policy.
  -- Scoping lv_update_admin scopes that SECURITY DEFINER trigger with it; there is no other
  -- entry point to it.
  PERFORM pg_temp._assert('lv2a FIXED Pitt UNI-ADMIN cannot UPDATE a CMU verification',
    pg_temp._write_as('aaaa0002-0000-4000-8000-00000000aaa2',
      $q$UPDATE public.listing_verifications SET review_note='cross-school'
          WHERE id='cccc0009-0000-4000-8000-000000000002'$q$) = 0,
    'a Pitt admin can no longer review a CMU listing verification');
  PERFORM pg_temp._assert('lv2a SUPERADMIN can still UPDATE it — the review path survives',
    pg_temp._write_as('aaaa0009-0000-4000-8000-00000000aaa9',
      $q$UPDATE public.listing_verifications SET review_note='superadmin review'
          WHERE id='cccc0009-0000-4000-8000-000000000002'$q$) = 1,
    'the 0 above is scoping, not a table nobody can write');
  PERFORM pg_temp._assert('lv2b ungrouped UNI-ADMIN cannot UPDATE it',
    pg_temp._write_as('aaaa0005-0000-4000-8000-00000000aaa5',
      $q$UPDATE public.listing_verifications SET review_note='x'
          WHERE id='cccc0009-0000-4000-8000-000000000002'$q$) = 0,
    'guard holds outside the group');
  PERFORM pg_temp._assert('lv2c Pitt STUDENT cannot UPDATE it',
    pg_temp._write_as('aaaa0001-0000-4000-8000-00000000aaa1',
      $q$UPDATE public.listing_verifications SET review_note='x'
          WHERE id='cccc0009-0000-4000-8000-000000000002'$q$) = 0,
    'no UPDATE policy admits a non-admin');
END $$;

-- ── §3 the same shape on the parent itself ──────────────────────────────────
-- rls_marketplace_listings_delete is "mine OR is_admin", with no tenant
-- predicate, and the tenant policy's USING carries the shares_marketplace
-- widening. So the delete reaches across the group too.
DO $$
BEGIN
  -- Pinned as a HAZARD (= 1) from 2026-08-16 until 20261005000000 rewrote the delete
  -- policy's admin branch from the derived is_admin column to is_superadmin(). A
  -- university_admin no longer deletes ANY other student's listing, in or out of the group.
  PERFORM pg_temp._assert('ml3a Pitt UNI-ADMIN cannot DELETE a CMU listing (fixed 20261005000000)',
    pg_temp._write_as('aaaa0002-0000-4000-8000-00000000aaa2',
      $q$DELETE FROM public.marketplace_listings WHERE id='cccc001a-0000-4000-8000-000000000002'$q$) = 0,
    'a delegated admin deleted another student''s listing across the marketplace group');
  PERFORM pg_temp._assert('ml3b ungrouped UNI-ADMIN cannot DELETE it',
    pg_temp._write_as('aaaa0005-0000-4000-8000-00000000aaa5',
      $q$DELETE FROM public.marketplace_listings WHERE id='cccc001a-0000-4000-8000-000000000002'$q$) = 0,
    'guard holds outside the group');
  PERFORM pg_temp._assert('ml3c Pitt STUDENT cannot DELETE it',
    pg_temp._write_as('aaaa0001-0000-4000-8000-00000000aaa1',
      $q$DELETE FROM public.marketplace_listings WHERE id='cccc001a-0000-4000-8000-000000000002'$q$) = 0,
    'the delete policy self-denies a non-admin non-owner');
  -- By design, and the reason the two above are reachable at all.
  PERFORM pg_temp._assert('ml3d by design: Pitt STUDENT reads the CMU listing',
    pg_temp._count_as('aaaa0001-0000-4000-8000-00000000aaa1',
      $q$SELECT 1 FROM public.marketplace_listings WHERE id='cccc0007-0000-4000-8000-000000000002'$q$) = 1,
    'the shared marketplace is intended; the leak is what rides on it');
END $$;

-- ── §4 seller_ratings: the same delegation, currently masked ────────────────
-- rls_seller_ratings_delete is admin-shaped with no tenant predicate, so the
-- delete side delegates. It does not leak today only because the SELECT side
-- (profile_university(seller_id) = current_university_id()) hides the row, so
-- the DELETE finds nothing to delete. That is one policy away from live.
DO $$
BEGIN
  PERFORM pg_temp._assert('sr4a Pitt UNI-ADMIN reads 0 CMU seller ratings',
    pg_temp._count_as('aaaa0002-0000-4000-8000-00000000aaa2',
      $q$SELECT 1 FROM public.seller_ratings WHERE id='cccc000a-0000-4000-8000-000000000002'$q$) = 0,
    'the SELECT side is what is holding here, not the delete policy');
  PERFORM pg_temp._assert('sr4b Pitt UNI-ADMIN deletes 0 CMU seller ratings',
    pg_temp._write_as('aaaa0002-0000-4000-8000-00000000aaa2',
      $q$DELETE FROM public.seller_ratings WHERE id='cccc000a-0000-4000-8000-000000000002'$q$) = 0,
    'masked, not denied: widen the SELECT side and this becomes 1');
  -- Until 20261005000000 this pinned "the delete policy carries no tenant predicate" so
  -- that sr4b stayed honest about being masked rather than denied. The admin branch is now
  -- is_superadmin(): a university_admin is denied by the policy itself, at any school.
  PERFORM pg_temp._assert('sr4c the delete policy self-denies a delegated admin (fixed 20261005000000)',
    (SELECT qual LIKE '%is_superadmin()%' AND qual NOT LIKE '%is_admin = true%'
       FROM pg_policies
      WHERE schemaname='public' AND tablename='seller_ratings' AND policyname='rls_seller_ratings_delete'),
    'the admin branch of rls_seller_ratings_delete is no longer is_superadmin()');
END $$;

-- ── §5 the prime suspect, cleared by measurement ────────────────────────────
-- checklist_share_links has the same parent-EXISTS tenant policy as
-- listing_verifications. It does NOT behave like LV-1, for two independent
-- reasons: all three of its permissive policies deny an outsider on their own
-- predicate, and its parent (ranking_collaborations) is scoped by university_id
-- with no widening. Pinned so that losing EITHER reason shows up here.
DO $$
BEGIN
  PERFORM pg_temp._assert('cs5a Pitt STUDENT reads 0 CMU share links',
    pg_temp._count_as('aaaa0001-0000-4000-8000-00000000aaa1',
      $q$SELECT 1 FROM public.checklist_share_links WHERE id='cccc0015-0000-4000-8000-000000000002'$q$) = 0, '');
  PERFORM pg_temp._assert('cs5b Pitt UNI-ADMIN reads 0 CMU share links',
    pg_temp._count_as('aaaa0002-0000-4000-8000-00000000aaa2',
      $q$SELECT 1 FROM public.checklist_share_links WHERE id='cccc0015-0000-4000-8000-000000000002'$q$) = 0,
    'the role that defeats listing_verifications does not defeat this one');
  PERFORM pg_temp._assert('cs5c Pitt UNI-ADMIN cannot UPDATE a CMU share link',
    pg_temp._write_as('aaaa0002-0000-4000-8000-00000000aaa2',
      $q$UPDATE public.checklist_share_links SET revoked=true
          WHERE id='cccc0015-0000-4000-8000-000000000002'$q$) = 0, '');
  PERFORM pg_temp._assert('cs5d its parent is scoped by university_id, not by a group',
    (SELECT qual LIKE '%university_id = current_university_id()%' AND qual NOT LIKE '%shares_%'
       FROM pg_policies
      WHERE schemaname='public' AND tablename='ranking_collaborations' AND policyname='tenant_isolation'),
    'widen this parent and cs5a-cs5c become the next LV-1');
END $$;

-- ── §6 structural pins: the shape, not the instance ─────────────────────────
-- Exact-set equality in BOTH directions, the same idiom the status/category
-- drift guards use. A new table joining either set is a new candidate that
-- nobody has classified, and it must not arrive silently.
DO $$
DECLARE
  parent_delegated text[];
  admin_shaped text[];
  wrong_role int;
BEGIN
  -- (a) tenant policies that are a bare parent-visibility test
  SELECT array_agg(tablename ORDER BY tablename) INTO parent_delegated
    FROM pg_policies
   WHERE schemaname='public' AND policyname IN ('tenant_isolation','tenant_confined')
     AND coalesce(qual,'')||coalesce(with_check,'') LIKE '%EXISTS%'
     AND coalesce(qual,'')||coalesce(with_check,'') NOT LIKE '%university_id%'
     AND coalesce(qual,'')||coalesce(with_check,'') NOT LIKE '%shares_%'
     AND coalesce(qual,'')||coalesce(with_check,'') NOT LIKE '%is_superadmin%';
  PERFORM pg_temp._assert('st6a 16 tables delegate their tenant test to a parent',
    parent_delegated = ARRAY[
      'building_chat_link_reports','checklist_share_links','dorm_answers','dorm_edits',
      'dorm_future_residents','dorm_question_upvotes','group_dorm_rankings','listing_verifications',
      'marketplace_listing_items','roommate_search_interests','setup_comment_likes','setup_comments',
      'setup_likes','setup_photos','setup_products','student_reviews'],
    'set drifted: ' || coalesce(array_to_string(parent_delegated, ','), 'NULL'));

  -- (b) permissive policies that test is_admin and carry no tenant predicate
  SELECT array_agg(tablename||'.'||policyname ORDER BY tablename, policyname) INTO admin_shaped
    FROM pg_policies p
   WHERE schemaname='public' AND permissive='PERMISSIVE'
     AND tablename IN (SELECT tablename FROM pg_policies
                        WHERE policyname IN ('tenant_isolation','tenant_confined'))
     AND coalesce(qual,'')||coalesce(with_check,'') LIKE '%is_admin%'
     AND coalesce(qual,'')||coalesce(with_check,'') NOT LIKE '%university%'
     AND coalesce(qual,'')||coalesce(with_check,'') NOT LIKE '%shares_%';
  -- 16 -> 14 with 20260926000000. lv_select_admin and lv_update_admin left this set by
  -- moving from is_admin to is_superadmin(); the LIKE '%is_admin%' filter above no longer
  -- matches them. The count is expected to keep falling as the class is paid down, and this
  -- list is the ledger of what is still owed — most immediately
  -- rls_marketplace_listings_delete and rls_seller_ratings_delete, which were decided
  -- not-intended on 2026-08-16 and deferred to their own lane.
  -- 16 -> 14 with 20260926000000 -> 0 with 20261005000000, which retired the derived column
  -- as a predicate everywhere: the 14 above became either is_superadmin() (other students'
  -- content, the report queue, global catalogs) or an explicit
  -- `current_app_role() = 'university_admin' AND <row's school = current_university_id()>`
  -- (master_housing, dorm_edits, the dorm-photos bucket). The ledger of what was owed is
  -- paid; this now pins that nothing re-joins the shape.
  PERFORM pg_temp._assert('st6b 0 admin-shaped policies rely entirely on the tenant policy (paid down by 20261005000000)',
    admin_shaped IS NULL,
    'a policy re-joined the is_admin shape: ' || coalesce(array_to_string(admin_shaped, ','), 'NULL'));

  -- (c) the intersection is the LV-1 shape: admin-shaped policy on a table whose tenant test
  -- is only parent visibility. SIX policies before 20260926000000, FOUR after — the
  -- listing_verifications pair was the only live member (only ITS parent had been widened)
  -- and it is now gated on is_superadmin(). The remaining four sit on tables whose parents
  -- are not shared today; they are the same shape waiting for the same widening, which is
  -- why the pin counts them rather than deleting them.
  PERFORM pg_temp._assert('st6c the LV-1 shape is empty after 20261005000000',
    (SELECT count(*) FROM unnest(coalesce(admin_shaped, ARRAY[]::text[])) a
      WHERE split_part(a, '.', 1) = ANY (parent_delegated)) = 0,
    'a policy on a parent-delegated table re-joined the is_admin shape without being classified');

  -- (d) every tenant policy is TO authenticated, so anon is not tenant-scoped at
  -- all. anon's denial rests entirely on grants and permissive policies — which
  -- is why master_housing (USING true, SELECT granted to anon) is world-readable
  -- across schools and nothing in the tenant model objects.
  SELECT count(*) INTO wrong_role FROM pg_policies
   WHERE schemaname='public' AND policyname IN ('tenant_isolation','tenant_confined')
     AND roles::text <> '{authenticated}';
  PERFORM pg_temp._assert('st6d every tenant policy is TO authenticated only',
    wrong_role = 0,
    'anon is outside the tenant model by construction; ' || wrong_role || ' policy/policies now say otherwise');
END $$;

-- ── verdict ─────────────────────────────────────────────────────────────────
DO $$
DECLARE failed int;
BEGIN
  SELECT count(*) INTO failed FROM test_results WHERE NOT pass;
  IF failed > 0 THEN
    RAISE EXCEPTION 'delegated_tenant_denial: % assertion(s) failed', failed;
  END IF;
END $$;

ROLLBACK;
