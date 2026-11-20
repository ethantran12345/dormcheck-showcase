-- Regression probe for 20260831010000. Run inside a transaction so it leaves
-- no durable rows.

BEGIN;

INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active)
VALUES ('71000000-0000-4000-8000-000000000001', 'perf-probe', 'Performance Probe University', 'PPU', ARRAY['perf.example'], true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES ('72000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, full_name, university_id, created_at)
VALUES ('72000000-0000-4000-8000-000000000001', 'Performance Probe User', '71000000-0000-4000-8000-000000000001', now())
ON CONFLICT (id) DO UPDATE SET university_id = EXCLUDED.university_id, created_at = EXCLUDED.created_at;

INSERT INTO public.marketplace_listings (id, user_id, title, price, category, university_id, status)
VALUES ('73000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'Probe lamp', 10, 'other', '71000000-0000-4000-8000-000000000001', 'pending_review');

INSERT INTO public.content_reports (id, content_type, content_id, reporter_id, reason)
VALUES ('74000000-0000-4000-8000-000000000001', 'marketplace_listing', '73000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'probe');

CREATE TEMP TABLE test_results (name text, pass boolean, detail text);
CREATE OR REPLACE FUNCTION pg_temp._assert(label text, cond boolean, detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO test_results VALUES (label, cond, detail);
  IF NOT cond THEN RAISE NOTICE 'FAIL: % - %', label, detail; END IF;
END;
$$;

DO $$
DECLARE
  first_claim record;
  retry_claim_count integer;
  metric record;
BEGIN
  SELECT * INTO first_claim
    FROM public.claim_marketplace_listing_moderation(
      '73000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      now() - interval '5 minutes'
    );
  PERFORM pg_temp._assert('first pending listing claim succeeds', first_claim.id IS NOT NULL);

  SELECT count(*) INTO retry_claim_count
    FROM public.claim_marketplace_listing_moderation(
      '73000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      now() - interval '5 minutes'
    );
  PERFORM pg_temp._assert('concurrent retry cannot claim the same listing', retry_claim_count = 0,
    'claims=' || retry_claim_count);

  SELECT * INTO metric
    FROM public.get_weekly_digest_metrics('71000000-0000-4000-8000-000000000001', now() - interval '1 day');
  PERFORM pg_temp._assert('weekly aggregate returns the university name', metric.university_name = 'Performance Probe University');
  PERFORM pg_temp._assert('weekly aggregate counts signups in SQL', metric.new_signups = 1, 'got=' || metric.new_signups);
  PERFORM pg_temp._assert('weekly aggregate counts listings in SQL', metric.new_listings = 1, 'got=' || metric.new_listings);
  PERFORM pg_temp._assert('weekly aggregate joins reports to reporter tenant in SQL', metric.open_reports = 1, 'got=' || metric.open_reports);
END $$;

DO $$
DECLARE failures integer;
BEGIN
  SELECT count(*) INTO failures FROM test_results WHERE NOT pass;
  IF failures > 0 THEN RAISE EXCEPTION '% assertion(s) FAILED in backend_security_performance_hardening', failures; END IF;
END $$;

ROLLBACK;
