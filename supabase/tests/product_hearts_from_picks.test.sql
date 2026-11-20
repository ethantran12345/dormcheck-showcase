-- Adversarial tests for product_hearts_from_picks migration.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/product_hearts_from_picks.test.sql

-- NOTE: `explore_picks.university_id` lost its Pitt DEFAULT in the 2026-07-10 multi-tenant
-- migration and is now derived from the INSERTing user's profile or passed explicitly. These
-- fixtures insert as `postgres` (auth.uid() IS NULL), so the value is passed explicitly.

BEGIN;

-- Fixtures
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'pump-a@pitt.edu', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'pump-b@pitt.edu', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.amazon_products (id, name, price, category, affiliate_link, hearts)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test Pump Product', 9.99, 'Test', 'https://example.com', 0)
ON CONFLICT (id) DO UPDATE SET hearts = 0, name = EXCLUDED.name;

CREATE TEMP TABLE test_results (name text, pass boolean, detail text);

CREATE OR REPLACE FUNCTION _assert(label text, cond boolean, detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO test_results VALUES (label, cond, detail);
  IF NOT cond THEN
    RAISE NOTICE 'FAIL: % - %', label, detail;
  ELSE
    RAISE NOTICE 'PASS: %', label;
  END IF;
END;
$$;

DO $$
DECLARE
  pid uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  uid_a uuid := '11111111-1111-1111-1111-111111111111';
  uid_b uuid := '22222222-2222-2222-2222-222222222222';
  h integer;
BEGIN
  -- Baseline
  SELECT hearts INTO h FROM public.amazon_products WHERE id = pid;
  PERFORM _assert('baseline hearts = 0', h = 0, 'got ' || h);

  -- Single pick insert
  INSERT INTO public.explore_picks (user_id, product_name, university_id) VALUES (uid_a, 'Test Pump Product', '00000000-0000-4000-8000-000000000001');
  SELECT hearts INTO h FROM public.amazon_products WHERE id = pid;
  PERFORM _assert('insert pick -> hearts = 1', h = 1, 'got ' || h);

  -- Second user
  INSERT INTO public.explore_picks (user_id, product_name, university_id) VALUES (uid_b, 'Test Pump Product', '00000000-0000-4000-8000-000000000001');
  SELECT hearts INTO h FROM public.amazon_products WHERE id = pid;
  PERFORM _assert('two pickers -> hearts = 2', h = 2, 'got ' || h);

  -- Old pump path: RPC increment after pick exists (deployed client behavior)
  PERFORM public.increment_product_hearts(pid);
  PERFORM public.increment_product_hearts(pid);
  SELECT hearts INTO h FROM public.amazon_products WHERE id = pid;
  PERFORM _assert('increment RPC is no-op (still 2)', h = 2, 'got ' || h);

  -- Unlike with RPC decrement (deployed client) - pick row deleted, RPC no-op
  DELETE FROM public.explore_picks WHERE user_id = uid_a AND product_name = 'Test Pump Product';
  PERFORM public.decrement_product_hearts(pid);
  PERFORM public.decrement_product_hearts(pid);
  SELECT hearts INTO h FROM public.amazon_products WHERE id = pid;
  PERFORM _assert('delete pick + decrement RPC no-op -> hearts = 1', h = 1, 'got ' || h);

  -- Re-like pump cycle (the old runaway): insert/delete/insert/delete
  INSERT INTO public.explore_picks (user_id, product_name, university_id) VALUES (uid_a, 'Test Pump Product', '00000000-0000-4000-8000-000000000001');
  PERFORM public.increment_product_hearts(pid);
  SELECT hearts INTO h FROM public.amazon_products WHERE id = pid;
  PERFORM _assert('re-like after unlike -> hearts = 2 not 3', h = 2, 'got ' || h);

  DELETE FROM public.explore_picks WHERE user_id = uid_a AND product_name = 'Test Pump Product';
  PERFORM public.decrement_product_hearts(pid);
  SELECT hearts INTO h FROM public.amazon_products WHERE id = pid;
  PERFORM _assert('second unlike -> hearts = 1 not 0 or 2', h = 1, 'got ' || h);

  INSERT INTO public.explore_picks (user_id, product_name, university_id) VALUES (uid_a, 'Test Pump Product', '00000000-0000-4000-8000-000000000001');
  PERFORM public.increment_product_hearts(pid);
  DELETE FROM public.explore_picks WHERE user_id = uid_a AND product_name = 'Test Pump Product';
  PERFORM public.decrement_product_hearts(pid);
  INSERT INTO public.explore_picks (user_id, product_name, university_id) VALUES (uid_a, 'Test Pump Product', '00000000-0000-4000-8000-000000000001');
  PERFORM public.increment_product_hearts(pid);
  SELECT hearts INTO h FROM public.amazon_products WHERE id = pid;
  PERFORM _assert('3x pump cycle ends at 2 (uid_b only + uid_a once)', h = 2, 'got ' || h);

  -- Simulate pre-migration inflation then reconcile
  UPDATE public.amazon_products SET hearts = 999 WHERE id = pid;
  UPDATE public.amazon_products p
  SET hearts = COALESCE((
    SELECT count(*) FROM public.explore_picks ep WHERE ep.product_name = p.name
  ), 0)
  WHERE id = pid;
  SELECT hearts INTO h FROM public.amazon_products WHERE id = pid;
  PERFORM _assert('backfill reconciles inflated count', h = 2, 'got ' || h);

  -- Clear all picks
  DELETE FROM public.explore_picks WHERE product_name = 'Test Pump Product';
  SELECT hearts INTO h FROM public.amazon_products WHERE id = pid;
  PERFORM _assert('all picks removed -> hearts = 0', h = 0, 'got ' || h);

  -- RPC-only without pick row (should not change hearts)
  PERFORM public.increment_product_hearts(pid);
  PERFORM public.increment_product_hearts(pid);
  SELECT hearts INTO h FROM public.amazon_products WHERE id = pid;
  PERFORM _assert('RPC increment without pick row -> hearts stay 0', h = 0, 'got ' || h);
END;
$$;

SELECT name, pass, detail FROM test_results ORDER BY name;

DO $$
DECLARE
  failures integer;
BEGIN
  SELECT count(*) INTO failures FROM test_results WHERE NOT pass;
  IF failures > 0 THEN
    RAISE EXCEPTION '% adversarial test(s) failed', failures;
  END IF;
  RAISE NOTICE 'All % tests passed', (SELECT count(*) FROM test_results);
END;
$$;

ROLLBACK;
