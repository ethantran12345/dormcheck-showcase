-- Item names are screened content (20261012000000_listing_item_rescreen).
-- covers: 20261012000000_listing_item_rescreen.sql
--
-- The defect: marketplace_listing_items.name is rendered on every surface that
-- shows a listing (feed, detail, guest view, photo tags) but was never sent to
-- moderate-listing, and an owner could add or rename an item on an approved,
-- live listing without it leaving the feed. 20261011000000 closed that hole for
-- the parent row's own fields only. This probe proves, through the real client
-- identity (pg_temp._assume), that an added or renamed item sends a live listing
-- back to review exactly as a parent edit does, that the create flow is
-- untouched, that status-only item writes (sold toggles) are not screened
-- changes, that the parent-side marker cannot be forged by a direct listing
-- write, and that the service/admin paths are exempt. Everything rolls back.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/listing_item_rescreen.test.sql

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
  ('dddddddd-0000-4000-8000-0000000003a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('dddddddd-0000-4000-8000-0000000003a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)
ON CONFLICT (id) DO NOTHING;
-- The auth.users trigger pre-creates profiles, so seed columns go through DO UPDATE.
INSERT INTO public.profiles (id, full_name, university_id, role) VALUES
  ('dddddddd-0000-4000-8000-0000000003a1', 'Item Seller', '00000000-0000-4000-8000-000000000001', 'user'),
  ('dddddddd-0000-4000-8000-0000000003a3', 'Item Admin', '00000000-0000-4000-8000-000000000001', 'superadmin')
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

-- Seed as postgres (auth.role() NULL → every guard exempt). One listing per case
-- so no case depends on another's leftovers (order independence, test-db.sh).
--   c1 rename on live   c2 add on live   c3 sold toggle   c4 same-name re-save
--   c5 in-flight claim  c6 held          c7 sold listing  c8 delete on live
--   c9 service_role     c10 admin        c11 forged marker   c12 create flow
--   c13 open service post
INSERT INTO public.marketplace_listings
  (id, user_id, title, price, category, university_id, status, moderation_decision, moderated_at, image_urls, payment_methods)
SELECT ('eeeeeeee-0000-4000-8000-0000000003' || lpad(n::text, 2, '0'))::uuid,
       'dddddddd-0000-4000-8000-0000000003a1', 'Item case ' || n, 10, 'Furniture',
       '00000000-0000-4000-8000-000000000001',
       CASE n WHEN 5 THEN 'pending_review' WHEN 6 THEN 'under_review' WHEN 7 THEN 'sold' WHEN 12 THEN 'pending_review' ELSE 'available' END,
       CASE n WHEN 5 THEN NULL WHEN 6 THEN 'held' WHEN 12 THEN NULL ELSE 'approved' END,
       CASE WHEN n IN (5, 12) THEN NULL ELSE now() END,
       ARRAY['https://x.test/item-' || n || '.jpg'], ARRAY['cash']
  FROM generate_series(1, 12) n;
INSERT INTO public.marketplace_listings
  (id, user_id, title, price, category, university_id, status, moderation_decision,
   post_type, service_category, service_date, service_duration_minutes, service_location, service_notes)
VALUES
  ('eeeeeeee-0000-4000-8000-000000000313', 'dddddddd-0000-4000-8000-0000000003a1', 'Need help moving', 0, 'Other',
   '00000000-0000-4000-8000-000000000001', 'open', 'approved',
   'request_help', 'move_help', current_date + 3, 60, 'Towers lobby', 'One desk.');
UPDATE public.marketplace_listings SET moderation_started_at = now() - interval '5 seconds'
 WHERE id = 'eeeeeeee-0000-4000-8000-000000000305';
-- One existing item on every listing except the create-flow case (12).
INSERT INTO public.marketplace_listing_items (id, listing_id, name, price, status)
SELECT ('ffffffff-0000-4000-8000-0000000003' || lpad(n::text, 2, '0'))::uuid,
       ('eeeeeeee-0000-4000-8000-0000000003' || lpad(n::text, 2, '0'))::uuid,
       'Plain chair', 10, CASE n WHEN 7 THEN 'sold' ELSE 'available' END
  FROM generate_series(1, 13) n WHERE n <> 12;

CREATE OR REPLACE FUNCTION pg_temp._row(p_n int)
RETURNS TABLE (st text, verdict text, started timestamptz) LANGUAGE sql AS $$
  SELECT status, moderation_decision, moderation_started_at FROM public.marketplace_listings
   WHERE id = ('eeeeeeee-0000-4000-8000-0000000003' || lpad(p_n::text, 2, '0'))::uuid;
$$;

