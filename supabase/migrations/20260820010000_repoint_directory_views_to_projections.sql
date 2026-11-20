-- Option B step 2: rebase public_profiles / roommate_profiles as
-- security_invoker views over the projection tables (20260820000000).
-- Same view names, same column lists/order, same grants — client call sites
-- and shipped iOS bundles keep working unchanged. This clears the last two
-- security_definer_view advisor ERRORs.
--
-- PostgREST embed lineage: view embeds resolve through the view's BASE
-- table's FKs (see docs/tasks/prod-apply-definer-view-invoker.md). The base
-- moves from `profiles` to the projections, so:
--   * marketplace_listings gains a second FK on user_id -> profiles_public,
--     which is what lets `profiles:public_profiles(full_name)` keep resolving.
--   * roommate_search_posts / roommate_search_interests embeds name their FK
--     constraint explicitly (`roommate_profiles!<tbl>_user_id_fkey`), so the
--     old constraint is renamed aside and a NEW constraint with the ORIGINAL
--     name points at profiles_roommate — shipped clients keep the same hint.
-- All added FKs are valid by construction: the projections are a complete
-- 1:1 mirror of profiles (backfill + sync trigger), and FK checks ignore RLS.
--
-- Rollback:
--   alter table public.marketplace_listings drop constraint marketplace_listings_user_id_profiles_public_fkey;
--   alter table public.roommate_search_posts drop constraint roommate_search_posts_user_id_fkey;
--   alter table public.roommate_search_posts rename constraint roommate_search_posts_user_id_profiles_fkey to roommate_search_posts_user_id_fkey;
--   alter table public.roommate_search_interests drop constraint roommate_search_interests_user_id_fkey;
--   alter table public.roommate_search_interests rename constraint roommate_search_interests_user_id_profiles_fkey to roommate_search_interests_user_id_fkey;
--   create or replace view public.public_profiles as
--     select id, full_name, avatar_url from public.profiles;
--   alter view public.public_profiles reset (security_invoker);
--   create or replace view public.roommate_profiles as
--     select id, full_name, avatar_url, pronouns, major, school, grade_level,
--            graduation_year, graduation_semester, bio, tags, profile_photos,
--            cleanliness, social_level, study_style, guests, guest_preference,
--            sleep, sleep_habit, smoking, temp, temp_preference, conflict_style,
--            dealbreakers, instagram_username, snapchat_username, is_public,
--            is_roommate_searching, current_dorm, housing_type, neighborhood,
--            preferred_areas, created_at, university_id, interests, prompts
--     from public.profiles p
--     where (is_public = true or id = (select auth.uid()))
--       and (id = (select auth.uid())
--            or not university_id is distinct from
--              (select pr.university_id from public.profiles pr
--                where pr.id = (select auth.uid())));
--   alter view public.roommate_profiles reset (security_invoker);

-- ── Embed-preserving FKs ─────────────────────────────────────────────────────
alter table public.marketplace_listings
  add constraint marketplace_listings_user_id_profiles_public_fkey
  foreign key (user_id) references public.profiles_public(id) on delete cascade;

alter table public.roommate_search_posts
  rename constraint roommate_search_posts_user_id_fkey
  to roommate_search_posts_user_id_profiles_fkey;
alter table public.roommate_search_posts
  add constraint roommate_search_posts_user_id_fkey
  foreign key (user_id) references public.profiles_roommate(id) on delete cascade;

alter table public.roommate_search_interests
  rename constraint roommate_search_interests_user_id_fkey
  to roommate_search_interests_user_id_profiles_fkey;
alter table public.roommate_search_interests
  add constraint roommate_search_interests_user_id_fkey
  foreign key (user_id) references public.profiles_roommate(id) on delete cascade;

-- ── Rebase the views (invoker: RLS on the projections is the boundary) ───────
create or replace view public.public_profiles
  with (security_invoker = true) as
  select id, full_name, avatar_url
  from public.profiles_public;

create or replace view public.roommate_profiles
  with (security_invoker = true) as
  select id, full_name, avatar_url, pronouns, major, school, grade_level,
         graduation_year, graduation_semester, bio, tags, profile_photos,
         cleanliness, social_level, study_style, guests, guest_preference,
         sleep, sleep_habit, smoking, temp, temp_preference, conflict_style,
         dealbreakers, instagram_username, snapchat_username, is_public,
         is_roommate_searching, current_dorm, housing_type, neighborhood,
         preferred_areas, created_at, university_id, interests, prompts
  from public.profiles_roommate;
