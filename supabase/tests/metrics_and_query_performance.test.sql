-- Regression probe for 20260831020000. All rows roll back.
BEGIN;

INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active)
VALUES ('81000000-0000-4000-8000-000000000001', 'metrics-probe', 'Metrics Probe University', 'MPU', ARRAY['metrics.example'], false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('82000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('82000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, full_name, university_id, email, current_dorm, created_at)
VALUES
  ('82000000-0000-4000-8000-000000000001', 'Metrics Probe Active', '81000000-0000-4000-8000-000000000001', 'active@metrics.example', 'Probe Hall', now()),
  ('82000000-0000-4000-8000-000000000002', 'Metrics Probe Stuck', '81000000-0000-4000-8000-000000000001', 'stuck@metrics.example', NULL, now() - interval '8 days')
ON CONFLICT (id) DO UPDATE SET university_id = EXCLUDED.university_id, created_at = EXCLUDED.created_at;

INSERT INTO public.analytics_events (user_id, event_name, created_at)
VALUES ('82000000-0000-4000-8000-000000000001', 'listing_created', now());

INSERT INTO public.marketplace_listings (id, user_id, title, price, category, university_id, status, last_confirmed_at)
VALUES ('83000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'Metrics probe lamp', 10, 'other', '81000000-0000-4000-8000-000000000001', 'available', now() - interval '22 days');

DO $$
DECLARE payload jsonb;
BEGIN
  SELECT public.get_admin_metrics('81000000-0000-4000-8000-000000000001') INTO payload;
  IF (payload->>'total_users')::integer <> 2 THEN RAISE EXCEPTION 'metrics total_users was %', payload->>'total_users'; END IF;
  IF (payload->>'active_last_7_days')::integer <> 1 THEN RAISE EXCEPTION 'metrics active count was %', payload->>'active_last_7_days'; END IF;
  IF (payload->>'core_actions_this_week')::integer <> 1 THEN RAISE EXCEPTION 'metrics core actions was %', payload->>'core_actions_this_week'; END IF;
  IF (payload->>'active_listings')::integer <> 1 THEN RAISE EXCEPTION 'metrics active listings was %', payload->>'active_listings'; END IF;
  IF (payload->>'stuck_count')::integer <> 1 THEN RAISE EXCEPTION 'metrics stuck count was %', payload->>'stuck_count'; END IF;
  IF jsonb_array_length(payload->'recent_signups') <> 2 THEN RAISE EXCEPTION 'metrics recent signup sample incorrect'; END IF;
  IF to_regclass('public.idx_marketplace_listings_available_nudge_due') IS NULL THEN RAISE EXCEPTION 'missing freshness query index'; END IF;
  IF to_regclass('public.idx_university_waitlist_domain_created_at') IS NULL THEN RAISE EXCEPTION 'missing waitlist query index'; END IF;
END $$;

ROLLBACK;
