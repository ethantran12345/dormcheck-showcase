-- covers: 20260731040000_student_setups_hidden_and_reports.sql
-- Smoke + adversarial checks for public preview RPCs (group 2 phase B).
-- Run after: npx supabase db reset
--   docker exec -i supabase_db_Dormcheck psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/public_preview_rpcs.test.sql

DO $$
DECLARE
  v_seller_id uuid := 'dddddddd-dddd-dddd-dddd-dddddddddd01';
  v_setup_user_id uuid := 'dddddddd-dddd-dddd-dddd-dddddddddd03';
  v_reviewer_id uuid := 'dddddddd-dddd-dddd-dddd-dddddddddd04';
  -- Multi-tenant fixtures (2026-07-10 `drop_university_default_add_trigger`): the 11 content
  -- roots lost their Pitt DEFAULT and now derive university_id from the INSERTing user's
  -- profile or take it explicitly. This block seeds as `postgres`, so auth.uid() is NULL and
  -- nothing can be derived — a seed script is expected to pass the value.
  v_pitt_id uuid := '00000000-0000-4000-8000-000000000001';
BEGIN
  -- Idempotency: drop any fixtures left by a previous run of this file so a repeat
  -- `npm run test:db` without an intervening `db reset` seeds the same rows, not double.
  DELETE FROM public.setup_photos sp
    USING public.student_setups ss
    WHERE sp.setup_id = ss.id AND ss.user_id = v_setup_user_id;
  DELETE FROM public.student_setups WHERE user_id = v_setup_user_id;
  DELETE FROM public.marketplace_listings WHERE user_id = v_seller_id;

  -- This probe runs OUTSIDE a transaction, so its auth.users rows always outlive the run.
  -- The trailing '', '', '', '' are confirmation_token / recovery_token /
  -- email_change_token_new / email_change: a NULL in any GoTrue string column 500s the whole
  -- admin user API. See content_reports_user_type.test.sql for the full note and
  -- docs/handoffs/authed-ui-pass-2026-08-06.md defect 4 — preview-*@pitt.edu were three of
  -- the eleven rows that poisoned the stack.
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_seller_id, 'authenticated', 'authenticated', 'preview-seller@pitt.edu', crypt('testpass', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_setup_user_id, 'authenticated', 'authenticated', 'preview-setup@pitt.edu', crypt('testpass', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_reviewer_id, 'authenticated', 'authenticated', 'preview-reviewer@pitt.edu', crypt('testpass', gen_salt('bf')), now(), now(), now(), '', '', '', '')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, email, full_name, university_id)
  VALUES
    (v_seller_id, 'preview-seller@pitt.edu', 'Preview Seller', v_pitt_id),
    (v_setup_user_id, 'preview-setup@pitt.edu', 'Preview Setup', v_pitt_id),
    (v_reviewer_id, 'preview-reviewer@pitt.edu', 'Preview Reviewer', v_pitt_id)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, university_id = EXCLUDED.university_id;

  INSERT INTO public.marketplace_listings (user_id, title, description, price, category, image_url, status, phone_number, created_at, university_id)
  SELECT v_seller_id, 'Preview listing ' || gs.i, 'Secret description ' || gs.i, (gs.i * 5)::numeric, 'Furniture', 'https://example.com/listing-' || gs.i || '.jpg', 'available', '412555' || lpad(gs.i::text, 4, '0'), now() - (gs.i || ' hours')::interval, v_pitt_id
  FROM generate_series(1, 8) AS gs(i);

  INSERT INTO public.marketplace_listings (user_id, title, description, price, category, status, university_id)
  SELECT v_seller_id, 'Sold listing ' || gs.i, 'Sold secret ' || gs.i, 99::numeric, 'Other', 'sold', v_pitt_id
  FROM generate_series(1, 2) AS gs(i);

  INSERT INTO public.student_setups (dorm_name, image_url, caption, author_name, user_id, university_id)
  SELECT 'Tower A', 'https://example.com/setup-cover-' || gs.i || '.jpg', 'Setup caption ' || gs.i, 'Author ' || gs.i, v_setup_user_id, v_pitt_id
  FROM generate_series(1, 3) AS gs(i);

  INSERT INTO public.setup_photos (setup_id, image_url, created_at)
  SELECT ss.id, 'https://example.com/setup-photo-' || gs.i || '.jpg', now() - (gs.i || ' minutes')::interval
  FROM public.student_setups ss
  CROSS JOIN generate_series(1, 4) AS gs(i)
  WHERE ss.user_id = v_setup_user_id;
