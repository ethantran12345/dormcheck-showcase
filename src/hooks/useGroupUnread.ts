import { useGroupConversations } from './useGroupConversations';

/**
 * Total number of `group_conversations` rows where the current user's
 * `group_members.last_read_at` is null or older than `group_conversations.updated_at`.
 * Thin wrapper over `useGroupConversations` so the data is fetched once and
 * shared across consumers via TanStack Query's cache.
 */
type UseGroupUnreadOptions = {
  enabled?: boolean;
};

export function useGroupUnread(options?: UseGroupUnreadOptions) {
  // Messages badge counts user-made groups only; community (building) rooms
  // carry their own badge via useCommunityUnread.
  const { messageGroups } = useGroupConversations(options);
  const unreadCount = messageGroups.filter((g) => g.isUnread).length;
  return {
    unreadCount,
    hasUnreadGroups: unreadCount > 0,
  };
}
