-- covers: 20260712220332_listing_verifications.sql
-- covers: 20260926000000_listing_verifications_superadmin_only.sql
--
-- Grandfathered debt paid (2026-08-16 audit, docs/security/rls-grandfathered-audit.md).
-- 20260712220332 shipped the verified-listings flow with NO probe at all: five policies on
-- public.listing_verifications and two on storage.objects, holding the most sensitive rows
-- the marketplace produces — a student's lease or utility document, or the address they
-- attest to. The mutation matrix in that audit found no wired probe touching the table, so
-- every one of those policies could be loosened to `USING (true)` with the whole suite green.
--
-- WHY BOTH DIRECTIONS, on every assertion here. "The owner can read their own verification"
-- passes unchanged against `USING (true)` — i.e. against a policy that shows every Pitt
-- student every other Pitt student's lease document. The negative is the assertion that can
-- actually go red, and the bucket-wide / table-wide scans are what make it load-bearing: a
-- per-row lookup returning 0 can also mean "the seed drifted", whereas "you see exactly one
-- row and it is yours" cannot pass while the predicate is loosened.
--
-- The five policies and what pins each:
--   lv_select_own              §1 owner reads own, classmate reads zero, table-wide scan
--   lv_insert_own              §2 owner may submit for their OWN listing; classmate refused
--   lv_update_admin            §3 admin reviews; the owner cannot approve their own request
--   lv_select_admin            §3 admin reads the classmate's row (the legitimate path)
--   lv_delete_own_rejected     §4 owner deletes a rejected row, never a pending one
--   tenant_isolation (RESTRICTIVE)  §5 CMU sees none of Pitt's, and Pitt's admin none of CMU's
-- plus the private evidence bucket:
--   lv_storage_select_own_or_admin  §6 owner + admin read; classmate and anon read zero
--   lv_storage_insert_own           §6 upload under someone else's uid prefix is refused
--
-- `anon` is asserted at the GRANT layer (§7), not the policy layer, because the migration
-- REVOKEs ALL from anon — the statement fails before RLS is consulted, so a row-count claim
-- there would be a green assertion that cannot go red.
--
-- Rolled back at the end.
-- Run: bash scripts/test-db.sh   (or psql … -f supabase/tests/listing_verifications_owner_scope.test.sql)

BEGIN;

-- ── harness role fidelity (docs/security/reaudit-2026-08-06.md H1) ──────────────────────────
-- PostgREST connects as session_user='authenticator' and SET ROLEs to authenticated/anon.
-- `set_config('role', …)` changes current_user but NOT session_user, so guards keyed on
-- session_user would be silently exempt here and a probe asserting one would go green for the
-- wrong reason. pg_temp._assume() reproduces the real client identity.
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

