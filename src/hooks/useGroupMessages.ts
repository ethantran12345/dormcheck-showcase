import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useBlockedUserIds } from '@/hooks/useBlockedUsers';
import { sanitizeText } from '@/lib/sanitize';
import type { Database } from '@/integrations/supabase/types';
import { parseGroupMessageMetadata, type GroupMessageMetadata } from '@/types/groupMessageMeta';
import { nextPendingKey, optimisticWrite } from '@/lib/optimistic';

type GroupMessageRow = Database['public']['Tables']['group_messages']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];

// `metadata` ships in migration 20260818000000; types.ts lags prod (see the
// supabase-backend rule), so read it off a widened row shape and parse it.
type RawGroupMessageRow = GroupMessageRow & { metadata?: unknown };

type SenderProfile = Pick<ProfileRow, 'id' | 'full_name' | 'avatar_url'>;

export type GroupMessageWithSender = GroupMessageRow & {
  sender: SenderProfile | null;
  /** Structured attachment (checklist item / instagram), or null for plain text. */
  metadata: GroupMessageMetadata | null;
};

const MESSAGE_PAGE_LIMIT = 200;
const LAST_MESSAGE_PREVIEW_LIMIT = 200;
const GROUP_MESSAGE_SELECT_COLUMNS = 'id, group_id, sender_id, content, created_at, metadata';

export function groupMessageCursorFilter(message: Pick<GroupMessageRow, 'created_at' | 'id'>): string {
  return `created_at.lt.${message.created_at},and(created_at.eq.${message.created_at},id.lt.${message.id})`;
}

/**
 * Loads messages for a single `group_conversations` row, enriches each with the
 * sender's profile, subscribes to INSERTs on `group_messages` for that group,
 * and exposes `sendMessage` / `markRead` helpers. Mirrors the per-thread
 * realtime + send pattern in `ChatPanel.tsx`, adapted for the group schema.
 */
