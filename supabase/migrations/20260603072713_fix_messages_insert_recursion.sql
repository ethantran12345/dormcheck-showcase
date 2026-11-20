-- Fix: rls_messages_insert self-references messages -> 42P17 on every direct insert.
-- Move the self-reference into a SECURITY DEFINER helper so the policy no longer
-- reads its own table through RLS. Pending/accepted logic preserved exactly.

create or replace function public.conversation_has_messages(conv_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.messages m where m.conversation_id = conv_id);
$$;
revoke all on function public.conversation_has_messages(uuid) from public, anon;
grant execute on function public.conversation_has_messages(uuid) to authenticated;

drop policy if exists rls_messages_insert on public.messages;
create policy rls_messages_insert on public.messages
  as permissive for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (auth.uid() = c.participant_1 or auth.uid() = c.participant_2)
        and (
          c.status = 'accepted'
          or (
            c.status = 'pending'
            and c.initiated_by = auth.uid()
            and not public.conversation_has_messages(c.id)
          )
        )
    )
  );
