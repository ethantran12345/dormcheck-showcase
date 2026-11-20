-- Shared marketplace across co-located universities ("the Pittsburgh group").
--
-- WHY: Pitt, CMU and Carlow sit within about a mile of each other in Oakland.
-- Confining the marketplace to one tenant means three thin feeds instead of one
-- liquid one, and a sublease a block away is invisible to the student who needs
-- it. This migration opens marketplace READS across a declared group of schools
-- while leaving every other surface (checklist, housing, dorm content, roommates,
-- rankings, community chats) tenant-isolated exactly as before.
--
-- THE INVARIANT, stated once: you may SEE any listing from a school in your
-- group; you may only WRITE a listing into YOUR OWN school. Every policy below
-- keeps `WITH CHECK` pinned to current_university_id() for that reason — a
-- widened USING clause must never widen the write side with it.
--
-- Membership is DATA, not code: a fourth school joins by setting one column, no
-- migration and no deploy. NULL group = isolated, which is the safe default a
-- newly seeded university gets for free.
--
-- Rollback (restores exact pre-migration behaviour):
--   SELECT public.apply_tenant_isolation('public.marketplace_listings');
--   DROP POLICY IF EXISTS tenant_isolation ON public.seller_ratings;
--   CREATE POLICY tenant_isolation ON public.seller_ratings AS RESTRICTIVE FOR ALL TO authenticated
--     USING (public.profile_university(seller_id) = public.current_university_id() OR public.is_superadmin());
--   DROP POLICY IF EXISTS tenant_confined ON public.conversations;
--   CREATE POLICY tenant_confined ON public.conversations AS RESTRICTIVE FOR INSERT TO authenticated
--     WITH CHECK (public.profile_university(participant_1) = public.profile_university(participant_2));
--   DROP POLICY IF EXISTS rls_profiles_public_select ON public.profiles_public;
--   CREATE POLICY rls_profiles_public_select ON public.profiles_public FOR SELECT TO authenticated
--     USING (id = (SELECT auth.uid()) OR NOT (university_id IS DISTINCT FROM (SELECT public.current_university_id())) OR public.is_superadmin());
--   ALTER TABLE public.universities DROP COLUMN marketplace_group;
--   DROP FUNCTION public.shares_marketplace(uuid), public.current_marketplace_group();

-- ---------------------------------------------------------------------------
-- 1. Group membership
-- ---------------------------------------------------------------------------

ALTER TABLE public.universities
  ADD COLUMN IF NOT EXISTS marketplace_group text;

COMMENT ON COLUMN public.universities.marketplace_group IS
  'Opt-in marketplace sharing group (e.g. ''pittsburgh''). Schools sharing a '
  'non-NULL value see each other''s marketplace listings and may open DMs with '
  'each other. NULL = fully isolated, the safe default for a new tenant. '
  'Posting is always confined to the author''s own university.';

UPDATE public.universities
   SET marketplace_group = 'pittsburgh'
 WHERE slug IN ('pitt', 'cmu')
   AND marketplace_group IS DISTINCT FROM 'pittsburgh';

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER + pinned search_path, matching current_university_id() /
-- profile_university(): the caller must not be able to read `universities`
-- directly to answer this, and must not be able to shadow the catalog lookup.
CREATE OR REPLACE FUNCTION public.current_marketplace_group()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT u.marketplace_group
    FROM public.universities u
   WHERE u.id = public.current_university_id()
$$;

COMMENT ON FUNCTION public.current_marketplace_group() IS
  'Marketplace sharing group of the calling user''s university, or NULL when '
  'that school shares with nobody.';

