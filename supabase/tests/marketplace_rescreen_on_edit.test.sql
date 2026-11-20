-- Moderation on EDIT (20261011000000_marketplace_rescreen_on_edit).
-- covers: 20261011000000_marketplace_rescreen_on_edit.sql
--
-- The defect: an owner edits a NEW PHOTO onto an approved, live listing and it
-- stays available/approved, unscreened (verified on the local stack 2026-10-11).
-- This probe proves, through the real client identity (pg_temp._assume), that an
-- edited photo goes back to review, that moderate-listing can claim it again, that
-- non-screened edits and the service/admin paths are untouched, that lifecycle
-- states approve cannot restore are refused, and that re-approval does not
-- re-notify alert subscribers. Everything rolls back.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/marketplace_rescreen_on_edit.test.sql

BEGIN;

-- Harness role fidelity: see marketplace_insert_moderation_gate.test.sql and
-- supabase/tests/harness_role_fidelity.test.sql. Never set_config('role', …) alone.
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

INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active)
VALUES ('00000000-0000-4000-8000-000000000001', 'pitt', 'University of Pittsburgh', 'Pitt',
        ARRAY['pitt.edu'], true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('dddddddd-0000-4000-8000-0000000002a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('dddddddd-0000-4000-8000-0000000002a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('dddddddd-0000-4000-8000-0000000002a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)
ON CONFLICT (id) DO NOTHING;
-- The auth.users trigger pre-creates profiles, so seed columns go through DO UPDATE.
INSERT INTO public.profiles (id, full_name, university_id, role) VALUES
  ('dddddddd-0000-4000-8000-0000000002a1', 'Rescreen Seller', '00000000-0000-4000-8000-000000000001', 'user'),
  ('dddddddd-0000-4000-8000-0000000002a2', 'Rescreen Watcher', '00000000-0000-4000-8000-000000000001', 'user'),
  ('dddddddd-0000-4000-8000-0000000002a3', 'Rescreen Admin', '00000000-0000-4000-8000-000000000001', 'superadmin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, university_id = EXCLUDED.university_id, full_name = EXCLUDED.full_name;

CREATE TEMP TABLE test_results (name text, pass boolean, detail text);
CREATE OR REPLACE FUNCTION pg_temp._assert(label text, cond boolean, detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- coalesce: a NULL condition is a FAIL, never a silent PASS.
  INSERT INTO test_results VALUES (label, coalesce(cond, false), detail);
  IF NOT coalesce(cond, false) THEN RAISE NOTICE 'FAIL: % - %', label, detail;
  ELSE RAISE NOTICE 'PASS: %', label; END IF;
END;
$$;

-- Run p_sql as p_role ('authenticated' with p_uid as sub, or 'service_role');
-- returns NULL on success, the error text otherwise. Always returns to postgres.
CREATE OR REPLACE FUNCTION pg_temp._exec_as(p_role text, p_uid uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume(p_role);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_role = 'service_role' THEN json_build_object('role', 'service_role')::text
         ELSE json_build_object('sub', p_uid::text, 'role', p_role)::text END, true);
  EXECUTE p_sql;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM pg_temp._assume('postgres');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM pg_temp._assume('postgres');
  RETURN SQLERRM;
END;
$$;

-- Seed listings as postgres (auth.role() NULL → every guard exempt).
INSERT INTO public.marketplace_listings
  (id, user_id, title, description, price, category, university_id, status, moderation_decision, moderated_at, image_urls, payment_methods)
VALUES
  ('eeeeeeee-0000-4000-8000-0000000002b1', 'dddddddd-0000-4000-8000-0000000002a1', 'Clean desk lamp', NULL, 10, 'Electronics',
   '00000000-0000-4000-8000-000000000001', 'available', 'approved', now(), ARRAY['https://x.test/a.jpg'], ARRAY['cash']),
  ('eeeeeeee-0000-4000-8000-0000000002b2', 'dddddddd-0000-4000-8000-0000000002a1', 'Clean chair', 'fine', 15, 'Furniture',
   '00000000-0000-4000-8000-000000000001', 'available', 'approved', now(), ARRAY['https://x.test/b.jpg'], ARRAY['cash']),
  ('eeeeeeee-0000-4000-8000-0000000002b3', 'dddddddd-0000-4000-8000-0000000002a1', 'In-flight rug', NULL, 20, 'Decor',
   '00000000-0000-4000-8000-000000000001', 'pending_review', NULL, NULL, ARRAY['https://x.test/c.jpg'], ARRAY['cash']),
  ('eeeeeeee-0000-4000-8000-0000000002b4', 'dddddddd-0000-4000-8000-0000000002a1', 'Sold kettle', NULL, 8, 'Appliances',
   '00000000-0000-4000-8000-000000000001', 'sold', 'approved', now(), ARRAY['https://x.test/d.jpg'], ARRAY['cash']),
  ('eeeeeeee-0000-4000-8000-0000000002b5', 'dddddddd-0000-4000-8000-0000000002a1', 'Held poster', NULL, 5, 'Decor',
   '00000000-0000-4000-8000-000000000001', 'under_review', 'held', now(), ARRAY['https://x.test/e.jpg'], ARRAY['cash']),
  ('eeeeeeee-0000-4000-8000-0000000002b6', 'dddddddd-0000-4000-8000-0000000002a1', 'Service-edited mirror', NULL, 12, 'Decor',
   '00000000-0000-4000-8000-000000000001', 'available', 'approved', now(), ARRAY['https://x.test/f.jpg'], ARRAY['cash']),
  ('eeeeeeee-0000-4000-8000-0000000002b7', 'dddddddd-0000-4000-8000-0000000002a1', 'Admin-edited shelf', NULL, 14, 'Furniture',
   '00000000-0000-4000-8000-000000000001', 'available', 'approved', now(), ARRAY['https://x.test/g.jpg'], ARRAY['cash']);
UPDATE public.marketplace_listings SET moderation_started_at = now() - interval '5 seconds'
 WHERE id = 'eeeeeeee-0000-4000-8000-0000000002b3';
INSERT INTO public.marketplace_listings
  (id, user_id, title, price, category, university_id, status, moderation_decision,
   post_type, service_category, service_date, service_duration_minutes, service_location, service_notes)
VALUES
  ('eeeeeeee-0000-4000-8000-0000000002b8', 'dddddddd-0000-4000-8000-0000000002a1', 'Need help moving a desk', 0, 'Other',
   '00000000-0000-4000-8000-000000000001', 'open', 'approved',
   'request_help', 'move_help', current_date + 3, 60, 'Towers lobby', 'One desk.');
INSERT INTO public.marketplace_alerts (user_id, university_id, name, categories, keywords, enabled)
VALUES ('dddddddd-0000-4000-8000-0000000002a2', '00000000-0000-4000-8000-000000000001', 'lamps', '{}', 'lamp', true);

DO $$
DECLARE
  seller uuid := 'dddddddd-0000-4000-8000-0000000002a1';
  admin  uuid := 'dddddddd-0000-4000-8000-0000000002a3';
  watcher uuid := 'dddddddd-0000-4000-8000-0000000002a2';
  err text; st text; dec text; started timestamptz; urls text[]; n int;
  claimed_urls text[];
BEGIN
  -- 1. THE DEFECT: an owner adds a new photo to an approved, live listing.
  err := pg_temp._exec_as('authenticated', seller,
    'UPDATE public.marketplace_listings SET image_urls = image_urls || ARRAY[''https://x.test/UNSCREENED.jpg''] '
    || 'WHERE id = ''eeeeeeee-0000-4000-8000-0000000002b1''');
  PERFORM pg_temp._assert('rs1a owner photo edit is accepted', err IS NULL, coalesce(err, ''));
  SELECT status, moderation_decision, image_urls INTO st, dec, urls
    FROM public.marketplace_listings WHERE id = 'eeeeeeee-0000-4000-8000-0000000002b1';
  PERFORM pg_temp._assert('rs1b edited photo sends the listing back to pending_review', st = 'pending_review', coalesce(st, '<null>'));
  PERFORM pg_temp._assert('rs1c the old approved verdict is cleared', dec IS NULL, coalesce(dec, '<null>'));
  PERFORM pg_temp._assert('rs1d the new photo is what is now stored', 'https://x.test/UNSCREENED.jpg' = ANY (urls), array_to_string(urls, ','));
  -- moderate-listing can claim it again, and the claim carries the NEW photo.
  PERFORM pg_temp._assume('service_role');
  SELECT c.image_urls INTO claimed_urls FROM public.claim_marketplace_listing_moderation(
    'eeeeeeee-0000-4000-8000-0000000002b1', seller, now() - interval '5 minutes') c;
  PERFORM pg_temp._assume('postgres');
  PERFORM pg_temp._assert('rs1e moderate-listing claims the edited listing with the new photo',
    'https://x.test/UNSCREENED.jpg' = ANY (claimed_urls), coalesce(array_to_string(claimed_urls, ','), '<no claim>'));

  -- 2. Text edits are screened too.
  err := pg_temp._exec_as('authenticated', seller,
    'UPDATE public.marketplace_listings SET description = ''new words'' WHERE id = ''eeeeeeee-0000-4000-8000-0000000002b2''');
  SELECT status INTO st FROM public.marketplace_listings WHERE id = 'eeeeeeee-0000-4000-8000-0000000002b2';
  PERFORM pg_temp._assert('rs2 edited description goes back to pending_review', err IS NULL AND st = 'pending_review', coalesce(err, st));

  -- 3. Non-screened edits leave a live listing live (price, payment, and '' re-saved over NULL).
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.marketplace_listings SET status = 'available', moderation_decision = 'approved'
   WHERE id = 'eeeeeeee-0000-4000-8000-0000000002b2';
  err := pg_temp._exec_as('authenticated', seller,
    'UPDATE public.marketplace_listings SET price = 99, payment_methods = ARRAY[''venmo''], title = '' Clean chair '' '
    || 'WHERE id = ''eeeeeeee-0000-4000-8000-0000000002b2''');
  SELECT status, moderation_decision INTO st, dec FROM public.marketplace_listings WHERE id = 'eeeeeeee-0000-4000-8000-0000000002b2';
  PERFORM pg_temp._assert('rs3a price/payment edit (and whitespace-only title change) stays available+approved',
    err IS NULL AND st = 'available' AND dec = 'approved', coalesce(err, st || '/' || coalesce(dec, '<null>')));
  -- '' re-saved over NULL, on a fresh live row:
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.marketplace_listings SET status = 'available', moderation_decision = 'approved', description = NULL
   WHERE id = 'eeeeeeee-0000-4000-8000-0000000002b6';
  err := pg_temp._exec_as('authenticated', seller,
    'UPDATE public.marketplace_listings SET description = '''' WHERE id = ''eeeeeeee-0000-4000-8000-0000000002b6''');
  SELECT status INTO st FROM public.marketplace_listings WHERE id = 'eeeeeeee-0000-4000-8000-0000000002b6';
  PERFORM pg_temp._assert('rs3b re-saving an empty description over NULL is not a screened change', err IS NULL AND st = 'available', coalesce(err, st));

  -- 4. Editing while a worker holds a claim invalidates that claim.
  err := pg_temp._exec_as('authenticated', seller,
    'UPDATE public.marketplace_listings SET title = ''Rug, actually'' WHERE id = ''eeeeeeee-0000-4000-8000-0000000002b3''');
  SELECT status, moderation_started_at INTO st, started FROM public.marketplace_listings WHERE id = 'eeeeeeee-0000-4000-8000-0000000002b3';
  PERFORM pg_temp._assert('rs4 edit during review clears the in-flight claim (stays pending_review)',
    err IS NULL AND st = 'pending_review' AND started IS NULL, coalesce(err, st || '/' || coalesce(started::text, 'null')));

  -- 5. Lifecycle states approve cannot restore: refused; relist (status only) still works.
  err := pg_temp._exec_as('authenticated', seller,
    'UPDATE public.marketplace_listings SET image_urls = ARRAY[''https://x.test/swap.jpg''] WHERE id = ''eeeeeeee-0000-4000-8000-0000000002b4''');
  PERFORM pg_temp._assert('rs5a photo edit on a sold listing is refused', err IS NOT NULL, coalesce(err, 'ALLOWED'));
  err := pg_temp._exec_as('authenticated', seller,
    'UPDATE public.marketplace_listings SET status = ''available'' WHERE id = ''eeeeeeee-0000-4000-8000-0000000002b4''');
  SELECT status INTO st FROM public.marketplace_listings WHERE id = 'eeeeeeee-0000-4000-8000-0000000002b4';
  PERFORM pg_temp._assert('rs5b status-only relist is unaffected', err IS NULL AND st = 'available', coalesce(err, st));

  -- 6. Held listing: stays in the human queue with its verdict.
  err := pg_temp._exec_as('authenticated', seller,
    'UPDATE public.marketplace_listings SET title = ''Poster v2'' WHERE id = ''eeeeeeee-0000-4000-8000-0000000002b5''');
  SELECT status, moderation_decision INTO st, dec FROM public.marketplace_listings WHERE id = 'eeeeeeee-0000-4000-8000-0000000002b5';
  PERFORM pg_temp._assert('rs6 held listing edit stays under_review/held',
    err IS NULL AND st = 'under_review' AND dec = 'held', coalesce(err, st || '/' || coalesce(dec, '<null>')));

  -- 7. Service posts go back to review the same way ('open' -> pending_review).
  err := pg_temp._exec_as('authenticated', seller,
    'UPDATE public.marketplace_listings SET title = ''Need help moving TWO desks'' WHERE id = ''eeeeeeee-0000-4000-8000-0000000002b8''');
  SELECT status INTO st FROM public.marketplace_listings WHERE id = 'eeeeeeee-0000-4000-8000-0000000002b8';
  PERFORM pg_temp._assert('rs7 edited open service post goes back to pending_review', err IS NULL AND st = 'pending_review', coalesce(err, st));

  -- 8. service_role and admins are exempt.
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.marketplace_listings SET status = 'available', moderation_decision = 'approved'
   WHERE id = 'eeeeeeee-0000-4000-8000-0000000002b6';
  err := pg_temp._exec_as('service_role', NULL,
    'UPDATE public.marketplace_listings SET image_urls = ARRAY[''https://x.test/svc.jpg''] WHERE id = ''eeeeeeee-0000-4000-8000-0000000002b6''');
  SELECT status, moderation_decision INTO st, dec FROM public.marketplace_listings WHERE id = 'eeeeeeee-0000-4000-8000-0000000002b6';
  PERFORM pg_temp._assert('rs8a service_role edit keeps available+approved', err IS NULL AND st = 'available' AND dec = 'approved', coalesce(err, st));
  err := pg_temp._exec_as('authenticated', admin,
    'UPDATE public.marketplace_listings SET image_urls = ARRAY[''https://x.test/adm.jpg''] WHERE id = ''eeeeeeee-0000-4000-8000-0000000002b7''');
  SELECT status, moderation_decision INTO st, dec FROM public.marketplace_listings WHERE id = 'eeeeeeee-0000-4000-8000-0000000002b7';
  PERFORM pg_temp._assert('rs8b admin edit keeps available+approved', err IS NULL AND st = 'available' AND dec = 'approved', coalesce(err, st));

  -- 9. The owner still cannot self-approve the re-screen.
  err := pg_temp._exec_as('authenticated', seller,
    'UPDATE public.marketplace_listings SET status = ''available'' WHERE id = ''eeeeeeee-0000-4000-8000-0000000002b1''');
  SELECT status INTO st FROM public.marketplace_listings WHERE id = 'eeeeeeee-0000-4000-8000-0000000002b1';
  PERFORM pg_temp._assert('rs9 owner cannot flip the re-screened listing back to available', st = 'pending_review', coalesce(err, st));

  -- 10. Alert fan-out: one notification per recipient per listing, across re-approval.
  DELETE FROM public.notifications WHERE recipient_id = watcher;
  err := pg_temp._exec_as('service_role', NULL,
    'UPDATE public.marketplace_listings SET status = ''available'', moderation_decision = ''approved'' WHERE id = ''eeeeeeee-0000-4000-8000-0000000002b1''');
  SELECT count(*) INTO n FROM public.notifications
   WHERE recipient_id = watcher AND type = 'marketplace_alert' AND payload->>'listing_id' = 'eeeeeeee-0000-4000-8000-0000000002b1';
  PERFORM pg_temp._assert('rs10a first approval notifies the alert subscriber once', err IS NULL AND n = 1, coalesce(err, n::text));
  err := pg_temp._exec_as('authenticated', seller,
    'UPDATE public.marketplace_listings SET title = ''Clean desk lamp (LED)'' WHERE id = ''eeeeeeee-0000-4000-8000-0000000002b1''');
  err := coalesce(err, pg_temp._exec_as('service_role', NULL,
    'UPDATE public.marketplace_listings SET status = ''available'', moderation_decision = ''approved'' WHERE id = ''eeeeeeee-0000-4000-8000-0000000002b1'''));
  SELECT count(*) INTO n FROM public.notifications
   WHERE recipient_id = watcher AND type = 'marketplace_alert' AND payload->>'listing_id' = 'eeeeeeee-0000-4000-8000-0000000002b1';
  PERFORM pg_temp._assert('rs10b re-approval after an edit does not notify again', err IS NULL AND n = 1, coalesce(err, n::text));
END $$;

DO $$
DECLARE fails int;
BEGIN
  SELECT count(*) INTO fails FROM test_results WHERE NOT pass;
  IF fails > 0 THEN
    RAISE EXCEPTION '% assertion(s) FAILED in marketplace_rescreen_on_edit', fails;
  END IF;
  RAISE NOTICE 'ALL % assertions passed', (SELECT count(*) FROM test_results);
END $$;

ROLLBACK;