END $$;

-- The preview RPCs report GLOBAL (unfiltered) totals, so the expected counts depend on
-- whatever else is in the DB — earlier probes in scripts/test-db.sh seed their own
-- available listings. Hardcoding 8/3 made this file order-dependent. Compute the truth
-- as postgres, hand it to the anon block via a temp table, and assert against that.
DROP TABLE IF EXISTS preview_expected;
CREATE TEMP TABLE preview_expected AS
SELECT
  (SELECT count(*)::bigint FROM public.marketplace_listings WHERE status = 'available') AS marketplace_total,
  (SELECT count(*)::bigint FROM public.student_setups WHERE NOT is_hidden) AS setups_total;
GRANT SELECT ON preview_expected TO anon;

-- Harness role fidelity (docs/security/reaudit-2026-08-06.md H1). A real guest reaches these
-- RPCs as session_user='authenticator', current_user='anon'; SET ROLE alone would leave
-- session_user superuser, which silently exempts every guard written as
-- session_user IN ('postgres','supabase_admin'). This file deliberately runs OUTSIDE a
-- transaction, so the session-scoped form is used and RESET below puts the connection back.
RESET ROLE;
SET SESSION AUTHORIZATION authenticator;
SET ROLE anon;

DO $$
DECLARE
  v_marketplace jsonb;
  v_setups jsonb;
  v_text text;
  v_listing jsonb;
  v_allowed text[] := ARRAY['id', 'title', 'price', 'category', 'image_url'];
  v_key text;
  v_expect_marketplace bigint;
  v_expect_setups bigint;
BEGIN
  SELECT marketplace_total, setups_total INTO v_expect_marketplace, v_expect_setups
  FROM preview_expected;

  -- Zero-arg calls are deliberate: they prove exactly ONE `get_setups_preview` overload
  -- survives a from-scratch replay. Two overloads (the state before 20260731040000 was
  -- amended on 2026-07-26) make this line fail with 42725 "function ... is not unique".
  v_marketplace := public.get_marketplace_preview();
  v_setups := public.get_setups_preview();

  IF (v_marketplace->>'total_count')::bigint <> v_expect_marketplace THEN
    RAISE EXCEPTION 'marketplace total_count expected %, got %', v_expect_marketplace, v_marketplace->>'total_count';
  END IF;
  IF jsonb_array_length(v_marketplace->'listings') <> 6 THEN
    RAISE EXCEPTION 'marketplace listings sample expected 6, got %', jsonb_array_length(v_marketplace->'listings');
  END IF;
  IF (v_setups->>'total_count')::bigint <> v_expect_setups THEN
    RAISE EXCEPTION 'setups total_count expected %, got %', v_expect_setups, v_setups->>'total_count';
  END IF;
  IF jsonb_array_length(v_setups->'photo_urls') <> 6 THEN
    RAISE EXCEPTION 'setups photo_urls expected 6, got %', jsonb_array_length(v_setups->'photo_urls');
  END IF;

  v_text := v_marketplace::text;
  IF v_text ~* 'user_id|description|phone|contact|instagram|snapchat' THEN
    RAISE EXCEPTION 'marketplace preview leaked sensitive field names';
  END IF;

  v_text := v_setups::text;
  IF v_text ~* 'user_id|caption|author_name|setup_id|dorm_name' THEN
    RAISE EXCEPTION 'setups preview leaked sensitive field names';
  END IF;

  FOR v_listing IN SELECT jsonb_array_elements(v_marketplace->'listings')
  LOOP
    FOREACH v_key IN ARRAY (SELECT array_agg(k) FROM jsonb_object_keys(v_listing) AS k)
    LOOP
      IF NOT (v_key = ANY (v_allowed)) THEN
        RAISE EXCEPTION 'marketplace listing has disallowed key: %', v_key;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'ALL TESTS PASSED';
END $$;

RESET ROLE;
RESET SESSION AUTHORIZATION;
