-- master_housing data hygiene (2026-07-10 dorm-data audit)
-- Idempotent UPDATE-only migration; no DDL. Apply to prod via Supabase MCP apply_migration.
--
-- 1) Collapse repeated whitespace + trim on free-text label columns.
--    (Snapshot before: residence_hall 3 dirty rows, accomodation 30, who_lives_here 18.)
-- 2) Canonicalize who_lives_here to a fixed value set so filtering/grouping is exact-match safe.
--    Client note: parseAudienceType (src/hooks/useDorms.ts) is updated in the same change to
--    check first-year before upperclass so mixed-population halls keep their First Year badge.
-- Not changed (documented follow-ups): Pennsylvania Apartments designation (await Pitt 2026-27
-- confirmation); The Wellington capacity/floors/terms (Pitt page does not publish them);
-- Bridge on Forbes terms (verified consistent: three-term commitment billed per term).

UPDATE public.master_housing
SET residence_hall = trim(regexp_replace(residence_hall, '\s+', ' ', 'g'))
WHERE residence_hall IS NOT NULL
  AND residence_hall <> trim(regexp_replace(residence_hall, '\s+', ' ', 'g'));

UPDATE public.master_housing
SET accomodation = trim(regexp_replace(accomodation, '\s+', ' ', 'g'))
WHERE accomodation IS NOT NULL
  AND accomodation <> trim(regexp_replace(accomodation, '\s+', ' ', 'g'));

UPDATE public.master_housing
SET who_lives_here = trim(regexp_replace(who_lives_here, '\s+', ' ', 'g'))
WHERE who_lives_here IS NOT NULL
  AND who_lives_here <> trim(regexp_replace(who_lives_here, '\s+', ' ', 'g'));

UPDATE public.master_housing
SET community_type = trim(regexp_replace(community_type, '\s+', ' ', 'g'))
WHERE community_type IS NOT NULL
  AND community_type <> trim(regexp_replace(community_type, '\s+', ' ', 'g'));

UPDATE public.master_housing
SET housing_type = trim(regexp_replace(housing_type, '\s+', ' ', 'g'))
WHERE housing_type IS NOT NULL
  AND housing_type <> trim(regexp_replace(housing_type, '\s+', ' ', 'g'));

-- Canonical who_lives_here values (matched against post-trim spellings observed in prod):
UPDATE public.master_housing
SET who_lives_here = 'First-Year Students'
WHERE who_lives_here IN ('First Year Students', 'First-year students');

UPDATE public.master_housing
SET who_lives_here = 'Upperclass Students'
WHERE who_lives_here IN ('Upper-class students', 'Upper-Class Students', 'Upper- Class Students');

UPDATE public.master_housing
SET who_lives_here = 'First-Year and Upperclass Students'
WHERE who_lives_here IN ('First Year and Upper-class Students', 'First-year and Upper-class students');

UPDATE public.master_housing
SET who_lives_here = 'First-Year Students (Floors 4-11); Upperclass Students (Floor 3)'
WHERE who_lives_here IN (
  'First Year Students ( Floors 4-11); Upper- Class Students (Floor 3)',
  'First Year Students (Floors 4-11); Upper- Class Students (Floor 3)'
);
