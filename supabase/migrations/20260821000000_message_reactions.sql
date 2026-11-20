-- Emoji message reactions for DMs (public.messages) and group chats (public.group_messages).
--
-- Two mirror tables, one per message table, because the parent PKs differ in type:
--   messages.id       is BIGINT  -> message_reactions.message_id       BIGINT
--   group_messages.id is UUID    -> group_message_reactions.message_id UUID
--
-- Each reaction denormalizes its thread key (conversation_id / group_id) so a Realtime
-- subscription can filter by thread exactly like the message channels do, and so DELETE
-- payloads (which under the default REPLICA IDENTITY only carry the PK) can still be
-- routed to the right thread -- hence REPLICA IDENTITY FULL below.
--
-- RLS reuses the EXACT membership predicates the underlying message tables already use:
--   DM    -> "participant of the parent conversation" (mirrors rls_messages_select)
--   group -> public.is_chat_group_member(group_id)    (mirrors rls_group_messages_select)
-- INSERT/DELETE additionally require user_id = auth.uid(); INSERT also verifies the
-- message genuinely belongs to the denormalized thread key so it can't be spoofed.

-- ============================================================================
-- DM reactions
-- ============================================================================
create table if not exists public.message_reactions (
  id              uuid primary key default gen_random_uuid(),
  message_id      bigint not null references public.messages(id) on delete cascade,
  conversation_id uuid   not null references public.conversations(id) on delete cascade,
  user_id         uuid   not null references auth.users(id) on delete cascade,
  emoji           text   not null check (char_length(emoji) between 1 and 32),
  created_at      timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create index if not exists idx_message_reactions_conversation on public.message_reactions (conversation_id);
create index if not exists idx_message_reactions_message      on public.message_reactions (message_id);

alter table public.message_reactions enable row level security;
alter table public.message_reactions replica identity full;

-- SELECT: participant of the parent conversation (mirrors rls_messages_select).
create policy rls_message_reactions_select on public.message_reactions
  for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = message_reactions.conversation_id
        and (c.participant_1 = auth.uid() or c.participant_2 = auth.uid())
    )
  );

-- INSERT: only your own reaction, you must be a participant, and the target message
-- must actually live in the conversation_id you claim (keeps the denormalized key honest).
create policy rls_message_reactions_insert on public.message_reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = message_reactions.conversation_id
        and (c.participant_1 = auth.uid() or c.participant_2 = auth.uid())
    )
    and exists (
      select 1 from public.messages m
      where m.id = message_reactions.message_id
        and m.conversation_id = message_reactions.conversation_id
    )
  );

-- DELETE: only your own reaction.
create policy rls_message_reactions_delete on public.message_reactions
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, delete on public.message_reactions to authenticated;
grant all on public.message_reactions to service_role;

-- ============================================================================
-- Group reactions
-- ============================================================================
create table if not exists public.group_message_reactions (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references public.group_messages(id) on delete cascade,
  group_id    uuid not null references public.group_conversations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  emoji       text not null check (char_length(emoji) between 1 and 32),
  created_at  timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create index if not exists idx_group_message_reactions_group   on public.group_message_reactions (group_id);
create index if not exists idx_group_message_reactions_message on public.group_message_reactions (message_id);

alter table public.group_message_reactions enable row level security;
alter table public.group_message_reactions replica identity full;

-- SELECT: member of the parent group (mirrors rls_group_messages_select).
create policy rls_group_message_reactions_select on public.group_message_reactions
  for select to authenticated
  using (public.is_chat_group_member(group_id));

-- INSERT: only your own reaction, you must be a member, and the target message must
-- actually belong to the group_id you claim.
create policy rls_group_message_reactions_insert on public.group_message_reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_chat_group_member(group_id)
    and exists (
      select 1 from public.group_messages gm
      where gm.id = group_message_reactions.message_id
        and gm.group_id = group_message_reactions.group_id
    )
  );

-- DELETE: only your own reaction.
create policy rls_group_message_reactions_delete on public.group_message_reactions
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, delete on public.group_message_reactions to authenticated;
grant all on public.group_message_reactions to service_role;

-- ============================================================================
-- Realtime
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions'
    ) then
      alter publication supabase_realtime add table public.message_reactions;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'group_message_reactions'
    ) then
      alter publication supabase_realtime add table public.group_message_reactions;
    end if;
  end if;
end;
$$;
