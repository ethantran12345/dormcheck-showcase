-- Device tokens for push notifications
create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('ios', 'android', 'web')),
  device_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create unique index if not exists device_tokens_token_unique on public.device_tokens(token);
create index if not exists device_tokens_user_id_idx on public.device_tokens(user_id);

alter table public.device_tokens enable row level security;

create policy "Users can view their own device tokens"
  on public.device_tokens for select
  using (auth.uid() = user_id);

create policy "Users can insert their own device tokens"
  on public.device_tokens for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own device tokens"
  on public.device_tokens for update
  using (auth.uid() = user_id);

create policy "Users can delete their own device tokens"
  on public.device_tokens for delete
  using (auth.uid() = user_id);

create or replace function public.update_device_tokens_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger device_tokens_updated_at
  before update on public.device_tokens
  for each row execute function public.update_device_tokens_updated_at();
