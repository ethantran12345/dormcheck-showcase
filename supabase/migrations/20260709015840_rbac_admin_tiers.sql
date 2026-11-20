-- Phase 3 RBAC foundation: tiered roles replacing binary is_admin (expand phase; is_admin kept in sync).
create type public.app_role as enum ('user', 'university_admin', 'superadmin');

alter table public.profiles
  add column role public.app_role not null default 'user';

-- university_id already exists (uuid, nullable); add FK if missing
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_university_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_university_id_fkey
      foreign key (university_id) references public.universities(id);
  end if;
end $$;

update public.profiles set role = 'superadmin' where is_admin = true;

-- SECURITY DEFINER helpers (bypass profiles RLS; avoid recursive policies)
create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer
set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'user'::public.app_role);
$$;

create or replace function public.is_superadmin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.current_app_role() = 'superadmin'::public.app_role;
$$;

create or replace function public.current_university_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select university_id from public.profiles where id = auth.uid();
$$;

-- PUBLIC gets EXECUTE by default on new functions; strip it, then grant authenticated only.
revoke execute on function public.current_app_role(), public.is_superadmin(), public.current_university_id() from public, anon;
grant execute on function public.current_app_role(), public.is_superadmin(), public.current_university_id() to authenticated;

-- Keep legacy is_admin derivable during transition (~12 client call sites + existing RLS read it)
create or replace function public.sync_is_admin_from_role()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  new.is_admin := (new.role <> 'user'::public.app_role);
  return new;
end;
$$;

revoke execute on function public.sync_is_admin_from_role() from public, anon, authenticated;

create trigger sync_is_admin_from_role
  before insert or update of role on public.profiles
  for each row execute function public.sync_is_admin_from_role();
