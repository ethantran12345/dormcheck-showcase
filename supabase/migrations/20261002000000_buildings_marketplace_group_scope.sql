-- A building is a PHYSICAL OBJECT, so it cannot belong to one university.
--
-- Skyvue is a mile from CMU. Carlow is across the street from Pitt. Oakland's
-- off-campus housing stock is one stock, shared by every school in it, and the
-- registry seeded by scripts/data/sublease-buildings-pitt.json is "the buildings in
-- Oakland", not "Pitt's buildings" — the `university_id` on those 40 rows records
-- who seeded them, not who may live there.
--
-- Everything else in the marketplace already understood this. `marketplace_listings`
-- has read at marketplace-group range since 20260918000000, and a sublease IS a
-- `marketplace_listings` row (`post_type = 'sublease'`), so a CMU student can already
-- SEE an Oakland sublease today. `public.buildings` is the one table that never got
-- the group arm, and that single omission produced the whole defect: a CMU student
-- can read the listing but cannot attach the building they actually live in.
--
-- This file closes that gap in the two places it is enforced — the RLS policy and the
-- consistency trigger — and nowhere else. It changes no data.
--
-- ── What is deliberately NOT widened ─────────────────────────────────────────
-- The WITH CHECK stays own-school. That is not an oversight, it is the same
-- read-wide / write-narrow split `marketplace_listings.tenant_isolation` already
-- ships: reading the group's registry is the product, writing another school's row
-- is not. `authenticated` holds table-level INSERT/UPDATE/DELETE grants on
-- `buildings` but has no permissive policy for any of them, so RLS denies all three
-- regardless; the registry is written by service-role seeds only.
--
-- Rollback:
--   ALTER POLICY tenant_isolation ON public.buildings
--     USING ((university_id = current_university_id()) OR is_superadmin())
--     WITH CHECK ((university_id = current_university_id()) OR is_superadmin());
--   -- and restore validate_listing_building_tenant() from 20260929000000.

-- ── 1. The registry reads at marketplace-group range ─────────────────────────
-- Shape copied from `marketplace_listings.tenant_isolation` rather than invented:
-- same helper, same order, same `is_superadmin()` tail. The remote-services arm is
-- omitted because it keys on `post_type`/`service_category`, which a building has
-- no equivalent of.
--
-- `shares_marketplace(p)` already contains `p = current_university_id()` as its
-- first arm, so the leading own-school test is redundant by construction. It is kept
-- anyway, because the value of this policy being a literal copy of the listings one
-- is higher than the value of it being one clause shorter — the next person to widen
-- one of these must be able to diff them by eye.
--
-- ISOLATION STILL HOLDS FOR A GROUPLESS SCHOOL, and this is the property the test
-- exists to pin: `shares_marketplace()` requires the OTHER university's
-- `marketplace_group IS NOT NULL` **and** equal to `current_marketplace_group()`. A
-- viewer whose own school has no group gets NULL from `current_marketplace_group()`,
-- and `them.marketplace_group = NULL` is never true — so a groupless school sees
-- exactly its own rows, as before.
ALTER POLICY tenant_isolation ON public.buildings
  USING (
    (university_id = public.current_university_id())
    OR public.shares_marketplace(university_id)
    OR public.is_superadmin()
  )
  WITH CHECK (
    (university_id = public.current_university_id())
    OR public.is_superadmin()
  );

-- ── 2. The consistency trigger asks the right question ───────────────────────
-- 20260929000000 asserted `building.university_id = listing.university_id`. That rule
-- was wrong the day it was written: it forbids exactly the case the product needs —
-- a CMU student subletting a room in an Oakland building whose registry row was
-- seeded under Pitt. The guard itself is still wanted; only its predicate changes.
--
-- WHY THIS DOES NOT CALL shares_marketplace(), which is the trap here.
-- That helper resolves the viewer against `current_university_id()` — the SESSION's
-- school. A trigger must compare the LISTING's school to the BUILDING's school and
-- get the same answer no matter who issued the write: the student, an admin, a
-- service-role backfill (which has no `current_university_id()` at all), or a future
-- migration. Using the session helper here would make a data invariant depend on who
-- happened to be connected, which is how a backfill silently writes rows the
-- invariant forbids. So the group comparison is spelled out against
-- `public.universities` directly.
--
-- Unchanged on purpose, all four load-bearing:
--   * the `building_id IS NULL` early return — pre-registry rows and the typed
--     free-text fallback both live there, and both must stay postable;
--   * the `NOT FOUND` early return — the FK is an AFTER-row constraint trigger and
--     has not run yet, so a nonexistent building must fall through and raise its own
--     23503 rather than be reported as a tenant mismatch;
--   * `IS DISTINCT FROM` null semantics — a null on either side is a mismatch to be
--     rejected, never an unknown to be waved through;
--   * ERRCODE 23514. A 23503 here would mean the SECURITY DEFINER lookup came back
--     empty, i.e. the guard was blinded rather than satisfied.
CREATE OR REPLACE FUNCTION public.validate_listing_building_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_building_university uuid;
  v_building_group      text;
  v_listing_group       text;
