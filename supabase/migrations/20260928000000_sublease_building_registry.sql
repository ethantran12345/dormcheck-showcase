-- A sublease's building becomes a PICKED ENTITY instead of typed prose.
--
-- Why this and not geocoding at post time: `building_name` is the last field on a
-- sublease that violates the rule src/lib/subleases.ts opens with — "every fact a
-- sublease asserts is a typed column." Two students spelling the same address two
-- ways produce two records that can never be grouped, and free text has no
-- coordinates at all. Geocoding the prose would fix the second problem by making
-- the first one worse: a map pin asserts location far more strongly than a text
-- line does, so a bad geocode ships a confident lie. Picking from a curated
-- registry also turns same-building collapse into `GROUP BY building_id` rather
-- than lat/lng proximity matching, which guesses.
--
-- This migration is the schema half only. The map, the /subleases route and the
-- count-badge markers are Phase 2 and land nowhere in this file.
--
-- Untouched on purpose:
--   * rls_marketplace_listings_insert / rls_marketplace_listings_update
--     (20260907000000) — `building_id` is an ordinary nullable column and creates
--     no write path of its own, so the can_post_sublease() gate on BOTH halves
--     stays exactly as written. The verification query at the bottom of this file
--     is what makes that a checked claim rather than an assumption.
--   * rls_buildings_select + tenant_isolation on public.buildings — a signed-in
--     student can already SELECT the registry, confined to their own tenant.
--     Nothing to add; see § 3.
--
-- Rollback:
--   ALTER TABLE public.marketplace_listings DROP COLUMN building_id;
--   DROP INDEX IF EXISTS public.idx_buildings_subleasable;
--   DROP INDEX IF EXISTS public.buildings_university_id_name_key;
--   ALTER TABLE public.buildings DROP COLUMN is_subleasable, DROP COLUMN kind;

-- ── 1. The registry gains a type and an opt-in ───────────────────────────────
-- Both defaults are chosen so the 269 rows already in this table keep their
-- current meaning exactly: they are Pitt-owned academic buildings and Pitt
-- properties, and they stay OUT of the sublease picker until a row is
-- deliberately opted in. A default of `true` would have silently offered a
-- student the Cathedral of Learning as a place to sublet.
ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'academic',
  ADD COLUMN IF NOT EXISTS is_subleasable boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.buildings'::regclass AND conname = 'buildings_kind_check'
  ) THEN
    ALTER TABLE public.buildings
      ADD CONSTRAINT buildings_kind_check
      CHECK (kind IN ('academic', 'residence_hall', 'off_campus'));
  END IF;
END $$;

COMMENT ON COLUMN public.buildings.kind IS
  'academic | residence_hall | off_campus. Descriptive only — the picker keys on is_subleasable, so a kind is never load-bearing on its own.';
COMMENT ON COLUMN public.buildings.is_subleasable IS
  'Opt-in flag for the sublease building picker. Default false so a newly imported row is never offered until someone decides it should be. Residence halls stay false: Pitt housing contracts prohibit subletting a dorm room.';

-- The seed script upserts on (university_id, name), which needs a unique index to
-- conflict against. Without it a re-run duplicates every row it already wrote,
-- which is the exact same-building-twice failure this phase exists to remove —
-- just moved from the listings table into the registry. `university_id` is
-- non-null on all 269 rows, so no NULL-defeats-UNIQUE hole here in practice.
CREATE UNIQUE INDEX IF NOT EXISTS buildings_university_id_name_key
  ON public.buildings (university_id, name);

-- The picker's exact predicate. Small table, but it is read on every open of the
-- sublease composer and the index costs nothing.
CREATE INDEX IF NOT EXISTS idx_buildings_subleasable
  ON public.buildings (university_id, name)
  WHERE is_subleasable;

-- ── 2. A listing points at the registry ──────────────────────────────────────
-- NULLABLE deliberately. Existing sublease rows have a `building_name` string and
-- no building, and they must stay listable — they simply stay unpinnable. There is
-- no backfill here on purpose: fuzzy-matching an old free-text string onto a
-- registry row would turn a wrong guess into a wrong pin, and a wrong pin is worse
-- than no pin (see MAX_CAMPUS_DISTANCE_KM in src/lib/geocode.ts for the same
-- argument applied to the geocoder).
--
-- ON DELETE SET NULL, not CASCADE: retiring a building from the registry must not
-- delete a student's listing.
ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS building_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.marketplace_listings'::regclass
      AND conname = 'marketplace_listings_building_id_fkey'
  ) THEN
    ALTER TABLE public.marketplace_listings
      ADD CONSTRAINT marketplace_listings_building_id_fkey
      FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Phase 2 groups subleases by this column to collapse a pile of pins into one
