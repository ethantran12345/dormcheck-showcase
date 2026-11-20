-- Option B (revised): projection tables for cross-user profile reads.
-- `profiles` stays own-row-only and completely untouched (no column, RLS,
-- trigger, or function changes). These two read models carry only what
-- cross-user reads need; each table's RLS expresses exactly one visibility
-- rule, which is what lets 20260820010000 rebase public_profiles /
-- roommate_profiles as security_invoker views and clear the two
-- security_definer_view advisor ERRORs.
--
--   profiles_public   — identity (name/avatar): every authenticated user in
--                       the same tenant, NO opt-out filter (a DM from a
--                       stranger still needs a sender name).
--   profiles_roommate — discovery: opted-in (is_public) OR own row, tenant-
--                       scoped; mirrors the live roommate_profiles WHERE
--                       clause precisely (IS DISTINCT FROM semantics kept).
--
-- Rollback (with 20260820010000's rollback applied first):
--   drop trigger zzz_sync_profile_projections on public.profiles;
--   drop function public.sync_profile_projections();
--   drop table public.profiles_roommate;
--   drop table public.profiles_public;
-- PITR restore point recorded 2026-07-20 14:03 UTC (pre-apply).

-- ── profiles_public ──────────────────────────────────────────────────────────
create table public.profiles_public (
  id            uuid primary key references public.profiles(id) on delete cascade,
  full_name     text,
  avatar_url    text,
  university_id uuid
);

alter table public.profiles_public enable row level security;

-- Tenant-scoped identity. IS DISTINCT FROM (not =) so a NULL-tenant viewer
-- still matches NULL-tenant rows, same as the live roommate_profiles view.
-- is_superadmin() escape matches the repo-standard tenant_isolation pattern
-- (admin surfaces keep resolving names cross-tenant).
create policy rls_profiles_public_select on public.profiles_public
  for select to authenticated
  using (
    id = (select auth.uid())
    or not (university_id is distinct from (select public.current_university_id()))
    or public.is_superadmin()
  );

-- ── profiles_roommate ────────────────────────────────────────────────────────
-- Column list = the live roommate_profiles view definition, same order.
create table public.profiles_roommate (
  id                    uuid primary key references public.profiles(id) on delete cascade,
  full_name             text,
  avatar_url            text,
  pronouns              text,
  major                 text,
  school                text,
  grade_level           text,
  graduation_year       integer,
  graduation_semester   text,
  bio                   text,
  tags                  text[],
  profile_photos        text[],
  cleanliness           text,
  social_level          text,
  study_style           text,
  guests                text,
  guest_preference      text,
  sleep                 text,
  sleep_habit           text,
  smoking               text,
  temp                  text,
  temp_preference       text,
  conflict_style        text,
  dealbreakers          text[],
  instagram_username    text,
  snapchat_username     text,
  is_public             boolean,
  is_roommate_searching boolean,
  current_dorm          text,
  housing_type          text,
  neighborhood          text,
  preferred_areas       text[],
  created_at            timestamptz,
  university_id         uuid,
  interests             text[],
  prompts               jsonb
);

alter table public.profiles_roommate enable row level security;

-- Precise mirror of the live view's WHERE:
--   (is_public OR own row) AND (own row OR viewer's university matches,
--   NULLs matching NULLs). No superadmin escape — the live view had none.
create policy rls_profiles_roommate_select on public.profiles_roommate
  for select to authenticated
  using (
    (is_public = true or id = (select auth.uid()))
    and (
      id = (select auth.uid())
      or not (university_id is distinct from (select public.current_university_id()))
    )
  );

-- ── Grants: read-only read models ────────────────────────────────────────────
-- Undo Supabase default privileges; only the definer sync trigger writes.
revoke all on public.profiles_public   from public, anon, authenticated, service_role;
revoke all on public.profiles_roommate from public, anon, authenticated, service_role;
grant select on public.profiles_public   to authenticated, service_role;
grant select on public.profiles_roommate to authenticated, service_role;

-- ── Sync trigger ─────────────────────────────────────────────────────────────
create or replace function public.sync_profile_projections()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    -- The ON DELETE CASCADE FKs already remove projection rows; these are a
    -- belt-and-suspenders no-op in that path.
    delete from public.profiles_roommate where id = old.id;
    delete from public.profiles_public where id = old.id;
    return old;
  end if;

  insert into public.profiles_public (id, full_name, avatar_url, university_id)
  values (new.id, new.full_name, new.avatar_url, new.university_id)
  on conflict (id) do update set
    full_name     = excluded.full_name,
    avatar_url    = excluded.avatar_url,
    university_id = excluded.university_id;

  insert into public.profiles_roommate (
    id, full_name, avatar_url, pronouns, major, school, grade_level,
    graduation_year, graduation_semester, bio, tags, profile_photos,
    cleanliness, social_level, study_style, guests, guest_preference,
    sleep, sleep_habit, smoking, temp, temp_preference, conflict_style,
    dealbreakers, instagram_username, snapchat_username, is_public,
    is_roommate_searching, current_dorm, housing_type, neighborhood,
    preferred_areas, created_at, university_id, interests, prompts
  ) values (
    new.id, new.full_name, new.avatar_url, new.pronouns, new.major, new.school,
    new.grade_level, new.graduation_year, new.graduation_semester, new.bio,
    new.tags, new.profile_photos, new.cleanliness, new.social_level,
    new.study_style, new.guests, new.guest_preference, new.sleep,
    new.sleep_habit, new.smoking, new.temp, new.temp_preference,
    new.conflict_style, new.dealbreakers, new.instagram_username,
    new.snapchat_username, new.is_public, new.is_roommate_searching,
    new.current_dorm, new.housing_type, new.neighborhood, new.preferred_areas,
    new.created_at, new.university_id, new.interests, new.prompts
  )
  on conflict (id) do update set
    full_name = excluded.full_name, avatar_url = excluded.avatar_url,
    pronouns = excluded.pronouns, major = excluded.major, school = excluded.school,
    grade_level = excluded.grade_level, graduation_year = excluded.graduation_year,
    graduation_semester = excluded.graduation_semester, bio = excluded.bio,
    tags = excluded.tags, profile_photos = excluded.profile_photos,
    cleanliness = excluded.cleanliness, social_level = excluded.social_level,
    study_style = excluded.study_style, guests = excluded.guests,
    guest_preference = excluded.guest_preference, sleep = excluded.sleep,
    sleep_habit = excluded.sleep_habit, smoking = excluded.smoking,
    temp = excluded.temp, temp_preference = excluded.temp_preference,
    conflict_style = excluded.conflict_style, dealbreakers = excluded.dealbreakers,
    instagram_username = excluded.instagram_username,
    snapchat_username = excluded.snapchat_username, is_public = excluded.is_public,
    is_roommate_searching = excluded.is_roommate_searching,
    current_dorm = excluded.current_dorm, housing_type = excluded.housing_type,
    neighborhood = excluded.neighborhood, preferred_areas = excluded.preferred_areas,
    created_at = excluded.created_at, university_id = excluded.university_id,
    interests = excluded.interests, prompts = excluded.prompts;

  return new;
end;
$$;

revoke all on function public.sync_profile_projections() from public, anon, authenticated;

-- zzz_ so it sorts after the existing trg_* AFTER triggers on profiles.
create trigger zzz_sync_profile_projections
  after insert or update or delete on public.profiles
  for each row execute function public.sync_profile_projections();

-- ── Backfill (after trigger creation, so nothing can slip between) ───────────
insert into public.profiles_public (id, full_name, avatar_url, university_id)
select id, full_name, avatar_url, university_id from public.profiles
on conflict (id) do update set
  full_name = excluded.full_name, avatar_url = excluded.avatar_url,
  university_id = excluded.university_id;

insert into public.profiles_roommate (
  id, full_name, avatar_url, pronouns, major, school, grade_level,
  graduation_year, graduation_semester, bio, tags, profile_photos,
  cleanliness, social_level, study_style, guests, guest_preference,
  sleep, sleep_habit, smoking, temp, temp_preference, conflict_style,
  dealbreakers, instagram_username, snapchat_username, is_public,
  is_roommate_searching, current_dorm, housing_type, neighborhood,
  preferred_areas, created_at, university_id, interests, prompts
)
select
  id, full_name, avatar_url, pronouns, major, school, grade_level,
  graduation_year, graduation_semester, bio, tags, profile_photos,
  cleanliness, social_level, study_style, guests, guest_preference,
  sleep, sleep_habit, smoking, temp, temp_preference, conflict_style,
  dealbreakers, instagram_username, snapchat_username, is_public,
  is_roommate_searching, current_dorm, housing_type, neighborhood,
  preferred_areas, created_at, university_id, interests, prompts
from public.profiles
on conflict (id) do update set
  full_name = excluded.full_name, avatar_url = excluded.avatar_url,
  pronouns = excluded.pronouns, major = excluded.major, school = excluded.school,
  grade_level = excluded.grade_level, graduation_year = excluded.graduation_year,
  graduation_semester = excluded.graduation_semester, bio = excluded.bio,
  tags = excluded.tags, profile_photos = excluded.profile_photos,
  cleanliness = excluded.cleanliness, social_level = excluded.social_level,
  study_style = excluded.study_style, guests = excluded.guests,
  guest_preference = excluded.guest_preference, sleep = excluded.sleep,
  sleep_habit = excluded.sleep_habit, smoking = excluded.smoking,
  temp = excluded.temp, temp_preference = excluded.temp_preference,
  conflict_style = excluded.conflict_style, dealbreakers = excluded.dealbreakers,
  instagram_username = excluded.instagram_username,
  snapchat_username = excluded.snapchat_username, is_public = excluded.is_public,
  is_roommate_searching = excluded.is_roommate_searching,
  current_dorm = excluded.current_dorm, housing_type = excluded.housing_type,
  neighborhood = excluded.neighborhood, preferred_areas = excluded.preferred_areas,
  created_at = excluded.created_at, university_id = excluded.university_id,
  interests = excluded.interests, prompts = excluded.prompts;
