-- Permanent break-glass superadmin for the owner's Pitt email.
--
-- WHY: The owner repeatedly deletes/recreates his own account for testing. Each
-- fresh signup lands as role='user' (the profiles default), losing full admin and
-- forcing a manual re-grant. This makes ONE hardcoded email always resolve to
-- superadmin on every fresh signup, so account resets never lose admin.
--
-- HOW (least-risk path): the grant rides the EXISTING signup function
-- handle_new_user() — a SECURITY DEFINER trigger that runs with auth.uid() IS NULL,
-- a context that protect_profile_role() explicitly permits (verified live). No new
-- trigger, no signature change. The permit branch in protect_profile_role short-
-- circuits before any role check for every signup, so this cannot recur the
-- 2026-07-09 signup-500 (that bug was an older version *raising* on auth.uid() null;
-- the hotfix turned it into a permit).
--
-- SECURITY NOTE: a hardcoded superadmin email is a small break-glass backdoor. It is
-- intentional and acceptable for the owner's own account, kept to a SINGLE email, and
-- should be removed before real external scale. Grep `c_bootstrap_superadmin` to find it.
--
-- ROLLBACK: re-CREATE OR REPLACE handle_new_user() with the prior body (identical to
-- this one minus the `role` column / v_role), and optionally reset the owner's role.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_university_id uuid;
  -- ⚠️ BOOTSTRAP SUPERADMIN — permanent owner break-glass account (see header). Single
  -- email, intentionally hardcoded; remove before external scale.
  c_bootstrap_superadmin constant text := 'founder.demo@pitt.edu';
  v_role public.app_role;
begin
  select u.id into v_university_id
  from public.universities u
  where u.is_active
    and exists (
      select 1 from unnest(u.email_domains) as d
      where lower(d) = lower(split_part(new.email, '@', 2))
    )
  limit 1;

  v_role := case
    when lower(new.email) = c_bootstrap_superadmin then 'superadmin'::public.app_role
    else 'user'::public.app_role
  end;

  insert into public.profiles (id, full_name, email, has_completed_onboarding, university_id, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    false,
    v_university_id,
    v_role
  )
  on conflict (id) do nothing;
  -- is_admin is kept in sync by the sync_is_admin_from_role BEFORE trigger; do not set it here.
  return new;
end;
$function$;

-- Immediate grant: if the owner's account already exists (as a demoted 'user' after a
-- prior reset), restore superadmin now without waiting for the next reset. Runs as the
-- migration role (session_user = postgres), which protect_profile_role permits. No-op
-- when the account is absent or already superadmin.
update public.profiles
set role = 'superadmin'::public.app_role
where id in (select id from auth.users where lower(email) = 'founder.demo@pitt.edu')
  and role is distinct from 'superadmin'::public.app_role;