-- pin with a count, so it is an index rather than a bare FK column.
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_building_id
  ON public.marketplace_listings (building_id)
  WHERE building_id IS NOT NULL;

-- SEC-6 fallout, and it is NOT boilerplate. Unlike public.buildings, SELECT on
-- marketplace_listings is COLUMN-scoped for `authenticated` — the contact columns
-- (phone_number, instagram_handle, snapchat_handle) plus three internal timestamps
-- are deliberately withheld and reached only through the masked view. A column
-- added by ALTER TABLE inherits nothing from that list, so `building_id` landed
-- readable by no student at all.
--
-- Found by probing, not by reading: the local end-to-end post failed with
-- `permission denied for table marketplace_listings` — a GRANT error wearing an
-- RLS error's clothes — because the insert's RETURNING clause had to read back the
-- column it had just written. Every sublease post would have failed this way.
--
-- SELECT only. INSERT/UPDATE are table-level grants here and already cover the new
-- column; widening either would be a change nobody asked for.
GRANT SELECT (building_id) ON public.marketplace_listings TO authenticated;

COMMENT ON COLUMN public.marketplace_listings.building_id IS
  'Picked registry building (public.buildings). NULL on pre-2026-09 subleases, which stay listable but unpinnable. `building_name` remains populated with the picked name because subleaseTitle() copies it into the listing title.';

-- ── 3. RLS: nothing to add, and that is the finding, not an omission ─────────
-- Verified against the live catalog 2026-08-17 rather than by reading migrations:
--   rls_buildings_select — PERMISSIVE, FOR SELECT, TO authenticated, USING (true)
--   tenant_isolation     — RESTRICTIVE, FOR ALL,    TO authenticated,
--                          USING/WITH CHECK (university_id = current_university_id()
--                                            OR is_superadmin())
-- Together: a signed-in student reads the registry, confined to their own school.
-- That is exactly what the picker needs, so adding a policy here would only be a
-- second name for a rule that already holds.
--
-- Writes: `authenticated` holds table-level INSERT/UPDATE/DELETE grants but has NO
-- permissive policy for any of them, so RLS denies all three. The registry is
-- written by service-role seeds only. Left as-is — the grants are inert without a
-- policy, and revoking them is a separate, wider change than this phase.
--
-- The new columns need no grant work: the grants on public.buildings are
-- table-level, not column-level, so `kind` and `is_subleasable` are readable by
-- `authenticated` the moment they exist.

-- ── 4. Verification — the insert/update gate still gates ─────────────────────
-- Adding a column does not rewrite a policy, but "does not" is a claim, and the
-- 08-02 rule is that a dismissal needs the same proof as a fix. This block fails
-- the migration if either half of the sublease gate stopped calling
-- can_post_sublease(), which is the only way `building_id` could have opened a
-- path around it.
DO $$
DECLARE
  v_insert text;
  v_update text;
BEGIN
  SELECT pg_get_expr(polwithcheck, polrelid) INTO v_insert
  FROM pg_policy
  WHERE polrelid = 'public.marketplace_listings'::regclass
    AND polname = 'rls_marketplace_listings_insert';

  SELECT pg_get_expr(polwithcheck, polrelid) INTO v_update
  FROM pg_policy
  WHERE polrelid = 'public.marketplace_listings'::regclass
    AND polname = 'rls_marketplace_listings_update';

  IF v_insert IS NULL OR v_insert NOT LIKE '%can_post_sublease%' THEN
    RAISE EXCEPTION
      'rls_marketplace_listings_insert no longer gates on can_post_sublease(): %',
      coalesce(v_insert, '<policy missing>');
  END IF;

  IF v_update IS NULL OR v_update NOT LIKE '%can_post_sublease%' THEN
    RAISE EXCEPTION
      'rls_marketplace_listings_update no longer gates on can_post_sublease(): %',
      coalesce(v_update, '<policy missing>');
  END IF;
END $$;
