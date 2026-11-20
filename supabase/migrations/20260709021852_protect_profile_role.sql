-- Block self-service role/university escalation (mirrors protect_profile_is_admin,
-- and additionally guards INSERT: rls_profiles_insert only checks id = auth.uid(),
-- so a fresh signup could otherwise insert its profile row pre-escalated).
-- Without this, a user could set their own profiles.role and the
-- sync_is_admin_from_role trigger would grant is_admin.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  role_changed boolean;
begin
  if tg_op = 'INSERT' then
    role_changed := (new.role is distinct from 'user'::public.app_role)
      or (new.university_id is not null);
  else
    role_changed := (new.role is distinct from old.role)
      or (new.university_id is distinct from old.university_id);
  end if;

  if role_changed then
    if session_user in ('postgres', 'supabase_admin')
       or auth.role() = 'service_role' then
      return new;
    end if;

    if auth.uid() is null then
      raise exception 'Not authorized to modify role';
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

revoke execute on function public.protect_profile_role() from public, anon, authenticated;

-- "a_" prefix so this fires before sync_is_admin_from_role (alphabetical trigger order).
drop trigger if exists a_protect_profile_role on public.profiles;
create trigger a_protect_profile_role
  before insert or update on public.profiles
  for each row execute function public.protect_profile_role();
