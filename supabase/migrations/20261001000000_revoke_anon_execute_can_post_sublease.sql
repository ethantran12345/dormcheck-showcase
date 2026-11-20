-- can_post_sublease() was reachable by `anon`. Close it, forward-only.
--
-- 20260907000000 created the function and then wrote:
--
--   REVOKE EXECUTE ON FUNCTION public.can_post_sublease(uuid) FROM public;
--
-- which revokes the PUBLIC pseudo-role and nothing else. On a Supabase project
-- that is not where the grant comes from: `ALTER DEFAULT PRIVILEGES` grants
-- EXECUTE to anon, authenticated and service_role EXPLICITLY at creation time, so
-- the ACL landed as
--
--   {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
--
-- and the REVOKE removed a grant that was never the one holding the door open.
--
-- WHY IT MATTERS. The function is SECURITY DEFINER over `auth.users` — it reads
-- email, email_confirmed_at and the tenant's domain list. With EXECUTE, an
-- unauthenticated PostgREST caller could POST /rest/v1/rpc/can_post_sublease with
-- any uuid and read back a boolean about that account. Confirmed live on
-- production 2026-08-17 by `SET LOCAL ROLE anon` before it was closed there.
--
-- WHY THIS FILE EXISTS AT ALL, given prod is already fixed. Production was
-- repaired in place during the Phase 1 rollout, but a repaired database is not a
-- repaired repo: `supabase db reset` replays 20260907000000 verbatim and reopens
-- the hole on every local stack, every CI replay, and any future environment.
-- 20260907000000 is applied and is therefore NOT edited (see
-- .claude/rules/supabase-backend.md on in-place edits); this is the forward fix.
--
-- `authenticated` KEEPS EXECUTE deliberately. rls_marketplace_listings_insert and
-- rls_marketplace_listings_update call this function as the invoker, so revoking
-- it there would deny every marketplace write, not just sublease writes.
--
-- Idempotent: REVOKE on a privilege that is already absent is a no-op.
REVOKE EXECUTE ON FUNCTION public.can_post_sublease(uuid) FROM anon;

-- The assertion is the point of the file, not decoration. A REVOKE that silently
-- did nothing looks identical to one that worked.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.can_post_sublease(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'anon still holds EXECUTE on public.can_post_sublease(uuid) after the REVOKE';
  END IF;

  -- The other half: the policies that call it must still be able to.
  IF NOT has_function_privilege('authenticated', 'public.can_post_sublease(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'authenticated lost EXECUTE on public.can_post_sublease(uuid); the marketplace '
      'INSERT/UPDATE policies call it as the invoker and every write would now fail';
  END IF;
END $$;
