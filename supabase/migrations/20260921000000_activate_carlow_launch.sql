-- Activate Carlow as tenant #3 and capture CMU's intended full-surface state.
--
-- Carlow's official FERPA release form requires the student suffix
-- @live.carlow.edu, and official carlow.edu pages publish staff addresses.
-- The 2026-27 academic calendar and Housing page are the sources for the two
-- residence halls and arrival dates below. No rates, capacity, floor counts,
-- imagery, reviews, or other facts are inferred.
--
-- Depends on:
--   20260918000000_shared_marketplace_group.sql
--   20260918000001_seed_carlow_university.sql
--   20260920000000_profiles_legal_notice_ack.sql
--
-- Rollback lever (closes new Carlow signups without deleting tenant data):
--   UPDATE public.universities SET is_active = false WHERE slug = 'carlow';

INSERT INTO public.universities (
  id,
  slug,
  name,
  short_name,
  email_domains,
  city,
  is_active,
  marketplace_group,
  feature_flags
)
VALUES (
  '00000000-0000-4000-8000-000000000003',
  'carlow',
  'Carlow University',
  'Carlow',
  ARRAY['live.carlow.edu', 'carlow.edu'],
  'Pittsburgh, PA',
  true,
  'pittsburgh',
  '{}'::jsonb
)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    short_name = EXCLUDED.short_name,
    email_domains = EXCLUDED.email_domains,
    city = EXCLUDED.city,
    is_active = EXCLUDED.is_active,
    marketplace_group = EXCLUDED.marketplace_group,
    feature_flags = EXCLUDED.feature_flags;

-- Repo config has CMU `limitedSurfaces: false`. Remove the hand-written prod
-- override that currently disables six surfaces and makes production disagree
-- with every local/seeded verification environment.
UPDATE public.universities
   SET feature_flags = '{}'::jsonb
 WHERE slug = 'cmu';

-- Seed only facts Carlow publishes. The buildings are connected and share the
-- central 3333 Fifth Avenue campus location, so they deliberately use the same
-- campus-level coordinate until a building-level official source is available.
WITH next_id AS (
  SELECT COALESCE(MAX(id), 0) + 1 AS id
    FROM public.master_housing
), halls AS (
  SELECT *
    FROM (VALUES
      (
        'Frances Warde Hall'::text,
        'Standard single or double room'::text,
        'On-Campus Housing'::text,
        '3333 Fifth Avenue, Pittsburgh, PA 15213'::text,
        'First-year students share a double room; upper-class students may apply for a limited number of single rooms.'::text,
        'Twin or twin XL bed, desk and chair, chest of drawers, wardrobe or closet, micro-fridge, window air conditioner'::text,
        'Connected residence halls with shared lounges, full kitchen, computer lab, study rooms, and 24-hour monitored entrances'::text,
        'Free washers and dryers are available in the residence halls.'::text
      ),
      (
        'Dougherty Hall'::text,
        'Standard single or double room'::text,
        'On-Campus Housing'::text,
        '3333 Fifth Avenue, Pittsburgh, PA 15213'::text,
        'First-year students share a double room; upper-class students may apply for a limited number of single rooms.'::text,
        'Twin or twin XL bed, desk and chair, chest of drawers, wardrobe or closet, micro-fridge, window air conditioner'::text,
        'Connected residence halls with shared lounges, full kitchen, computer lab, study rooms, and 24-hour monitored entrances'::text,
        'Free washers and dryers are available in the residence halls.'::text
      )
    ) AS source(residence_hall, accomodation, housing_type, address, who_lives_here, inroom_amenities, building_amenities, laundry)
), missing AS (
  SELECT halls.*, ROW_NUMBER() OVER (ORDER BY residence_hall) - 1 AS offset
    FROM halls
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.master_housing existing
      WHERE existing.university_id = '00000000-0000-4000-8000-000000000003'
        AND lower(existing.residence_hall) = lower(halls.residence_hall)
   )
)
INSERT INTO public.master_housing (
  id,
  residence_hall,
  accomodation,
  housing_type,
  address,
  who_lives_here,
  inroom_amenities,
  building_amenities,
  laundry,
  meal_plan_options,
  wifi_and_cable,
  heat_and_air_conditioning,
  latitude,
  longitude,
  move_in_date,
  move_in_time_window,
  move_in_notes,
  university_id
)
SELECT
  next_id.id + missing.offset,
  missing.residence_hall,
  missing.accomodation,
  missing.housing_type,
  missing.address,
  missing.who_lives_here,
  missing.inroom_amenities,
  missing.building_amenities,
  missing.laundry,
  true,
  true,
  true,
  40.43897,
  -79.9636,
  DATE '2026-08-26',
  'New first-year residents: 8 a.m. Aug 26; returning and transfer residents: 8 a.m. Aug 29',
  'Follow individualized instructions from Carlow Residence Life. Confirm bed size before purchasing linens.',
  '00000000-0000-4000-8000-000000000003'
FROM missing
CROSS JOIN next_id;

-- Fail the migration rather than record a partial activation.
DO $$
DECLARE
  active_count integer;
  hall_count integer;
BEGIN
  SELECT count(*) INTO active_count
    FROM public.universities
   WHERE slug IN ('pitt', 'cmu', 'carlow')
     AND is_active;

  SELECT count(*) INTO hall_count
    FROM public.master_housing
   WHERE university_id = '00000000-0000-4000-8000-000000000003';

  IF active_count <> 3 THEN
    RAISE EXCEPTION 'Carlow activation incomplete: expected 3 active tenants, found %', active_count;
  END IF;

  IF hall_count <> 2 THEN
    RAISE EXCEPTION 'Carlow housing seed incomplete: expected 2 halls, found %', hall_count;
  END IF;
END
$$;