BEGIN
  IF NEW.building_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT b.university_id INTO v_building_university
  FROM public.buildings b
  WHERE b.id = NEW.building_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Same school: always fine, and the common case, so it short-circuits before any
  -- further lookup.
  IF v_building_university IS NOT DISTINCT FROM NEW.university_id THEN
    RETURN NEW;
  END IF;

  SELECT u.marketplace_group INTO v_building_group
  FROM public.universities u WHERE u.id = v_building_university;

  SELECT u.marketplace_group INTO v_listing_group
  FROM public.universities u WHERE u.id = NEW.university_id;

  -- Different schools are allowed only inside one shared, NON-NULL marketplace
  -- group. Two schools that both have no group are not "in the same group" — NULL is
  -- the absence of a group, not a group whose name is nothing, which is why this is
  -- an explicit NOT NULL pair and not a bare `IS NOT DISTINCT FROM`.
  IF v_building_group IS NULL
     OR v_listing_group IS NULL
     OR v_building_group <> v_listing_group THEN
    RAISE EXCEPTION
      'building % belongs to university % (marketplace group %), but the listing belongs to university % (marketplace group %)',
      NEW.building_id,
      coalesce(v_building_university::text, '<null>'),
      coalesce(v_building_group, '<none>'),
      coalesce(NEW.university_id::text, '<null>'),
      coalesce(v_listing_group, '<none>')
      USING
        ERRCODE = '23514',
        HINT = 'A listing may reference a building at its own school, or at any '
               'school sharing its marketplace group. A building at a school '
               'outside that group, or at a school with no group at all, is not '
               'reachable from this listing.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.validate_listing_building_tenant() IS
  'BEFORE INSERT OR UPDATE on marketplace_listings: a non-null building_id must reference a building at the listing''s own university, or at a university sharing a non-null marketplace_group with it. Compares the LISTING to the BUILDING directly rather than via shares_marketplace(), so the invariant does not depend on the session. SECURITY DEFINER so the lookup is not blinded by buildings.tenant_isolation. Raises SQLSTATE 23514.';

REVOKE EXECUTE ON FUNCTION public.validate_listing_building_tenant() FROM public, anon, authenticated;

-- ── 3. Verification ──────────────────────────────────────────────────────────
-- The policy half. Asserted against the catalog rather than assumed from a
-- successful ALTER, because ALTER POLICY on a policy that does not exist is the one
-- failure mode that would otherwise pass silently — it errors, but a future
-- refactor that renames the policy would not.
DO $$
DECLARE
  v_using text;
  v_check text;
BEGIN
  SELECT pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
    INTO v_using, v_check
  FROM pg_policy
  WHERE polrelid = 'public.buildings'::regclass AND polname = 'tenant_isolation';

  IF v_using IS NULL THEN
    RAISE EXCEPTION 'buildings.tenant_isolation is missing';
  END IF;
  IF v_using NOT LIKE '%shares_marketplace%' THEN
    RAISE EXCEPTION
      'buildings.tenant_isolation did not gain the marketplace-group arm: %', v_using;
  END IF;
  -- Read widened, write NOT widened. If this ever inverts, a student could write a
  -- registry row into another school.
  IF v_check LIKE '%shares_marketplace%' THEN
    RAISE EXCEPTION
      'buildings.tenant_isolation WITH CHECK must stay own-school; got: %', v_check;
  END IF;
END $$;

-- The trigger half: still installed, still BEFORE INSERT OR UPDATE, still sorting
-- after trg_set_university_id (which derives a null university_id — if this trigger
-- ran first it would compare a NULL listing school against a real building and
-- reject legitimate posts).
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
      'expected both trg_set_university_id and trg_validate_listing_building_tenant as BEFORE INSERT triggers (found positions %, %)',
      pos_set, pos_validate;
  END IF;
  IF pos_set > pos_validate THEN
    RAISE EXCEPTION
      'trg_validate_listing_building_tenant fires before trg_set_university_id (positions %, %)',
      pos_validate, pos_set;
  END IF;
END $$;

-- No existing row may violate the NEW, wider rule. It is wider than the old one, so
-- this cannot fail on data that passed before — it is here to catch a row written
-- while the guard was absent.
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
  FROM public.marketplace_listings l
  JOIN public.buildings b ON b.id = l.building_id
  LEFT JOIN public.universities bu ON bu.id = b.university_id
  LEFT JOIN public.universities lu ON lu.id = l.university_id
  WHERE l.building_id IS NOT NULL
    AND b.university_id IS DISTINCT FROM l.university_id
    AND (bu.marketplace_group IS NULL
         OR lu.marketplace_group IS NULL
         OR bu.marketplace_group <> lu.marketplace_group);

  IF n > 0 THEN
    RAISE EXCEPTION
      '% existing marketplace_listings row(s) point at a building outside their marketplace group; fix the data before installing the widened trigger', n;
  END IF;
END $$;
