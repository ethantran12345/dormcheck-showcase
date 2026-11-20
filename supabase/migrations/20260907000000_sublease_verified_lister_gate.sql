-- Subleases return behind a VERIFIED LISTER gate (vault `08 - Decisions Log`, 2026-08-05).
--
-- The decision is deliberately "verified lister", not "verified listing": we do not
-- have a way to verify that a particular room exists, and pretending otherwise would
-- be the fabricated-evidence failure the design rules ban. What we CAN verify is the
-- person — a confirmed university email plus a housing record on their own profile.
-- That is the whole gate, and it applies to WRITES only. Browsing stays open to any
-- signed-in student: a scam is found by being seen, so narrowing the audience of a
-- sublease post makes it more dangerous, not less.
--
-- Why RLS and not the client: the create page can be bypassed with one fetch call
-- against PostgREST. The picker disabling a chip is UX; this file is the gate.
--
-- Untouched on purpose:
--   * marketplace_listings_user_one_active_sublease — one active sublease per user
--     is still the anti-spam bound, and this gate is orthogonal to it.
--   * public.marketplace_public — its `is_sublease = false` predicate is the reason
--     a signed-out visitor sees zero subleases. Guest browsing exists for App Store
--     5.1.1(v) and item listings already satisfy it.

-- ── 1. The gate itself ───────────────────────────────────────────────────────
-- SECURITY DEFINER because it reads auth.users (email + confirmation), which no
-- student role may read directly. STABLE, and every branch is keyed on the passed
-- uid, so it leaks nothing about anyone else: a caller can only ever learn a
-- boolean about a user id it already supplied, and the policies below only ever
-- supply auth.uid().
CREATE OR REPLACE FUNCTION public.can_post_sublease(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
    WHERE u.id = p_user
      -- Confirmed, not merely claimed: an unconfirmed address is an assertion.
      AND u.email_confirmed_at IS NOT NULL
      -- ...and confirmed at a domain a live tenant actually owns. Mirrors
      -- validate_university_email()'s domain test; deliberately WITHOUT its
      -- advertiser-invitation exception, which admits non-university addresses.
      AND EXISTS (
        SELECT 1
        FROM public.universities un
        WHERE un.is_active
          AND EXISTS (
            SELECT 1 FROM unnest(un.email_domains) AS d
            WHERE lower(d) = lower(split_part(u.email, '@', 2))
          )
      )
      -- A housing record of their own. Someone subletting a room is, by
      -- definition, someone who lives in one.
      AND coalesce(btrim(p.current_dorm), '') <> ''
  );
$$;

COMMENT ON FUNCTION public.can_post_sublease(uuid) IS
  'Verified-lister gate for sublease posts: confirmed email at an active tenant domain + a non-empty profiles.current_dorm. Enforced by rls_marketplace_listings_insert/update.';

REVOKE EXECUTE ON FUNCTION public.can_post_sublease(uuid) FROM public;
-- authenticated needs EXECUTE because the policies below call it as the invoker.
GRANT EXECUTE ON FUNCTION public.can_post_sublease(uuid) TO authenticated;

-- ── 2. INSERT ────────────────────────────────────────────────────────────────
-- Same ownership check as before (20260101 baseline), plus: a row that claims
-- is_sublease must come from a verified lister. Items are completely unaffected —
-- coalesce(is_sublease, false) = false short-circuits before the function runs.
DROP POLICY IF EXISTS rls_marketplace_listings_insert ON public.marketplace_listings;

CREATE POLICY rls_marketplace_listings_insert
  ON public.marketplace_listings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (
      coalesce(is_sublease, false) = false
      OR public.can_post_sublease((SELECT auth.uid()))
    )
  );

-- ── 3. UPDATE ────────────────────────────────────────────────────────────────
-- Without this the insert gate is theatre: post an item, then flip is_sublease.
-- Rebuilt from 20260709044443 (admin status moderation) with the same gate added
-- to the owner branch only — an admin moderating a listing is not the lister.
DROP POLICY IF EXISTS rls_marketplace_listings_update ON public.marketplace_listings;

CREATE POLICY rls_marketplace_listings_update
  ON public.marketplace_listings
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin = true
    )
  )
  WITH CHECK (
    (
      (SELECT auth.uid()) = user_id
      AND (
        coalesce(is_sublease, false) = false
        OR public.can_post_sublease((SELECT auth.uid()))
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin = true
    )
  );
