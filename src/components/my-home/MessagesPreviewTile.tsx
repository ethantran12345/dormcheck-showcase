import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useBlockedUserIds } from '@/hooks/useBlockedUsers';
import { safeImageSrc } from '@/lib/sanitize';
import { cn } from '@/lib/utils';
import { WidgetCard } from './WidgetCard';
import { WIDGET_EMPTY_CTA, WIDGET_FOOTER_LINK } from './cardSystem';
import { timeAgo } from './timeAgo';

interface MessagesPreviewTileProps {
  userId: string;
}

interface ConversationRow {
  id: string;
  participant_1: string;
  participant_2: string;
  last_message: string | null;
  updated_at: string | null;
  participant_1_last_read: string | null;
  participant_2_last_read: string | null;
}

interface PreviewProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
}

const STALE_TIME_MS = 60_000;

const SYSTEM_NAME_PATTERNS: RegExp[] = [
  /^system$/i,
  /^admin$/i,
  /^dormcheck$/i,
  /^support$/i,
  /^notifications?$/i,
];

function isSystemProfileName(name: string | null | undefined): boolean {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return true;
  return SYSTEM_NAME_PATTERNS.some((re) => re.test(trimmed));
}

function isRowUnread(row: ConversationRow, userId: string): boolean {
  const updated = row.updated_at;
  if (!updated) return false;
  const lastRead =
    row.participant_1 === userId
      ? row.participant_1_last_read
      : row.participant_2_last_read;
  if (!lastRead) return true;
  try {
    return new Date(updated).getTime() > new Date(lastRead).getTime();
  } catch {
    return false;
  }
}

/**
 * Wide "Messages" tile previewing the most recent conversation - avatar, sender,
 * the last message text, time, and an unread dot - so the latest message is
 * visible at a glance. Truncates cleanly when the tile is sized small.
 */
export function MessagesPreviewTile({ userId }: MessagesPreviewTileProps) {
  const navigate = useNavigate();
  const { blockedUserIds } = useBlockedUserIds();

  const { data: conversations = [], isLoading: convsLoading } = useQuery({
    queryKey: ['my-home-messages-preview', userId],
    enabled: !!userId,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<ConversationRow[]> => {
      const { data, error } = await supabase
        .from('conversations')
        .select(
          'id, participant_1, participant_2, last_message, updated_at, participant_1_last_read, participant_2_last_read',
        )
        .or(`participant_1.eq.${userId},participant_2.eq.${userId}`)
        .order('updated_at', { ascending: false })
        .limit(15);
      if (error) throw error;
      return (data ?? []) as ConversationRow[];
    },
  });

  const otherIds = useMemo(() => {
    const ids = conversations.map((c) =>
      c.participant_1 === userId ? c.participant_2 : c.participant_1,
    );
    return Array.from(new Set(ids.filter(Boolean)));
  }, [conversations, userId]);

  const { data: profileMap = {}, isLoading: profilesLoading } = useQuery({
    queryKey: ['my-home-messages-profiles', otherIds.slice().sort().join(',')],
    enabled: otherIds.length > 0,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<Record<string, PreviewProfile>> => {
      const { data, error } = await supabase
        .from('public_profiles')
        .select('id, full_name, avatar_url')
        .in('id', otherIds);
      if (error) throw error;
      const out: Record<string, PreviewProfile> = {};
      (data ?? []).forEach((row) => {
        out[(row as PreviewProfile).id] = row as PreviewProfile;
      });
      return out;
    },
  });

  const isLoading = convsLoading || (otherIds.length > 0 && profilesLoading);

  const visible = useMemo(() => {
    return conversations.filter((c) => {
      const otherId = c.participant_1 === userId ? c.participant_2 : c.participant_1;
      if (!otherId || blockedUserIds.has(otherId)) return false;
      const other = profileMap[otherId];
      if (!other) return false;
      return !isSystemProfileName(other.full_name);
    });
  }, [conversations, profileMap, userId, blockedUserIds]);

  const unreadCount = useMemo(
    () => visible.filter((c) => isRowUnread(c, userId)).length,
    [visible, userId],
  );

  const latest = visible[0];
  const previewRows = visible.slice(0, 3);

  return (
    <WidgetCard
      title="Messages"
      icon={<MessageCircle className="h-4 w-4" />}
      tint="blue"
    >
      {isLoading ? (
        <div className="flex items-center gap-3 py-1">
          <div className="h-11 w-11 shrink-0 rounded-full bg-muted animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-24 rounded bg-muted animate-pulse" />
            <div className="h-3 w-40 rounded bg-muted animate-pulse" />
          </div>
        </div>
      ) : !latest ? (
        <div className="flex flex-1 flex-col items-center justify-center py-4 text-center lg:min-h-[180px]">
          <span className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <MessageCircle className="h-5 w-5" aria-hidden />
          </span>
          <p className="text-sm font-medium text-foreground">It&apos;s quiet in here</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Say hi to a future hallmate or a seller.
          </p>
          <button
            type="button"
            onClick={() => navigate('/messages')}
            className={cn('mt-3', WIDGET_EMPTY_CTA)}
          >
            Open inbox
            <span aria-hidden="true">→</span>
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-0.5">
            {previewRows.map((c) => {
              const otherId = c.participant_1 === userId ? c.participant_2 : c.participant_1;
              const prof = profileMap[otherId];
              const name = (prof?.full_name ?? '').trim() || 'Student';
              const photo = safeImageSrc(prof?.avatar_url ?? '') ?? null;
              const unread = isRowUnread(c, userId);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => navigate(`/messages?conversation=${encodeURIComponent(c.id)}`)}
                  className="-mx-1 flex w-full items-center gap-3 rounded-xl px-1 py-1.5 text-left transition-colors hover:bg-accent"
                >
                  <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-semibold text-muted-foreground">
                    {photo ? (
                      <img src={photo} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      name.charAt(0).toUpperCase()
                    )}
                    {unread && (
                      <span
                        aria-label="Unread"
                        className="absolute right-0 top-0 h-3 w-3 rounded-full bg-foreground ring-2 ring-card"
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-foreground">{name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {timeAgo(c.updated_at)}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'mt-0.5 line-clamp-1 text-sm',
                        unread ? 'font-medium text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {(c.last_message ?? '').trim() || 'Say hi 👋'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <Link to="/messages" className={cn('mt-auto self-start pt-3', WIDGET_FOOTER_LINK)}>
            {unreadCount > 0 ? `View all · ${unreadCount} unread` : 'View all messages'}
            <span aria-hidden="true"> →</span>
          </Link>
        </>
      )}
    </WidgetCard>
  );
}
