import { useReactionsCore, type UseReactionsResult } from '@/hooks/useReactionsCore';

// Emoji reactions for a group thread (public.group_message_reactions, keyed by group_id).
// Mirrors the group message realtime channel in useGroupMessages.ts.
export function useGroupMessageReactions(groupId: string | null): UseReactionsResult {
  return useReactionsCore({
    table: 'group_message_reactions',
    threadColumn: 'group_id',
    threadId: groupId,
  });
}
