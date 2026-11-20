-- Per-comment likes for dorm setup comments.
create table if not exists public.setup_comment_likes (
  id bigint generated always as identity primary key,
  comment_id bigint not null references public.setup_comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (comment_id, user_id)
);

create index if not exists setup_comment_likes_comment_id_idx
  on public.setup_comment_likes(comment_id);

alter table public.setup_comment_likes enable row level security;

-- No SELECT policy on purpose: reads go through the SECURITY DEFINER RPC below,
-- which returns only aggregates. Writes are restricted to the caller's own uid.
create policy "insert own comment like"
  on public.setup_comment_likes for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "delete own comment like"
  on public.setup_comment_likes for delete
  to authenticated
  using (user_id = auth.uid());

-- Aggregate read: per-comment like_count, whether the caller liked, and whether
-- the post author (passed in) liked. p_author_id is the setup uploader's user_id.
create or replace function public.get_setup_comment_likes(p_setup_id bigint, p_author_id uuid)
returns table (comment_id bigint, like_count bigint, liked_by_me boolean, liked_by_author boolean)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    cl.comment_id,
    count(*) as like_count,
    bool_or(cl.user_id = auth.uid()) as liked_by_me,
    bool_or(p_author_id is not null and cl.user_id = p_author_id) as liked_by_author
  from public.setup_comment_likes cl
  join public.setup_comments c on c.id = cl.comment_id
  where c.setup_id = p_setup_id
  group by cl.comment_id;
$$;

revoke execute on function public.get_setup_comment_likes(bigint, uuid) from public;
grant execute on function public.get_setup_comment_likes(bigint, uuid) to authenticated;