-- True when p_university_id is reachable from the caller for MARKETPLACE READS:
-- their own school always, plus any school in the same non-NULL group.
-- The `IS NOT NULL` guard is load-bearing: without it two ungrouped schools
-- would both read NULL = NULL and, under `IS NOT DISTINCT FROM`, match.
CREATE OR REPLACE FUNCTION public.shares_marketplace(p_university_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT p_university_id = public.current_university_id()
      OR EXISTS (
           SELECT 1
             FROM public.universities them
            WHERE them.id = p_university_id
              AND them.marketplace_group IS NOT NULL
              AND them.marketplace_group = public.current_marketplace_group()
         )
$$;

COMMENT ON FUNCTION public.shares_marketplace(uuid) IS
  'READ-side predicate for the shared marketplace: true for the caller''s own '
  'university, or any university in the same non-NULL marketplace_group. Never '
  'use this in a WITH CHECK clause — posting stays confined to the author''s '
  'own university (see 20260918000000_shared_marketplace_group.sql).';

REVOKE EXECUTE ON FUNCTION public.current_marketplace_group() FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.shares_marketplace(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.current_marketplace_group() TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_marketplace(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Listings — read across the group, write to your own school only
-- ---------------------------------------------------------------------------
-- NOT via apply_tenant_isolation(): that helper hardcodes the symmetric
-- class-A shape. This table is deliberately asymmetric now, so it owns its
-- policy. table-classification.json records it as class A-shared.

-- The first disjunct is redundant against shares_marketplace(), which already
-- returns true for the caller's own university. It is spelled out anyway, for
-- two reasons: it states the base case first so the policy reads as
-- "your school, plus your group", and supabase/tests/tenant_registry.test.sql
-- asserts every class-A qual literally names current_university_id(). Keeping
-- the table class A — rather than inventing a class the registry does not know —
-- means the whole tenant audit keeps covering it.
DROP POLICY IF EXISTS tenant_isolation ON public.marketplace_listings;
CREATE POLICY tenant_isolation ON public.marketplace_listings
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    university_id = public.current_university_id()
    OR public.shares_marketplace(university_id)
    OR public.is_superadmin()
  )
  WITH CHECK (university_id = public.current_university_id() OR public.is_superadmin());

-- marketplace_listing_items and listing_verifications are class B: their
-- RESTRICTIVE policies are EXISTS(...) against marketplace_listings and so
-- follow this change automatically. Deliberately untouched.

-- ---------------------------------------------------------------------------
-- 4. Seller ratings — a cross-school buyer must be able to judge a seller
-- ---------------------------------------------------------------------------
-- Read widens with the group; INSERT stays governed by the existing permissive
-- policies (rater must have transacted), which this does not touch.

DROP POLICY IF EXISTS tenant_isolation ON public.seller_ratings;
CREATE POLICY tenant_isolation ON public.seller_ratings
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.shares_marketplace(public.profile_university(seller_id)) OR public.is_superadmin());

-- ---------------------------------------------------------------------------
-- 5. Public profile rows — otherwise every cross-school seller renders unnamed
-- ---------------------------------------------------------------------------
-- profiles_public carries only id / full_name / avatar_url / university_id.
-- Without this the shared feed shows real listings from faceless sellers, which
-- is both worse UX and worse safety than showing who you are dealing with.

DROP POLICY IF EXISTS rls_profiles_public_select ON public.profiles_public;
CREATE POLICY rls_profiles_public_select ON public.profiles_public
  FOR SELECT TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR NOT (university_id IS DISTINCT FROM (SELECT public.current_university_id()))
    OR public.shares_marketplace(university_id)
    OR public.is_superadmin()
  );

-- ---------------------------------------------------------------------------
-- 6. Conversations — a visible listing you cannot ask about is not a listing
-- ---------------------------------------------------------------------------
-- This is the one that actually makes the feature usable. Consent is NOT
-- weakened: conversations.status + initiated_by and the separate
-- rls_conversations_insert_privacy_gate still run, so a cross-school DM is a
-- REQUEST the recipient must accept, exactly like a same-school one. All this
-- changes is that the request can now be created at all.

DROP POLICY IF EXISTS tenant_confined ON public.conversations;
CREATE POLICY tenant_confined ON public.conversations
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.profile_university(participant_1) = public.profile_university(participant_2)
    OR (
      public.shares_marketplace(public.profile_university(participant_1))
      AND public.shares_marketplace(public.profile_university(participant_2))
    )
  );

COMMENT ON POLICY tenant_confined ON public.conversations IS
  'A DM stays within one university, OR crosses schools that share a '
  'marketplace_group. The request/accept flow (status, initiated_by) is the '
  'consent gate in both cases.';