DO $$
DECLARE
  seller uuid := 'dddddddd-0000-4000-8000-0000000003a1';
  admin  uuid := 'dddddddd-0000-4000-8000-0000000003a3';
  err text; r record; claimed uuid;
BEGIN
  -- 1. THE DEFECT: an owner renames an item on an approved, live listing.
  err := pg_temp._exec_as('authenticated', seller,
    'UPDATE public.marketplace_listing_items SET name = ''Unscreened new name'' WHERE id = ''ffffffff-0000-4000-8000-000000000301''');
  SELECT * INTO r FROM pg_temp._row(1);
  PERFORM pg_temp._assert('ir1a owner item rename is accepted', err IS NULL, coalesce(err, ''));
  PERFORM pg_temp._assert('ir1b renamed item sends the live listing back to pending_review', r.st = 'pending_review', coalesce(r.st, '<null>'));
  PERFORM pg_temp._assert('ir1c the old approved verdict is cleared', r.verdict IS NULL, coalesce(r.verdict, '<null>'));
  PERFORM pg_temp._assume('service_role');
  SELECT c.id INTO claimed FROM public.claim_marketplace_listing_moderation(
    'eeeeeeee-0000-4000-8000-000000000301', seller, now() - interval '5 minutes') c;
  PERFORM pg_temp._assume('postgres');
  PERFORM pg_temp._assert('ir1d moderate-listing can claim it again', claimed IS NOT NULL, '<no claim>');

  -- 2. Adding an item to a live listing is a screened change.
  err := pg_temp._exec_as('authenticated', seller,
    'INSERT INTO public.marketplace_listing_items (listing_id, name, price) VALUES (''eeeeeeee-0000-4000-8000-000000000302'', ''Unscreened extra'', 5)');
  SELECT * INTO r FROM pg_temp._row(2);
  PERFORM pg_temp._assert('ir2 added item sends the live listing back to pending_review',
    err IS NULL AND r.st = 'pending_review' AND r.verdict IS NULL, coalesce(err, r.st || '/' || coalesce(r.verdict, '<null>')));

  -- 3. A sold toggle (status only) is not a screened change.
  err := pg_temp._exec_as('authenticated', seller,
    'UPDATE public.marketplace_listing_items SET status = ''sold'', price = 9 WHERE id = ''ffffffff-0000-4000-8000-000000000303''');
  SELECT * INTO r FROM pg_temp._row(3);
  PERFORM pg_temp._assert('ir3 item status/price write leaves the listing available+approved',
    err IS NULL AND r.st = 'available' AND r.verdict = 'approved', coalesce(err, r.st || '/' || coalesce(r.verdict, '<null>')));

  -- 4. The edit form re-saves every item name; an unchanged (or whitespace-only) name is not a change.
  err := pg_temp._exec_as('authenticated', seller,
    'UPDATE public.marketplace_listing_items SET name = '' Plain chair '' WHERE id = ''ffffffff-0000-4000-8000-000000000304''');
  SELECT * INTO r FROM pg_temp._row(4);
  PERFORM pg_temp._assert('ir4 re-saving the same item name leaves the listing live',
    err IS NULL AND r.st = 'available' AND r.verdict = 'approved', coalesce(err, r.st));

  -- 5. Renaming while a worker holds a claim invalidates that claim.
  err := pg_temp._exec_as('authenticated', seller,
    'UPDATE public.marketplace_listing_items SET name = ''Mid-review rename'' WHERE id = ''ffffffff-0000-4000-8000-000000000305''');
  SELECT * INTO r FROM pg_temp._row(5);
  PERFORM pg_temp._assert('ir5 item rename during review clears the in-flight claim',
    err IS NULL AND r.st = 'pending_review' AND r.started IS NULL, coalesce(err, r.st || '/' || coalesce(r.started::text, 'null')));

  -- 6. Held listing: stays in the human queue with its verdict.
  err := pg_temp._exec_as('authenticated', seller,
    'UPDATE public.marketplace_listing_items SET name = ''Held rename'' WHERE id = ''ffffffff-0000-4000-8000-000000000306''');
  SELECT * INTO r FROM pg_temp._row(6);
  PERFORM pg_temp._assert('ir6 item rename on a held listing stays under_review/held',
    err IS NULL AND r.st = 'under_review' AND r.verdict = 'held', coalesce(err, r.st));

  -- 7. Sold listing: an added or renamed item is refused with the relist message.
  err := pg_temp._exec_as('authenticated', seller,
    'UPDATE public.marketplace_listing_items SET name = ''Sold rename'' WHERE id = ''ffffffff-0000-4000-8000-000000000307''');
  PERFORM pg_temp._assert('ir7a item rename on a sold listing is refused', err LIKE 'Relist this listing%', coalesce(err, 'ALLOWED'));
  err := pg_temp._exec_as('authenticated', seller,
    'INSERT INTO public.marketplace_listing_items (listing_id, name, price) VALUES (''eeeeeeee-0000-4000-8000-000000000307'', ''Sold extra'', 5)');
  PERFORM pg_temp._assert('ir7b adding an item to a sold listing is refused', err LIKE 'Relist this listing%', coalesce(err, 'ALLOWED'));
  -- …while the bulk item-status writes markAsSold/relist make still work.
  err := pg_temp._exec_as('authenticated', seller,
    'UPDATE public.marketplace_listing_items SET status = ''available'' WHERE listing_id = ''eeeeeeee-0000-4000-8000-000000000307''');
  PERFORM pg_temp._assert('ir7c item status write on a sold listing still works', err IS NULL, coalesce(err, ''));

  -- 8. Removing an item adds no content: the listing stays live.
  err := pg_temp._exec_as('authenticated', seller,
    'DELETE FROM public.marketplace_listing_items WHERE id = ''ffffffff-0000-4000-8000-000000000308''');
  SELECT * INTO r FROM pg_temp._row(8);
  PERFORM pg_temp._assert('ir8 deleting an item leaves the listing available+approved',
    err IS NULL AND r.st = 'available' AND r.verdict = 'approved', coalesce(err, r.st));

  -- 9/10. service_role and admins are exempt.
  err := pg_temp._exec_as('service_role', NULL,
    'UPDATE public.marketplace_listing_items SET name = ''Service rename'' WHERE id = ''ffffffff-0000-4000-8000-000000000309''');
  SELECT * INTO r FROM pg_temp._row(9);
  PERFORM pg_temp._assert('ir9 service_role item rename keeps available+approved',
    err IS NULL AND r.st = 'available' AND r.verdict = 'approved', coalesce(err, r.st));
  err := pg_temp._exec_as('authenticated', admin,
    'UPDATE public.marketplace_listing_items SET name = ''Admin rename'' WHERE id = ''ffffffff-0000-4000-8000-000000000310''');
  SELECT * INTO r FROM pg_temp._row(10);
  PERFORM pg_temp._assert('ir10 admin item rename keeps available+approved',
    err IS NULL AND r.st = 'available' AND r.verdict = 'approved', coalesce(err, r.st));

  -- 11. The item-change marker only counts when it comes from the item trigger:
  --     a direct, non-screened listing write with the marker set stays live.
  PERFORM set_config('dormcheck.items_changed_listing', 'eeeeeeee-0000-4000-8000-000000000311', true);
  err := pg_temp._exec_as('authenticated', seller,
    'UPDATE public.marketplace_listings SET price = 11 WHERE id = ''eeeeeeee-0000-4000-8000-000000000311''');
  PERFORM set_config('dormcheck.items_changed_listing', '', true);
  SELECT * INTO r FROM pg_temp._row(11);
  PERFORM pg_temp._assert('ir11 a forged marker on a direct listing write does not move the listing',
    err IS NULL AND r.st = 'available' AND r.verdict = 'approved', coalesce(err, r.st));

  -- 12. Create flow: items inserted onto a fresh pending_review listing are accepted
  --     and the listing stays claimable (the client invokes moderate-listing after).
  err := pg_temp._exec_as('authenticated', seller,
    'INSERT INTO public.marketplace_listing_items (listing_id, name, price) VALUES '
    || '(''eeeeeeee-0000-4000-8000-000000000312'', ''Desk'', 5), (''eeeeeeee-0000-4000-8000-000000000312'', ''Lamp'', 3)');
  SELECT * INTO r FROM pg_temp._row(12);
  PERFORM pg_temp._assert('ir12 create-flow item insert keeps pending_review, unclaimed',
    err IS NULL AND r.st = 'pending_review' AND r.started IS NULL, coalesce(err, r.st));

  -- 13. Service posts go back to review the same way ('open' -> pending_review).
  err := pg_temp._exec_as('authenticated', seller,
    'UPDATE public.marketplace_listing_items SET name = ''Second desk'' WHERE id = ''ffffffff-0000-4000-8000-000000000313''');
  SELECT * INTO r FROM pg_temp._row(13);
  PERFORM pg_temp._assert('ir13 item rename on an open service post goes back to pending_review',
    err IS NULL AND r.st = 'pending_review', coalesce(err, r.st));
END $$;

DO $$
DECLARE fails int;
BEGIN
  SELECT count(*) INTO fails FROM test_results WHERE NOT pass;
  IF fails > 0 THEN
    RAISE EXCEPTION '% assertion(s) FAILED in listing_item_rescreen', fails;
  END IF;
  RAISE NOTICE 'ALL % assertions passed', (SELECT count(*) FROM test_results);
END $$;

ROLLBACK;
