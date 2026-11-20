-- A listing and the building it points at must belong to the SAME school.
--
-- 20260928000000 gave `marketplace_listings` a `building_id`, and the picker
-- (BuildingCombobox → useSubleaseBuildings) only ever offers rows scoped to the
-- listing's own `university_id`. Nothing in the DATABASE says so. One fetch call
-- against PostgREST with a hand-written `building_id` attaches a CMU building to
-- a Pitt listing, and no constraint objects.
--
-- Today that row is merely wrong. Phase 2 turns it into a PIN — a marker dropped
-- in the wrong city, asserted with the full confidence of a map. Same argument as
-- MAX_CAMPUS_DISTANCE_KM in src/lib/geocode.ts: a bad coordinate is worse than no
-- coordinate, because a pin is believed.
--
-- ── Why a trigger and not a restrictive RLS policy pair ──────────────────────
-- RLS answers "WHO may see or write this row." This is "IS this row internally
-- consistent," which is a constraint, and it holds for every writer including the
-- service role and any future admin path — not just for `authenticated`. A CHECK
-- constraint is the natural shape but cannot reach another table, so a trigger is
-- the only remaining tool. It is also less code than a policy pair, and equally
-- unbypassable from PostgREST: a BEFORE trigger runs on the real INSERT, whatever
-- role issued it.
--
-- ── Why SECURITY DEFINER ─────────────────────────────────────────────────────
-- NOT for privilege — for VISIBILITY, and this is the whole reason the check
-- works. `public.buildings` carries a RESTRICTIVE `tenant_isolation` policy
-- (university_id = current_university_id() OR is_superadmin()). Under invoker
-- rights the lookup below, run inside a Pitt student's session, would return ZERO
-- ROWS for a CMU building — the exact row the check exists to catch — and the
-- function would conclude "no such building" and wave it through. The definer
-- (`postgres`, rolbypassrls = true, verified against pg_roles 2026-08-17) sees the
-- registry whole, which is what makes a cross-tenant mismatch observable at all.
--
-- search_path is pinned per the convention in
-- 20260907000000_sublease_verified_lister_gate.sql. The function reads exactly one
-- table and takes its inputs from NEW, so it leaks nothing: a caller can only ever
-- learn that a building id it already supplied belongs to a different school.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_validate_listing_building_tenant ON public.marketplace_listings;
--   DROP FUNCTION IF EXISTS public.validate_listing_building_tenant();

-- ── 1. The check ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.validate_listing_building_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_building_university uuid;
BEGIN
  -- A null building stays legal, and must: every sublease posted before
  -- 20260928000000 has one, and those rows stay listable (just unpinnable).
  -- Items never carry a building at all.
  IF NEW.building_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT b.university_id INTO v_building_university
  FROM public.buildings b
  WHERE b.id = NEW.building_id;

  -- No such building. `marketplace_listings_building_id_fkey` is an AFTER-row
  -- constraint trigger, so it has NOT run yet — hand the row on and let the FK
  -- raise its own 23503 rather than reporting a tenant mismatch against a
  -- building that does not exist.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- IS DISTINCT FROM, not <>: `university_id` is nullable on BOTH tables, and a
  -- null on either side is a mismatch, not an unknown to be waved through. On the
  -- listing side a null cannot legitimately reach here anyway — trg_set_university_id
  -- derives it or raises, and § 2 below proves that trigger fires first.
  IF v_building_university IS DISTINCT FROM NEW.university_id THEN
    RAISE EXCEPTION
      'building % belongs to university %, but the listing belongs to university %',
      NEW.building_id,
      coalesce(v_building_university::text, '<null>'),
      coalesce(NEW.university_id::text, '<null>')
      USING
        ERRCODE = '23514',
        HINT = 'A listing may only reference a building at its own school. '
               'The sublease picker is already scoped this way; this is the '
               'same rule for callers that bypass it.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.validate_listing_building_tenant() IS
  'BEFORE INSERT OR UPDATE on marketplace_listings: a non-null building_id must reference a building at the listing''s own university_id. SECURITY DEFINER so the lookup is not blinded by buildings.tenant_isolation. Raises SQLSTATE 23514.';

-- Never callable by hand — a trigger function has no meaning outside its trigger,
-- and it is SECURITY DEFINER.
REVOKE EXECUTE ON FUNCTION public.validate_listing_building_tenant() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validate_listing_building_tenant ON public.marketplace_listings;
CREATE TRIGGER trg_validate_listing_building_tenant
  -- Unqualified INSERT OR UPDATE rather than `UPDATE OF building_id, university_id`.
  -- A column list fires on the SET clause's column NAMES, so it is only sound while
  -- no other BEFORE UPDATE trigger writes either column — a premise about seven
  -- sibling triggers that no one will re-check when the eighth lands. The early
  -- `building_id IS NULL` return makes this free for every item and every legacy
  -- sublease, and one indexed lookup for the rest.
  BEFORE INSERT OR UPDATE ON public.marketplace_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_listing_building_tenant();

-- ── 2. Verification: firing ORDER is load-bearing, so it is checked ──────────
-- Postgres fires same-timing row triggers in tgname order under the database's
-- collation. `trg_set_university_id` (20260710055451) DERIVES a null
-- university_id from the inserting profile in its own BEFORE INSERT trigger. If
-- this file's trigger sorted FIRST, it would read NEW.university_id = NULL on
-- every insert that omits the column, compare it against a real building, and
-- reject a perfectly legitimate post.
--
-- 'trg_set…' < 'trg_validate…' under en_US.UTF-8 — but that is a property of the
-- collation, not a guarantee, and renaming either trigger would break it
-- silently. So the ordering is asserted here rather than assumed.
DO $$
DECLARE
  pos_set      int;
  pos_validate int;
BEGIN
  WITH ordered AS (
    SELECT tgname, row_number() OVER (ORDER BY tgname) AS p
    FROM pg_trigger
    WHERE tgrelid = 'public.marketplace_listings'::regclass
      AND NOT tgisinternal
      AND (tgtype::int & 2) > 0   -- BEFORE
      AND (tgtype::int & 4) > 0   -- INSERT
  )
  SELECT
    max(p) FILTER (WHERE tgname = 'trg_set_university_id'),
    max(p) FILTER (WHERE tgname = 'trg_validate_listing_building_tenant')
  INTO pos_set, pos_validate
  FROM ordered;

  IF pos_set IS NULL OR pos_validate IS NULL THEN
    RAISE EXCEPTION
      'expected both trg_set_university_id and trg_validate_listing_building_tenant as BEFORE INSERT triggers on marketplace_listings (found positions %, %)',
      pos_set, pos_validate;
  END IF;

  IF pos_set > pos_validate THEN
    RAISE EXCEPTION
      'trg_validate_listing_building_tenant fires BEFORE trg_set_university_id (positions %, %); it would read a null university_id and reject legitimate inserts',
      pos_validate, pos_set;
  END IF;
END $$;

-- ── 3. Verification: the existing table is already consistent ───────────────
-- The trigger only guards writes from here on. If a mismatched row is already
-- present, this migration would leave it in place while claiming the invariant
-- holds — the "a log is not a state description" failure. Fail instead.
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
  FROM public.marketplace_listings l
  JOIN public.buildings b ON b.id = l.building_id
  WHERE l.building_id IS NOT NULL
    AND b.university_id IS DISTINCT FROM l.university_id;

  IF n > 0 THEN
    RAISE EXCEPTION
      '% existing marketplace_listings row(s) already point at a building at another school; fix the data before installing the trigger', n;
  END IF;
END $$;
