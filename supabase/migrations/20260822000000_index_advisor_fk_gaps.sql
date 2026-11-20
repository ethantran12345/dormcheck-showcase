-- Advisor-autofix: add missing indexes on foreign-key columns flagged by
-- get_advisors (issues #46, #45, #38). Unindexed FK columns force sequential
-- scans on the child table for every parent update/delete and for joins.
--
-- Each target column carries two FKs (auth.users + profiles); a single index
-- on the column covers both. Columns already indexed on these tables
-- (community_room_optouts.user_id, roommate_search_interests.post_id,
-- roommate_search_posts.university_id) are intentionally omitted.
-- Verified against live prod for which columns are actually unindexed.
-- IF NOT EXISTS keeps this idempotent across reset/reapply.

create index if not exists idx_community_room_optouts_group_id
  on public.community_room_optouts (group_id);

create index if not exists idx_roommate_search_interests_user_id
  on public.roommate_search_interests (user_id);

create index if not exists idx_roommate_search_posts_user_id
  on public.roommate_search_posts (user_id);