-- ── fixtures ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active) VALUES
  ('00000000-0000-4000-8000-000000000001', 'pitt', 'University of Pittsburgh', 'Pitt', ARRAY['pitt.edu'], true),
  ('00000000-0000-4000-8000-000000000002', 'cmu',  'Carnegie Mellon University', 'CMU', ARRAY['cmu.edu'], true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('1f000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL), -- Pitt owner
  ('1f000000-0000-4000-8000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL), -- Pitt classmate
  ('1f000000-0000-4000-8000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL), -- Pitt admin
  ('1f000000-0000-4000-8000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL), -- CMU student
  ('1f000000-0000-4000-8000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)  -- superadmin (added 20260926000000)
ON CONFLICT (id) DO NOTHING;

-- The auth.users trigger creates the profiles row first, so seed columns must land in the
-- ON CONFLICT branch (reference-db-probe-profiles-precreated). `role` must land so is_admin
-- derives through sync_is_admin_from_role — writing profiles.is_admin directly is overwritten.
INSERT INTO public.profiles (id, full_name, university_id, role) VALUES
  ('1f000000-0000-4000-8000-0000000000a1', 'LV Owner',     '00000000-0000-4000-8000-000000000001', 'user'),
  ('1f000000-0000-4000-8000-0000000000a2', 'LV Classmate', '00000000-0000-4000-8000-000000000001', 'user'),
  ('1f000000-0000-4000-8000-0000000000a3', 'LV Admin',     '00000000-0000-4000-8000-000000000001', 'university_admin'),
  ('1f000000-0000-4000-8000-0000000000a4', 'LV CMU',       '00000000-0000-4000-8000-000000000002', 'user'),
  -- The review tier that survives 20260926000000. Deliberately Pitt-homed, so the
  -- superadmin assertions below cannot pass by sharing a university with the row.
  ('1f000000-0000-4000-8000-0000000000a5', 'LV Superadmin','00000000-0000-4000-8000-000000000001', 'superadmin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, university_id = EXCLUDED.university_id;

INSERT INTO public.marketplace_listings (id, user_id, title, price, category, university_id) VALUES
  ('1f000000-0000-4000-8000-00000000b001', '1f000000-0000-4000-8000-0000000000a1', 'LV owner desk',     10, 'furniture', '00000000-0000-4000-8000-000000000001'),
  ('1f000000-0000-4000-8000-00000000b002', '1f000000-0000-4000-8000-0000000000a2', 'LV classmate lamp', 10, 'furniture', '00000000-0000-4000-8000-000000000001'),
  ('1f000000-0000-4000-8000-00000000b003', '1f000000-0000-4000-8000-0000000000a4', 'LV cmu chair',      10, 'furniture', '00000000-0000-4000-8000-000000000002'),
  -- Deliberately left WITHOUT a verification row. §2's negative must be refused by
  -- lv_insert_own, not by UNIQUE (listing_id): the first draft of this probe aimed the
  -- forged INSERT at a listing that already had one, so it "passed" against a policy
  -- loosened to WITH CHECK (true) — a green assertion that could not go red.
  ('1f000000-0000-4000-8000-00000000b004', '1f000000-0000-4000-8000-0000000000a1', 'LV owner shelf',    10, 'furniture', '00000000-0000-4000-8000-000000000001');

-- One verification per student. The classmate's row is not decoration: it is what lets the
-- table-wide scan tell "confined to my own rows" apart from "the seed produced nothing".
INSERT INTO public.listing_verifications (id, listing_id, user_id, method, evidence_path, status) VALUES
  ('1f000000-0000-4000-8000-00000000c001', '1f000000-0000-4000-8000-00000000b001',
   '1f000000-0000-4000-8000-0000000000a1', 'document', '1f000000-0000-4000-8000-0000000000a1/lease.pdf', 'pending'),
  ('1f000000-0000-4000-8000-00000000c002', '1f000000-0000-4000-8000-00000000b002',
   '1f000000-0000-4000-8000-0000000000a2', 'document', '1f000000-0000-4000-8000-0000000000a2/utility.pdf', 'pending'),
  ('1f000000-0000-4000-8000-00000000c003', '1f000000-0000-4000-8000-00000000b003',
   '1f000000-0000-4000-8000-0000000000a4', 'document', '1f000000-0000-4000-8000-0000000000a4/cmu-lease.pdf', 'pending');

-- Evidence documents in the PRIVATE bucket, each under its owner's uid prefix — the shape
-- src/ writes.
INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES
  ('listing-verifications', '1f000000-0000-4000-8000-0000000000a1/lease.pdf',
   '1f000000-0000-4000-8000-0000000000a1', '1f000000-0000-4000-8000-0000000000a1'),
  ('listing-verifications', '1f000000-0000-4000-8000-0000000000a2/utility.pdf',
   '1f000000-0000-4000-8000-0000000000a2', '1f000000-0000-4000-8000-0000000000a2');

CREATE TEMP TABLE test_results (name text, pass boolean, detail text);
CREATE OR REPLACE FUNCTION pg_temp._assert(label text, cond boolean, detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('postgres');
  INSERT INTO test_results VALUES (label, cond, detail);
  IF NOT cond THEN RAISE NOTICE 'FAIL: % - %', label, detail;
  ELSE RAISE NOTICE 'PASS: %', label; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp._as_user(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
END $$;

-- Runs a statement as `uid` and returns the SQLSTATE-bearing error text, or NULL if it
-- succeeded. RLS refusals surface as 42501 on write; a WITH CHECK violation raises too.
CREATE OR REPLACE FUNCTION pg_temp._exec_as(uid uuid, stmt text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._as_user(uid);
  EXECUTE stmt;
  PERFORM pg_temp._assume('postgres');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RETURN SQLERRM;
END $$;

DO $$
DECLARE
  owner_u     uuid := '1f000000-0000-4000-8000-0000000000a1';
  classmate_u uuid := '1f000000-0000-4000-8000-0000000000a2';
  admin_u     uuid := '1f000000-0000-4000-8000-0000000000a3';
  cmu_u       uuid := '1f000000-0000-4000-8000-0000000000a4';
  super_u     uuid := '1f000000-0000-4000-8000-0000000000a5';
  owner_row   uuid := '1f000000-0000-4000-8000-00000000c001';
  n int;
  visible text;
  err text;
BEGIN
  -- ═══ §1 lv_select_own: a verification row is readable by its submitter and nobody else ═══
  PERFORM pg_temp._as_user(owner_u);
  SELECT count(*) INTO n FROM public.listing_verifications WHERE id = owner_row;
  PERFORM pg_temp._assert('lv: owner reads their own verification request', n = 1, n::text);

  -- The assertion that goes red against USING (true): same school, someone else's lease.
  PERFORM pg_temp._as_user(classmate_u);
  SELECT count(*) INTO n FROM public.listing_verifications WHERE id = owner_row;
  PERFORM pg_temp._assert('lv: a classmate cannot read the owner''s verification', n = 0, n::text);

  -- …and the confinement holds with no id predicate at all. A loosened policy shows 2+ here
  -- even if the lookup above were satisfied by a drifted seed.
  PERFORM pg_temp._as_user(classmate_u);
  SELECT count(*), max(id::text) INTO n, visible FROM public.listing_verifications;
  PERFORM pg_temp._assert('lv: classmate scanning the table sees exactly one row', n = 1, n::text);
  PERFORM pg_temp._assert('lv: …and that one row is their own',
    visible = '1f000000-0000-4000-8000-00000000c002', coalesce(visible, '<null>'));

  PERFORM pg_temp._as_user(owner_u);
  SELECT count(*), max(id::text) INTO n, visible FROM public.listing_verifications;
  PERFORM pg_temp._assert('lv: owner scanning the table sees exactly one row', n = 1, n::text);
  PERFORM pg_temp._assert('lv: …and that one row is their own', visible = owner_row::text,
    coalesce(visible, '<null>'));

  -- ═══ §2 lv_insert_own: you may vouch for YOUR listing, not for someone else's ═══════════
  err := pg_temp._exec_as(classmate_u,
    'INSERT INTO public.listing_verifications (listing_id, user_id, method, address_confirmation) '
    || 'VALUES (''1f000000-0000-4000-8000-00000000b004'', ''1f000000-0000-4000-8000-0000000000a2'', '
    || '''address'', ''123 Forbes Ave'')');
  PERFORM pg_temp._assert('lv: classmate cannot submit a verification against the owner''s listing',
    err IS NOT NULL, coalesce(err, 'INSERT SUCCEEDED'));

  -- Positive control for the same policy: the legitimate path still works. Without this the
  -- assertion above passes just as happily against a policy that refuses everyone.
  PERFORM pg_temp._assume('postgres');
  DELETE FROM public.listing_verifications WHERE listing_id = '1f000000-0000-4000-8000-00000000b002';
  err := pg_temp._exec_as(classmate_u,
    'INSERT INTO public.listing_verifications (listing_id, user_id, method, address_confirmation) '
    || 'VALUES (''1f000000-0000-4000-8000-00000000b002'', ''1f000000-0000-4000-8000-0000000000a2'', '
    || '''address'', ''123 Forbes Ave'')');
  PERFORM pg_temp._assert('lv: …but may submit one for their own listing', err IS NULL,
    coalesce(err, 'ok'));

  -- ═══ §3 lv_update_admin / lv_select_admin: review is an admin action ════════════════════
  err := pg_temp._exec_as(owner_u,
    'UPDATE public.listing_verifications SET status = ''approved'' WHERE id = '''
    || owner_row || '''');
  PERFORM pg_temp._assume('postgres');
  SELECT count(*) INTO n FROM public.listing_verifications
   WHERE id = owner_row AND status = 'approved';
  PERFORM pg_temp._assert('lv: the owner cannot approve their own verification', n = 0,
    'rows now approved: ' || n::text);

  -- REWRITTEN for 20260926000000. These two used to assert that a university_admin reads
  -- and approves a verification from their OWN school. That capability is gone, and its
  -- removal is the decision, not a side effect: e80b03f4 retired the Verifications UI for
  -- everyone in 2026-07, so the tier was holding read+approve on lease documents for a
  -- product surface that does not exist. Both directions are asserted — the tier that lost
  -- it and the tier that kept it — because "superadmin can" alone would still pass against
  -- a policy that let everyone through.
  PERFORM pg_temp._as_user(admin_u);
  SELECT count(*) INTO n FROM public.listing_verifications WHERE id = owner_row;
  PERFORM pg_temp._assert('lv: a Pitt university_admin reads 0 of their OWN school''s verifications', n = 0, n::text);

  PERFORM pg_temp._as_user(super_u);
  SELECT count(*) INTO n FROM public.listing_verifications WHERE id = owner_row;
  PERFORM pg_temp._assert('lv: …but a superadmin still reads it (the review path survives)', n = 1, n::text);

  err := pg_temp._exec_as(admin_u,
    'UPDATE public.listing_verifications SET status = ''approved'' WHERE id = '''
    || owner_row || '''');
  PERFORM pg_temp._assume('postgres');
  SELECT count(*) INTO n FROM public.listing_verifications
   WHERE id = owner_row AND status = 'approved';
  PERFORM pg_temp._assert('lv: a university_admin review does NOT land', n = 0,
    coalesce(err, 'rows approved: ' || n::text));

  -- The trigger check. trg_sync_listing_verified_flag is AFTER UPDATE OF status, so it can
  -- only fire behind an UPDATE that already passed lv_update_admin — scoping the policy
  -- scopes the SECURITY DEFINER trigger with it. If the flag moved for the university_admin
  -- above, the row would be approved here and this pair would disagree.
  err := pg_temp._exec_as(super_u,
    'UPDATE public.listing_verifications SET status = ''approved'' WHERE id = '''
    || owner_row || '''');
  PERFORM pg_temp._assume('postgres');
  SELECT count(*) INTO n FROM public.listing_verifications
   WHERE id = owner_row AND status = 'approved';
  PERFORM pg_temp._assert('lv: …and a superadmin review DOES land', n = 1,
    coalesce(err, 'rows approved: ' || n::text));

  -- ═══ §4 lv_delete_own_rejected: resubmission path, and only after a rejection ═══════════
  PERFORM pg_temp._assume('postgres');
  UPDATE public.listing_verifications SET status = 'pending' WHERE id = owner_row;
  err := pg_temp._exec_as(owner_u,
    'DELETE FROM public.listing_verifications WHERE id = ''' || owner_row || '''');
  PERFORM pg_temp._assume('postgres');
  SELECT count(*) INTO n FROM public.listing_verifications WHERE id = owner_row;
  PERFORM pg_temp._assert('lv: owner cannot delete a PENDING verification', n = 1, n::text);

  PERFORM pg_temp._assume('postgres');
  UPDATE public.listing_verifications SET status = 'rejected' WHERE id = owner_row;
  err := pg_temp._exec_as(owner_u,
    'DELETE FROM public.listing_verifications WHERE id = ''' || owner_row || '''');
  PERFORM pg_temp._assume('postgres');
  SELECT count(*) INTO n FROM public.listing_verifications WHERE id = owner_row;
  PERFORM pg_temp._assert('lv: …but may delete a REJECTED one to resubmit', n = 0,
    coalesce(err, n::text));

  -- ═══ §5 tenant_isolation (RESTRICTIVE): the cross-school direction ══════════════════════
  PERFORM pg_temp._as_user(cmu_u);
  SELECT count(*) INTO n FROM public.listing_verifications
   WHERE id = '1f000000-0000-4000-8000-00000000c002';
  PERFORM pg_temp._assert('lv: a CMU student cannot read a Pitt verification', n = 0, n::text);

  -- A Pitt STUDENT can see the CMU listing itself (Pitt and CMU share a marketplace —
  -- shares_marketplace() is true, 20260918000000) and still cannot see its verification.
  -- That is ownership doing the work, and it is the assertion that proves §1 is not an
  -- artefact of tenant confinement.
  PERFORM pg_temp._as_user(classmate_u);
  SELECT count(*) INTO n FROM public.marketplace_listings
   WHERE id = '1f000000-0000-4000-8000-00000000b003';
  PERFORM pg_temp._assert('lv: a Pitt student CAN see the CMU listing (shared marketplace)',
    n = 1, n::text);
  -- _assert() returns to `postgres` (BYPASSRLS), so every read must re-assume its caller.
  -- Forgetting this is how a probe silently asserts what the superuser sees.
  PERFORM pg_temp._as_user(classmate_u);
  SELECT count(*) INTO n FROM public.listing_verifications
   WHERE id = '1f000000-0000-4000-8000-00000000c003';
  PERFORM pg_temp._assert('lv: …but not its verification row', n = 0, n::text);

  -- ── THE PINNED HAZARD, NOW FIXED ────────────────────────────────────────────────────
  -- This asserted the CURRENT behaviour on purpose and said so: "when it IS scoped, this
  -- assertion goes red, which is the point: the fix cannot land silently." It went red
  -- against 20260926000000 exactly as written, and this is the rewrite.
  --
  -- The hazard was delegation, not a missing predicate: lv_select_admin tested is_admin and
  -- nothing else, and the RESTRICTIVE tenant_isolation policy only asks whether the PARENT
  -- LISTING is visible — which, under the shared Pitt/CMU marketplace group, it is. So a
  -- decision about listings (20260918000000) silently became a decision about lease
  -- documents. Recorded as LV-1 in docs/security/rls-grandfathered-audit.md.
  PERFORM pg_temp._as_user(admin_u);
  SELECT count(*) INTO n FROM public.listing_verifications
   WHERE id = '1f000000-0000-4000-8000-00000000c003';
  PERFORM pg_temp._assert(
    'lv LV-1 FIXED: a Pitt university_admin reads 0 CMU verifications',
    n = 0, n::text);

  -- And the parent listing is STILL visible to that same admin. Without this the assertion
  -- above could pass for the wrong reason — a broken fixture or a listing that stopped being
  -- shared would also produce 0, and the delegation would look fixed while being merely
  -- unreachable.
  SELECT count(*) INTO n FROM public.marketplace_listings
   WHERE id = '1f000000-0000-4000-8000-00000000b003';
  PERFORM pg_temp._assert(
    'lv LV-1 FIXED: …while the parent CMU listing is still visible to them (the delegation is bypassed, not broken)',
    n = 1, n::text);

  -- ═══ §6 the private evidence bucket ═════════════════════════════════════════════════════
  PERFORM pg_temp._as_user(owner_u);
  SELECT count(*) INTO n FROM storage.objects
   WHERE bucket_id = 'listing-verifications'
     AND name = '1f000000-0000-4000-8000-0000000000a1/lease.pdf';
  PERFORM pg_temp._assert('lv-storage: owner resolves their own evidence document', n = 1, n::text);

  PERFORM pg_temp._as_user(classmate_u);
  SELECT count(*) INTO n FROM storage.objects
   WHERE bucket_id = 'listing-verifications'
     AND name = '1f000000-0000-4000-8000-0000000000a1/lease.pdf';
  PERFORM pg_temp._assert('lv-storage: a classmate cannot read the owner''s lease document',
    n = 0, n::text);

  PERFORM pg_temp._as_user(classmate_u);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'listing-verifications';
  PERFORM pg_temp._assert('lv-storage: classmate scanning the bucket sees exactly their own object',
    n = 1, n::text);

  -- The lease PDFs themselves. This gated on bare is_admin with NO tenant predicate at all
  -- and was the ONLY SELECT policy on the bucket, so it was the widest of the three — and
  -- the obscurity protecting it was thin, since (storage.foldername(name))[1] IS the
  -- student's UUID. Fixing the two table policies without this one would have left the
  -- documents readable to anyone holding a user id and a filename.
  PERFORM pg_temp._as_user(admin_u);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'listing-verifications';
  PERFORM pg_temp._assert('lv-storage: a university_admin resolves 0 evidence documents',
    n = 0, n::text);

  PERFORM pg_temp._as_user(super_u);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'listing-verifications';
  PERFORM pg_temp._assert('lv-storage: …while a superadmin still resolves both (the review path works)',
    n = 2, n::text);

  err := pg_temp._exec_as(classmate_u,
    'INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES '
    || '(''listing-verifications'', ''1f000000-0000-4000-8000-0000000000a1/forged.pdf'', '
    || '''1f000000-0000-4000-8000-0000000000a2'', ''1f000000-0000-4000-8000-0000000000a2'')');
  PERFORM pg_temp._assert('lv-storage: upload under another student''s uid prefix is refused',
    err IS NOT NULL, coalesce(err, 'INSERT SUCCEEDED'));

  err := pg_temp._exec_as(classmate_u,
    'INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES '
    || '(''listing-verifications'', ''1f000000-0000-4000-8000-0000000000a2/second.pdf'', '
    || '''1f000000-0000-4000-8000-0000000000a2'', ''1f000000-0000-4000-8000-0000000000a2'')');
  PERFORM pg_temp._assert('lv-storage: …while an upload under their own prefix succeeds',
    err IS NULL, coalesce(err, 'ok'));

  PERFORM pg_temp._assume('anon');
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'listing-verifications';
  PERFORM pg_temp._assert('lv-storage: a signed-out visitor reads zero evidence objects', n = 0, n::text);

  -- ═══ §7 anon is stopped at the GRANT, before RLS ════════════════════════════════════════
  -- REVOKE ALL … FROM anon means the statement never reaches a policy. Asserted as an error,
  -- not a row count, because a row-count claim here could never go red.
  PERFORM pg_temp._assume('postgres');
  BEGIN
    PERFORM pg_temp._assume('anon');
    PERFORM count(*) FROM public.listing_verifications;
    PERFORM pg_temp._assume('postgres');
    PERFORM pg_temp._assert('lv: anon SELECT on the table is refused at the grant layer',
      false, 'SELECT SUCCEEDED');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp._assume('postgres');
    PERFORM pg_temp._assert('lv: anon SELECT on the table is refused at the grant layer',
      true, 'permission denied');
  END;

  -- ═══ §8 the bucket is private, which is what makes §6 the only read path ════════════════
  PERFORM pg_temp._assume('postgres');
  SELECT count(*) INTO n FROM storage.buckets WHERE id = 'listing-verifications' AND public IS false;
  PERFORM pg_temp._assert('lv-storage: the evidence bucket is still private (no public URL path)',
    n = 1, n::text);

  PERFORM pg_temp._assume('postgres');
END $$;

DO $$
DECLARE fails int;
BEGIN
  SELECT count(*) INTO fails FROM test_results WHERE NOT pass;
  IF fails > 0 THEN
    RAISE EXCEPTION '% assertion(s) failed in listing_verifications_owner_scope', fails;
  END IF;
  RAISE NOTICE 'ALL % assertions passed', (SELECT count(*) FROM test_results);
END $$;

ROLLBACK;
