-- STAGED — DO NOT APPLY until Ethan has an enrolled MFA factor on every
-- superadmin account. This file deliberately lives OUTSIDE supabase/migrations/
-- so no reset/replay/push path ever applies it implicitly.
--
-- P1-3 (security review 2026-08-01): MFA is enforced only client-side
-- (src/components/auth/MfaChallengeGate.tsx reads AAL from the SDK). A phished
-- superadmin password yields an aal1 JWT that PostgREST and every api/admin
-- handler accept. This migration makes the DB refuse admin privileges for any
-- JWT that has not completed the MFA step-up: current_app_role() degrades every
-- admin role to 'user' unless (auth.jwt() ->> 'aal') = 'aal2', which transitively
-- hardens is_superadmin() and every policy built on either.
--
-- ROLLOUT (in this order, same sitting):
--   1. Ethan enrolls a TOTP factor on each superadmin account and confirms a
--      fresh login reaches aal2 (MfaChallengeGate passes).
--   2. Apply this file via the Supabase MCP apply_migration, then move it into
--      supabase/migrations/ with the next timestamp so local resets match prod.
--   3. Set REQUIRE_ADMIN_AAL2=1 in Vercel so api/admin/* asserts aal2 too.
-- Rollback: re-apply the 20260709015840 definition of current_app_role().

create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer
set search_path = public
as $$
  select case
    when coalesce((select role from public.profiles where id = auth.uid()), 'user'::public.app_role)
         = 'user'::public.app_role
      then 'user'::public.app_role
    -- Admin roles require the MFA step-up; an aal1 session gets no privileges.
    when coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      then (select role from public.profiles where id = auth.uid())
    else 'user'::public.app_role
  end;
$$;
