-- blocked_users: user-to-user blocking (App Store Guideline 1.2)
create table public.blocked_users (
  blocker_id  uuid not null references public.profiles(id) on delete cascade,
  blocked_id  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocked_users_no_self check (blocker_id <> blocked_id)
);

create index blocked_users_blocked_id_idx on public.blocked_users (blocked_id);

alter table public.blocked_users enable row level security;

create policy rls_blocked_users_select
  on public.blocked_users for select to authenticated
  using (blocker_id = auth.uid());

create policy rls_blocked_users_insert
  on public.blocked_users for insert to authenticated
  with check (blocker_id = auth.uid() and blocked_id <> auth.uid());

create policy rls_blocked_users_delete
  on public.blocked_users for delete to authenticated
  using (blocker_id = auth.uid());

revoke all on public.blocked_users from anon, public;
grant select, insert, delete on public.blocked_users to authenticated;
