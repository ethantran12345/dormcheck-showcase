-- Make the superadmin invisible to university_admins.
--
-- WHY: The audit trail (admin_audit_log) logs every superadmin action -- including
-- the "View as" POV switches -- against the university silo being viewed. RLS policy
-- "university_admin reads scoped audit rows" scopes reads by university_id ONLY, so a
-- university_admin sees the superadmin's rows in their Activity feed (e.g. "Ethan Tran
-- switched to the university admin point of view"). The superadmin is platform
-- oversight, not a member of any school's admin team, and should be invisible to
-- university_admins everywhere they look.
--
-- SCOPE: read-only visibility change. Superadmins still see EVERYTHING via the
-- untouched "superadmin reads all audit rows" policy; nothing is un-logged. This only
-- filters what a university_admin may read. Backward-compatible, no column changes.

-- ---------------------------------------------------------------------------
-- 1) Helper: does an arbitrary actor hold the superadmin role?
--    SECURITY DEFINER because a university_admin cannot read other users' profile
--    rows (profiles has own-row-only SELECT RLS); an inline subquery in the policy
--    would therefore see nothing and never filter. Definer bypasses that safely --
--    it returns a single boolean and leaks no profile data.
-- ---------------------------------------------------------------------------
create or replace function public.actor_is_superadmin(p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = p_actor and role = 'superadmin'::public.app_role
  );
$$;

revoke execute on function public.actor_is_superadmin(uuid) from public, anon;
grant execute on function public.actor_is_superadmin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Audit feed: hide superadmin-authored rows from university_admins.
--    Superadmin "reads all" policy is left intact (superadmin still sees its own
--    trail). Recreate the university_admin policy with the added actor filter.
-- ---------------------------------------------------------------------------
drop policy if exists "university_admin reads scoped audit rows" on public.admin_audit_log;

create policy "university_admin reads scoped audit rows"
  on public.admin_audit_log for select to authenticated
  using (
    (select public.current_app_role()) = 'university_admin'::public.app_role
    and university_id is not null
    and university_id = (select public.current_university_id())
    and not public.actor_is_superadmin(actor_id)
  );

-- ---------------------------------------------------------------------------
-- 3) Admin directory / actor dropdown: hide superadmins from university_admins.
--    get_university_admins() previously returned every non-'user' profile in the
--    caller's school (which includes a superadmin whose university_id matches),
--    surfacing the superadmin on the Team page and the Activity actor filter. For a
--    non-superadmin caller, restrict to peers with role = 'university_admin'.
--    Superadmin callers are unchanged (still see all admins / the silo clamp).
--    DROP-then-CREATE (not an overload) so PostgREST resolves the single signature;
--    body copied from 20260728000000 with only the role clause added.
-- ---------------------------------------------------------------------------
drop function if exists public.get_university_admins(uuid);

create or replace function public.get_university_admins(p_university_id uuid default null)
returns table(id uuid, full_name text, email text, role public.app_role, university_id uuid, created_at timestamptz)
language sql
stable security definer
set search_path to 'public'
as $function$
  select p.id, p.full_name, p.email, p.role, p.university_id, p.created_at
  from public.profiles p
  where p.role <> 'user'::public.app_role
    and (
      public.is_superadmin()
      or (
        public.current_app_role() = 'university_admin'::public.app_role
        and p.university_id = public.current_university_id()
        -- university_admins see only fellow university_admins; superadmins are
        -- platform oversight and stay invisible to them.
        and p.role = 'university_admin'::public.app_role
      )
    )
    -- Silo clamp: only a superadmin's explicit selection narrows further; for
    -- everyone else the clause above already scopes and the param is ignored.
    and (
      not public.is_superadmin()
      or p_university_id is null
      or p.university_id = p_university_id
    );
$function$;

revoke execute on function public.get_university_admins(uuid) from public, anon;
grant execute on function public.get_university_admins(uuid) to authenticated;
