-- P2 foundations: scope-constrained admin roles, groundwork only.
-- profiles.admin_scopes = NULL means "all scopes" so every existing admin
-- keeps full access; a non-NULL array narrows a university_admin to the
-- listed capability areas (e.g. '{broadcasts,listings}'). Superadmins always
-- pass regardless of the column.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS admin_scopes text[];

COMMENT ON COLUMN public.profiles.admin_scopes IS
  'Capability scopes for university_admin accounts. NULL = all scopes (default, matches pre-scope behavior). Superadmins ignore this column.';

-- profiles carries a table-level GRANT ALL to authenticated (baseline), so
-- without a guard a scoped admin could widen their own admin_scopes via a
-- self-row UPDATE. Fold the column into the existing role-guard trigger
-- (protect_profile_role, 20260721000000): scope changes get the exact same
-- rails as role changes.
CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
declare
  role_changed boolean;
begin
  if tg_op = 'INSERT' then
    role_changed := (new.role is distinct from 'user'::public.app_role)
      or (new.university_id is not null)
      or (new.admin_scopes is not null);
  else
    role_changed := (new.role is distinct from old.role)
      or (new.university_id is distinct from old.university_id)
      or (new.admin_scopes is distinct from old.admin_scopes);
  end if;

  if role_changed then
    -- Internal / definer / service contexts (signup trigger, migrations,
    -- service_role) bypass. A real end user always has a non-null auth.uid().
    if auth.uid() is null
       or session_user in ('postgres', 'supabase_admin')
       or auth.role() = 'service_role'
       -- Authorized definer RPCs (claim_pending_admin_invites, set_admin_role)
       -- set this transaction-local flag after validating their own rails.
       or coalesce(current_setting('dormcheck.role_change_authorized', true), '') = 'on' then
      return new;
    end if;

    if auth.uid() = new.id then
      raise exception 'Cannot modify your own role';
    end if;

    if not public.is_superadmin() then
      raise exception 'Only superadmins may modify roles';
    end if;
  end if;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.has_admin_scope(p_scope text)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role <> 'user'::public.app_role
      AND (
        p.role = 'superadmin'::public.app_role
        OR p.admin_scopes IS NULL
        OR p_scope = ANY (p.admin_scopes)
      )
  );
$$;

COMMENT ON FUNCTION public.has_admin_scope(text) IS
  'True when the caller is a superadmin, or an admin whose admin_scopes is NULL (all scopes) or contains the given scope. Use inside policies/RPCs for scoped delegation.';

REVOKE EXECUTE ON FUNCTION public.has_admin_scope(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_admin_scope(text) TO authenticated;