export function useGroupMessages(groupId: string | null) {
  const { user } = useAuth();
  const { blockedUserIds } = useBlockedUserIds();
  const userId = user?.id ?? null;
  const blockedUserIdsRef = useRef(blockedUserIds);
  blockedUserIdsRef.current = blockedUserIds;
  // Cache of sender_id -> profile so the realtime INSERT handler doesn't refetch a
  // sender's public_profiles row for every message once we've seen them. Seeded from
  // the initial load; populated on cache miss. Keyed to the current group.
  const senderCacheRef = useRef<Map<string, SenderProfile>>(new Map());
  const [messages, setMessages] = useState<GroupMessageWithSender[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!groupId || !userId) {
      setMessages([]);
      setHasOlderMessages(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const { data: msgs, error: mErr } = await supabase
          .from('group_messages')
          .select(GROUP_MESSAGE_SELECT_COLUMNS)
          .eq('group_id', groupId)
          // Fetch the newest page. Ascending + LIMIT silently returned the
          // oldest 200 rows and made active groups appear stale once they grew.
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(MESSAGE_PAGE_LIMIT);

        if (mErr) throw mErr;
        if (cancelled) return;

        // The timeline renders oldest -> newest, so reverse the bounded newest
        // page after PostgREST applies the descending limit.
        const rows = ((msgs ?? []) as GroupMessageRow[]).slice().reverse();
        setHasOlderMessages(rows.length === MESSAGE_PAGE_LIMIT);
        // System (welcome) messages have a NULL sender - no profile to fetch.
        const senderIds = Array.from(
          new Set(rows.map((m) => m.sender_id).filter((id): id is string => !!id)),
        );

        let profiles: SenderProfile[] = [];
        if (senderIds.length > 0) {
          const { data: profileRows, error: pErr } = await supabase
            .from('public_profiles')
            .select('id, full_name, avatar_url')
            .in('id', senderIds);
          if (pErr) throw pErr;
          profiles = (profileRows ?? []) as SenderProfile[];
        }
        if (cancelled) return;

        const profileById = new Map<string, SenderProfile>(
          profiles.map((p) => [p.id, p])
        );
        // Seed the realtime handler's cache for this group from the initial fetch.
        senderCacheRef.current = new Map(profileById);
        const enriched: GroupMessageWithSender[] = rows.map((m) => ({
          ...m,
          sender: m.sender_id ? profileById.get(m.sender_id) ?? null : null,
          metadata: parseGroupMessageMetadata((m as RawGroupMessageRow).metadata),
        }));

        setMessages(enriched);
      } catch (e) {
        if (!cancelled) setError(e as Error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [groupId, userId]);

  const loadOlderMessages = useCallback(async (): Promise<boolean> => {
    const oldest = messages[0];
    if (!groupId || !userId || !oldest || isLoadingOlder) return false;
    setIsLoadingOlder(true);
    setError(null);
    try {
      const { data: rowsData, error: rowsError } = await supabase
        .from('group_messages')
        .select(GROUP_MESSAGE_SELECT_COLUMNS)
        .eq('group_id', groupId)
        .or(groupMessageCursorFilter(oldest))
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(MESSAGE_PAGE_LIMIT);
      if (rowsError) throw rowsError;

      const rows = ((rowsData ?? []) as GroupMessageRow[]).slice().reverse();
      const uncachedSenderIds = Array.from(new Set(
        rows
          .map((row) => row.sender_id)
          .filter((id): id is string => Boolean(id) && !senderCacheRef.current.has(id)),
      ));
      if (uncachedSenderIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from('public_profiles')
          .select('id, full_name, avatar_url')
          .in('id', uncachedSenderIds);
        if (profilesError) throw profilesError;
        for (const profile of (profiles ?? []) as SenderProfile[]) {
          senderCacheRef.current.set(profile.id, profile);
        }
      }

      setMessages((current) => {
        const ids = new Set(current.map((row) => row.id));
        const older = rows
          .filter((row) => !ids.has(row.id))
          .map((row) => ({
            ...row,
            sender: row.sender_id ? senderCacheRef.current.get(row.sender_id) ?? null : null,
            metadata: parseGroupMessageMetadata((row as RawGroupMessageRow).metadata),
          }));
        return [...older, ...current];
      });
      setHasOlderMessages(rows.length === MESSAGE_PAGE_LIMIT);
      return true;
    } catch (cause) {
      setError(cause as Error);
      return false;
    } finally {
      setIsLoadingOlder(false);
    }
  }, [groupId, isLoadingOlder, messages, userId]);

  useEffect(() => {
    if (!groupId || !userId) return;

    const channel = supabase
      .channel(`group-messages-${groupId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'group_messages',
          filter: `group_id=eq.${groupId}`,
        },
        async (payload) => {
          const newMsg = payload.new as GroupMessageRow;
          if (newMsg.sender_id && blockedUserIdsRef.current.has(newMsg.sender_id)) return;

          // Reuse a cached sender profile if we've already fetched it; only hit the
          // network on a cache miss. System messages (NULL sender) skip the lookup.
          let senderProfile = newMsg.sender_id
            ? senderCacheRef.current.get(newMsg.sender_id) ?? null
            : null;
          if (!senderProfile && newMsg.sender_id) {
            const { data } = await supabase
              .from('public_profiles')
              .select('id, full_name, avatar_url')
              .eq('id', newMsg.sender_id)
              .maybeSingle();
            senderProfile = (data as SenderProfile | null) ?? null;
            if (senderProfile) senderCacheRef.current.set(newMsg.sender_id, senderProfile);
          }

          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [
              ...prev,
              {
                ...newMsg,
                sender: senderProfile,
                metadata: parseGroupMessageMetadata((newMsg as RawGroupMessageRow).metadata),
              },
            ];
          });

          if (newMsg.sender_id !== userId) {
            await supabase
              .from('group_members')
              .update({ last_read_at: new Date().toISOString() })
              .eq('group_id', groupId)
              .eq('user_id', userId);
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId, userId]);

  const sendMessage = useCallback(
    async (rawContent: string, metadata?: GroupMessageMetadata | null): Promise<boolean> => {
      if (!groupId || !userId) return false;
      const content = sanitizeText(rawContent).trim();
      if (!content) return false;

      setIsSending(true);
      try {
        const insertRow = {
          group_id: groupId,
          sender_id: userId,
          content,
          metadata: metadata ?? null,
        };
        // Paint the bubble before the insert is issued. `group_messages.id` is a uuid,
        // so the placeholder key is the string flavour (`pending:-N`) — it can never
        // collide with a real uuid, and `isPendingId` lets the renderer tell the two
        // apart. Sender is resolved from the cache so the optimistic bubble carries the
        // same avatar/name the reconciled one will.
        const pendingId = nextPendingKey();
        const pendingRow: GroupMessageWithSender = {
          ...(insertRow as unknown as GroupMessageRow),
          id: pendingId,
          created_at: new Date().toISOString(),
          sender: senderCacheRef.current.get(userId) ?? null,
          metadata: metadata ?? null,
        };

        const inserted = await optimisticWrite<RawGroupMessageRow>({
          paint: () => setMessages((prev) => [...prev, pendingRow]),
          run: () =>
            supabase
              .from('group_messages')
              // metadata not yet in generated types (migration 20260818000000); safe cast.
              .insert(insertRow as Database['public']['Tables']['group_messages']['Insert'])
              .select(GROUP_MESSAGE_SELECT_COLUMNS)
              .single() as PromiseLike<{
              data: RawGroupMessageRow | null;
              error: { message: string } | null;
            }>,
          // Swap the placeholder for the server row, tolerating the realtime echo of
          // our own INSERT having already appended it.
          commit: (row) =>
            setMessages((prev) => {
              const withoutPending = prev.filter((m) => m.id !== pendingId);
              if (withoutPending.some((m) => m.id === row.id)) return withoutPending;
              return [
                ...withoutPending,
                {
                  ...(row as GroupMessageRow),
                  sender: pendingRow.sender,
                  metadata: parseGroupMessageMetadata(row.metadata),
                },
              ];
            }),
          rollback: () => setMessages((prev) => prev.filter((m) => m.id !== pendingId)),
        });
        if (!inserted) return false;

        const nowIso = new Date().toISOString();

        await supabase
          .from('group_conversations')
          .update({
            last_message: content.slice(0, LAST_MESSAGE_PREVIEW_LIMIT),
            updated_at: nowIso,
          })
          .eq('id', groupId);

        await supabase
          .from('group_members')
          .update({ last_read_at: nowIso })
          .eq('group_id', groupId)
          .eq('user_id', userId);

        return true;
      } catch (e) {
        setError(e as Error);
        return false;
      } finally {
        setIsSending(false);
      }
    },
    [groupId, userId]
  );

  /**
   * RA/admin moderation delete. Server-gated by the delete_group_message RPC
   * (RA of this room or profiles.is_admin); optimistic local removal.
   */
  const deleteMessage = useCallback(
    async (messageId: string): Promise<boolean> => {
      if (!groupId || !userId) return false;
      // RPC ships in migration 20260816000000; types.ts lags, hence the cast.
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        fn: string,
        args?: Record<string, unknown>,
      ) => Promise<{ error: { message: string } | null }>;
      const { error: delErr } = await rpc('delete_group_message', { p_message_id: messageId });
      if (delErr) {
        setError(new Error(delErr.message));
        return false;
      }
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      return true;
    },
    [groupId, userId]
  );

  const markRead = useCallback(async () => {
    if (!groupId || !userId) return;
    await supabase
      .from('group_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('group_id', groupId)
      .eq('user_id', userId);
  }, [groupId, userId]);

  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (m) => !m.sender_id || !blockedUserIds.has(m.sender_id),
      ),
    [messages, blockedUserIds],
  );

  return {
    messages: visibleMessages,
    isLoading,
    isLoadingOlder,
    hasOlderMessages,
    isSending,
    error,
    loadOlderMessages,
    sendMessage,
    deleteMessage,
    markRead,
  };
}
