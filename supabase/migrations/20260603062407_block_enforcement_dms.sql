-- Block enforcement on DMs (App Store 1.2)

-- Block in either direction between two users
create or replace function public.is_blocked_between(u1 uuid, u2 uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.blocked_users b
    where (b.blocker_id = u1 and b.blocked_id = u2)
       or (b.blocker_id = u2 and b.blocked_id = u1)
  );
$$;
revoke all on function public.is_blocked_between(uuid, uuid) from public, anon;
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated;

-- Are the participants of a given conversation blocked?
-- SECURITY DEFINER so the internal read of conversations does NOT re-enter
-- conversations RLS (prevents the policy recursion on messages).
create or replace function public.is_conversation_blocked(conv_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.conversations c
    where c.id = conv_id
      and public.is_blocked_between(c.participant_1, c.participant_2)
  );
$$;
revoke all on function public.is_conversation_blocked(uuid) from public, anon;
grant execute on function public.is_conversation_blocked(uuid) to authenticated;

-- New conversations between a blocked pair (restrictive: AND-ed with existing policies)
drop policy if exists rls_conversations_insert_block_check on public.conversations;
create policy rls_conversations_insert_block_check
  on public.conversations as restrictive for insert to authenticated
  with check (not public.is_blocked_between(participant_1, participant_2));

-- Messages in a conversation involving a blocked pair (restrictive)
drop policy if exists rls_messages_insert_block_check on public.messages;
create policy rls_messages_insert_block_check
  on public.messages as restrictive for insert to authenticated
  with check (not public.is_conversation_blocked(conversation_id));
