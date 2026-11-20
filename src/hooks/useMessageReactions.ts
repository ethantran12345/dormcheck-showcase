import { useReactionsCore, type UseReactionsResult } from '@/hooks/useReactionsCore';

// Emoji reactions for a DM thread (public.message_reactions, keyed by conversation_id).
// Mirrors the DM message realtime channel in ChatPanel.tsx.
export function useMessageReactions(conversationId: string | null): UseReactionsResult {
  return useReactionsCore({
    table: 'message_reactions',
    threadColumn: 'conversation_id',
    threadId: conversationId,
  });
}
