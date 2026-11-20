-- Harden public.has_completed_service_between(uuid, uuid) — add the caller-identity
-- check it never had.
--
-- FOUND BY: the release migration gate on 2026-08-07. Step 4 surfaced this function
-- as a NEW `authenticated_security_definer_function_executable` advisor finding, and
-- reading it to write a baseline reason is what exposed the actual defect. The gate
-- did its job: the finding was bookkeeping, the bug behind it was not.
--
-- THE DEFECT (plain English): every other SECURITY DEFINER function in this schema
-- derives WHO IS ASKING from auth.uid(). This one took both user IDs as ARGUMENTS
-- and never checked that the caller was either of them. Because SECURITY DEFINER
-- bypasses RLS on marketplace_listings, any authenticated user could call
--
--   select public.has_completed_service_between('<any-user>', '<any-other-user>');
--
-- and learn whether those two strangers had completed a service job together. That
-- is a relationship oracle over arbitrary pairs — low severity (one boolean, no rows,
-- no PII returned) but it is real information disclosure across the tenant boundary,
-- and it is not the pattern the rest of the codebase follows.
--
-- WHY THIS IS SAFE FOR THE ONE LIVE CALLER: the only reference anywhere in the repo
-- is the WITH CHECK of rls_seller_ratings_insert (20260910000000), which already
-- requires `(SELECT auth.uid()) = rater_id` and then calls this function as
-- (rater_id, seller_id). So u1 IS the caller on every real invocation and the new
-- predicate is satisfied by construction. Nothing in src/ or api/ calls it directly.
--
-- WHY THE GRANT STAYS (and the advisor finding with it): per FACT 2 of
-- 20260912000000, an RLS policy expression enforces EXECUTE as the QUERYING role.
-- Revoking `authenticated` here would fail rls_seller_ratings_insert outright with
-- 42501 and take seller ratings offline for every signed-in student. The grant is
-- load-bearing. This migration makes the function self-authorizing so the standard
-- "enforces its own authorization internally" baseline reason is actually TRUE of it
-- — rather than baselining a claim that was not.
--
-- SHAPE: CREATE OR REPLACE of the body only. No signature change, no grant change,
-- no policy change, so nothing downstream needs to move in lockstep.

CREATE OR REPLACE FUNCTION public.has_completed_service_between(u1 uuid, u2 uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.marketplace_listings l
    WHERE l.status = 'completed'
      AND l.post_type IN ('request_help', 'offer_help')
      AND ((l.user_id = u1 AND l.claimed_by = u2)
        OR (l.user_id = u2 AND l.claimed_by = u1))
  )
  -- The caller must be one of the two parties. Restated here because SECURITY
  -- DEFINER bypasses RLS on marketplace_listings, so this is the only place the
  -- tenant boundary can be enforced for a direct RPC call.
  AND (SELECT auth.uid()) IN (u1, u2);
$$;

COMMENT ON FUNCTION public.has_completed_service_between(uuid, uuid) IS
  'True when u1 and u2 completed a service post together. Caller must be u1 or u2 — SECURITY DEFINER bypasses RLS, so identity is checked in-body. Sole caller: rls_seller_ratings_insert WITH CHECK.';
