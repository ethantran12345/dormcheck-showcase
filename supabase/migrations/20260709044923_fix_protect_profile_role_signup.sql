-- HOTFIX: 20260718 protect_profile_role broke signup. handle_new_user (SECURITY
-- DEFINER, GoTrue context) inserts profiles with a non-null university_id, which
-- the INSERT guard mis-read as an escalation attempt and raised "Not authorized
-- to modify role" (auth.uid() is null in that internal context) -> every new
-- user signup 500'd. Fix: bypass the guard for internal/definer/service contexts
-- (auth.uid() IS NULL); RLS already blocks anon writes, so only genuine
-- authenticated non-superadmin users are enforced.
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
    -- Internal / definer / service contexts (signup trigger, migrations,
    -- service_role) bypass. A real end user always has a non-null auth.uid().
    if auth.uid() is null
       or session_user in ('postgres', 'supabase_admin')
       or auth.role() = 'service_role' then
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

revoke execute on function public.protect_profile_role() from public, anon, authenticated;
