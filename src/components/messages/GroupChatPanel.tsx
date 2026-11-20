import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, ArrowLeft, Users, Pin, PinOff, MoreVertical, Flag, Trash2, UserX, Sparkles, Plus, Package, Instagram } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useBlockUser } from '@/hooks/useBlockedUsers';
import { ReportContentDialog } from '@/components/ReportContentDialog';
import { useKeyboardOpen } from '@/hooks/useKeyboardInset';
import { useGroupMessages } from '@/hooks/useGroupMessages';
import { useGroupConversations, type GroupConversationWithMembers } from '@/hooks/useGroupConversations';
import { useGroupPin } from '@/hooks/useGroupPin';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { bubbleSurfaceClass } from '@/components/chat/MessageBubble';
import { BubbleContent } from '@/components/ui/bubble';
import { computeMessageGrouping } from '@/lib/messageGrouping';
import { MessageScroller } from '@/components/chat/MessageScroller';
import { ShareChecklistItemDialog } from '@/components/messages/ShareChecklistItemDialog';
import { GroupMessageAttachment } from '@/components/messages/GroupMessageAttachment';
import { MessageReactions, reactionOverlapClass } from '@/components/chat/MessageReactions';
import { useGroupMessageReactions } from '@/hooks/useGroupMessageReactions';
import { useLongPress } from '@/hooks/useLongPress';
import { useResolvedColorScheme } from '@/hooks/useResolvedColorScheme';
import { haptic } from '@/lib/haptics';
import type { GroupMessageMetadata } from '@/types/groupMessageMeta';

interface GroupChatPanelProps {
  activeGroupId: string | null;
  onClearGroup?: () => void;
  isMobile?: boolean;
  onBack?: () => void;
  onMessageInputFocus?: () => void;
  onMessageInputBlur?: () => void;
  /** Optional: pass through the group object so we don't re-resolve from list */
  activeGroup?: GroupConversationWithMembers | null;
}

export function GroupChatPanel({
  activeGroupId,
  onClearGroup: _onClearGroup,
  isMobile = false,
  onBack,
  onMessageInputFocus,
  onMessageInputBlur,
  activeGroup,
}: GroupChatPanelProps) {
  const { t } = useTranslation();
  const { user, isAdmin } = useAuth();
  // The messages route pane lifts above the keyboard (--keyboard-height), so the composer
  // must NOT also offset by it. Only clear the home indicator when the keyboard is down;
  // when it's up the keyboard covers that area, so drop it to sit flush.
  const keyboardOpen = useKeyboardOpen();
  const mobileFooterPaddingBottom = keyboardOpen
    ? '0.375rem'
    : 'max(0.75rem, env(safe-area-inset-bottom, 0px))';
  const { groups } = useGroupConversations();
  const {
    messages,
    isLoading,
    isLoadingOlder,
    hasOlderMessages,
    loadOlderMessages,
    isSending,
    sendMessage,
    deleteMessage,
    markRead,
  } = useGroupMessages(activeGroupId);
  const { pinned, isRA, raUserIds, pin, unpin, isMutating } = useGroupPin(activeGroupId, user?.id ?? null);
  const blockMutation = useBlockUser();
  // Emoji reactions (group): live-synced pills + full picker, mirroring the DM path.
  // A single long-press instance opens the picker for the pressed message (mobile);
  // hover opens it on desktop.
  const { byMessage: reactionsByMessage, toggle: toggleReaction } =
    useGroupMessageReactions(activeGroupId);
  const [reactionPickerId, setReactionPickerId] = useState<string | null>(null);
  const reactionTheme = useResolvedColorScheme();
  const pendingLongPressId = useRef<string | null>(null);
  const reactionLongPress = useLongPress(() => {
    if (pendingLongPressId.current != null) {
      haptic.light();
      setReactionPickerId(pendingLongPressId.current);
    }
  });
  const [inputValue, setInputValue] = useState('');
  /** Message currently being reported via the shared report dialog. */
  const [reportMessageId, setReportMessageId] = useState<string | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const loadingOlderRef = useRef(false);
  const composerInputRef = useRef<HTMLInputElement>(null);
  // See ChatPanel.tsx: a tap-opened share menu must not steal focus from the
  // composer, or iOS drops the keyboard.
  const plusOpenedByPointer = useRef(false);
  const plusItemSelected = useRef(false);
  // Conversation starters for the empty state - pre-fill the composer (never
  // auto-send) so a resident can post with one tap or edit first.
  const starters = useMemo<string[]>(() => {
    const raw = t('messaging:group.starters', { returnObjects: true });
    return Array.isArray(raw) ? (raw as string[]) : [];
  }, [t]);
  const applyStarter = (text: string) => {
    setInputValue(text);
    composerInputRef.current?.focus();
  };

  // ── Rich share: checklist item + Instagram handle ──────────────────────────
  const [shareItemOpen, setShareItemOpen] = useState(false);

  const handleShareChecklistItem = async (meta: Extract<GroupMessageMetadata, { type: 'checklist_item' }>) => {
    await sendMessage(t('messaging:group.share.itemMessage', { name: meta.name }), meta);
  };

  const handleShareInstagram = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('profiles')
      .select('instagram_username')
      .eq('id', user.id)
      .maybeSingle();
    const handle = ((data?.instagram_username ?? '') as string).trim().replace(/^@+/, '');
    if (!handle) {
      toast(t('messaging:group.share.igMissingTitle'), {
        description: t('messaging:group.share.igMissingBody'),
      });
      return;
    }
    await sendMessage(t('messaging:group.share.igMessage', { handle }), { type: 'instagram', username: handle });
  };
  // Per-message anchors so the pinned banner can scroll its message into view.
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const jumpToMessage = (messageId: string) => {
    messageRefs.current.get(messageId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handlePin = async (messageId: string) => {
    try {
      await pin(messageId);
    } catch {
      toast.error(t('messaging:group.pinUpdateError'));
    }
  };

  const handleUnpin = async () => {
    try {
      await unpin();
    } catch {
      toast.error(t('messaging:group.pinUpdateError'));
    }
  };

  const handleDelete = async (messageId: string) => {
    const ok = await deleteMessage(messageId);
    if (!ok) {
      toast.error(t('messaging:group.deleteError'));
    }
  };

  const handleBlock = async (senderId: string) => {
    try {
      await blockMutation.mutateAsync(senderId);
      toast(t('messaging:group.blockSuccess'));
    } catch {
      toast.error(t('messaging:group.blockError'));
    }
  };

  const group = useMemo(() => {
    if (activeGroup) return activeGroup;
    if (!activeGroupId) return null;
    return groups.find((g) => g.id === activeGroupId) ?? null;
  }, [activeGroup, activeGroupId, groups]);

  // Collapse consecutive same-sender messages (within 5 min) into runs: the
  // avatar shows once at the bottom of a run, the sender name once at the top.
  // Attachment + system messages break runs so they stay self-contained.
  const groupFlags = useMemo(
    () =>
      computeMessageGrouping(
        messages.map((m) => ({
          senderId: m.sender_id ?? null,
          createdAt: m.created_at,
          breaksRun: !!m.metadata || (m.sender_id ?? null) === null,
        }))
      ),
    [messages]
  );

  useEffect(() => {
    if (activeGroupId) void markRead();
  }, [activeGroupId, markRead]);

  useEffect(() => {
    if (loadingOlderRef.current) return;
    const el = messagesScrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  const handleLoadOlder = async () => {
    const viewport = messagesScrollRef.current;
    const previousHeight = viewport?.scrollHeight ?? 0;
    loadingOlderRef.current = true;
    const loaded = await loadOlderMessages();
    requestAnimationFrame(() => {
      if (loaded && viewport) viewport.scrollTop += viewport.scrollHeight - previousHeight;
      loadingOlderRef.current = false;
    });
  };

  // Keep the latest message pinned above the composer when the keyboard opens (iMessage-style).
  useEffect(() => {
    if (!keyboardOpen) return;
    const el = messagesScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    const t = setTimeout(() => {
      const node = messagesScrollRef.current;
      if (node) node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
    }, 220);
    return () => clearTimeout(t);
  }, [keyboardOpen]);

  if (!user) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        {t('messaging:group.signInPrompt')}
      </div>
    );
  }

  if (!activeGroupId) {
    return (
      <EmptyState
        className="flex-1"
        icon={Users}
        title={t('messaging:group.emptyTitle')}
        description={t('messaging:group.emptySubtitle')}
      />
    );
  }

  const handleSend = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!inputValue.trim() || isSending) return;
    const text = inputValue;
    setInputValue('');
    const ok = await sendMessage(text);
    if (!ok) setInputValue(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-3">
        {isMobile && onBack && (
          <Button type="button" variant="ghost" size="icon" onClick={onBack} aria-label={t('messaging:group.backToGroups')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex shrink-0 -space-x-2">
            {(group?.members ?? []).slice(0, 3).map((m) => (
              <Avatar key={m.id} className="h-8 w-8 border-2 border-background">
                {m.avatar_url ? <AvatarImage src={m.avatar_url} alt={m.full_name ?? ''} /> : null}
                <AvatarFallback className="bg-muted text-xs text-muted-foreground">
                  {(m.full_name ?? '?').charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-foreground">{group?.name ?? t('messaging:group.fallbackName')}</h2>
            <p className="text-xs text-muted-foreground">
              {t('messaging:group.memberCount', { count: group?.memberCount ?? 0 })}
            </p>
          </div>
        </div>
      </header>

      {pinned && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-accent/40 px-4 py-2">
          <Pin className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <button
            type="button"
            onClick={() => jumpToMessage(pinned.id)}
            className="min-w-0 flex-1 text-left"
            aria-label={t('messaging:group.jumpToPinned')}
          >
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-primary">
              {pinned.senderName
                ? t('messaging:group.pinnedBy', { name: pinned.senderName })
                : t('messaging:group.pinnedLabel')}
            </span>
            <span className="block truncate text-xs text-muted-foreground">{pinned.content}</span>
          </button>
          {isRA && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => void handleUnpin()}
              disabled={isMutating}
              aria-label={t('messaging:group.unpinMessage')}
            >
              <PinOff className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      <MessageScroller
        ref={messagesScrollRef}
        viewportClassName="flex flex-col min-h-0 flex-1 overflow-y-auto px-4 py-4"
        jumpButtonClassName="bottom-24"
        jumpLabel={t('messaging:group.jumpToLatest', { defaultValue: 'Scroll to latest messages' })}
      >
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">{t('messaging:group.loadingMessages')}</div>
        ) : messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-2 pb-20 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10" aria-hidden>
              <Sparkles className="h-7 w-7 text-muted-foreground" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-base font-semibold text-foreground">{t('messaging:group.emptyHeadline')}</p>
              <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
                {t('messaging:group.emptyBody', { name: group?.name ?? t('messaging:group.fallbackName') })}
              </p>
            </div>
            {starters.length > 0 && (
              <div
                className="flex max-w-md flex-wrap justify-center gap-2"
                role="group"
                aria-label={t('messaging:group.startersLabel')}
              >
                {starters.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    onClick={() => applyStarter(starter)}
                    className="rounded-full border border-border bg-card px-3.5 py-1.5 text-sm font-medium text-foreground shadow-raised transition-colors hover:border-border hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-auto pb-24">
            {hasOlderMessages && (
              <div className="flex justify-center pb-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isLoadingOlder}
                  onClick={() => void handleLoadOlder()}
                >
                  {isLoadingOlder ? 'Loading…' : 'Load older messages'}
                </Button>
              </div>
            )}
            {messages.map((msg, i) => {
              // sender_id is NULL for system (welcome) messages; types.ts lags
              // the nullable migration, so treat it as possibly absent.
              const senderId: string | null = msg.sender_id ?? null;
              const isSystem = senderId === null;
              const isMine = senderId === user.id;
              const senderIsRA = senderId !== null && raUserIds.has(senderId);
              const isPinned = pinned?.id === msg.id;
              const canModerate = isRA || isAdmin;
              const showMenu = canModerate || (!isMine && !isSystem);
              const senderName = isSystem
                ? t('messaging:group.systemSender')
                : msg.sender?.full_name ?? 'Unknown';
              // Run flags: name at the top of a run, avatar at the bottom, tight
              // spacing within a run and a larger gap between runs.
              const { isFirstInGroup, isLastInGroup } = groupFlags[i] ?? {
                isFirstInGroup: true,
                isLastInGroup: true,
              };
              const showAvatar = !isMine && isLastInGroup;
              const showName = !isMine && isFirstInGroup;
              return (
                <div
                  key={msg.id}
                  ref={(el) => {
                    if (el) messageRefs.current.set(msg.id, el);
                    else messageRefs.current.delete(msg.id);
                  }}
                  className={cn(
                    'group/message flex items-center gap-2',
                    isMine ? 'justify-end' : 'justify-start',
                    i === 0 ? '' : isFirstInGroup ? 'mt-3' : 'mt-0.5'
                  )}
                >
                  {!isMine &&
                    (showAvatar ? (
                      <Avatar className="h-8 w-8 shrink-0 self-end">
                        {msg.sender?.avatar_url ? (
                          <AvatarImage src={msg.sender.avatar_url} alt={msg.sender?.full_name ?? ''} />
                        ) : null}
                        <AvatarFallback className="bg-muted text-xs text-muted-foreground">
                          {senderName.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    ) : (
                      // Spacer keeps bubbles aligned when the avatar is collapsed.
                      <div className="w-8 shrink-0" aria-hidden />
                    ))}
                  <div className={cn('flex max-w-[75%] flex-col', isMine ? 'items-end' : 'items-start')}>
                    {showName && (
                      <span className="mb-0.5 flex items-center gap-1 px-1 text-xs text-muted-foreground">
                        {senderName}
                        {senderIsRA && (
                          <span className="rounded bg-primary/10 px-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                            {t('messaging:group.raBadge')}
                          </span>
                        )}
                      </span>
                    )}
                    <div
                      className={cn(
                        'group/message relative',
                        (reactionsByMessage.get(String(msg.id))?.length ?? 0) > 0 && reactionOverlapClass,
                      )}
                      onPointerDown={(e) => {
                        pendingLongPressId.current = msg.id;
                        reactionLongPress.onPointerDown(e);
                      }}
                      onPointerMove={reactionLongPress.onPointerMove}
                      onPointerUp={reactionLongPress.onPointerUp}
                      onPointerLeave={reactionLongPress.onPointerLeave}
                      onPointerCancel={reactionLongPress.onPointerCancel}
                      onContextMenu={(e) => e.preventDefault()}
                    >
                      {msg.metadata ? (
                        <div className={cn(isPinned && 'rounded-xl ring-1 ring-primary/40')}>
                          <GroupMessageAttachment metadata={msg.metadata} isMine={isMine} />
                        </div>
                      ) : (
                        <BubbleContent className={cn(bubbleSurfaceClass(isMine), isPinned && 'ring-1 ring-primary/40')}>
                          {msg.content}
                        </BubbleContent>
                      )}
                    {!isSystem && (
                      <MessageReactions
                        align={isMine ? 'end' : 'start'}
                        theme={reactionTheme}
                        reactions={reactionsByMessage.get(String(msg.id)) ?? []}
                        onToggle={(emoji) => {
                          // Mirrors ChatPanel exactly — same interaction class,
                          // same feel. See the contract in src/lib/haptics.ts.
                          haptic.light();
                          void toggleReaction(msg.id, emoji);
                        }}
                        open={reactionPickerId === msg.id}
                        onOpenChange={(o) => setReactionPickerId(o ? msg.id : null)}
                      />
                    )}
                    </div>
                  </div>
                  {showMenu && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 self-center text-muted-foreground"
                          disabled={isMutating}
                          aria-label={t('messaging:group.messageActions')}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align={isMine ? 'end' : 'start'}>
                        {isRA && (isPinned ? (
                          <DropdownMenuItem onClick={() => void handleUnpin()}>
                            <PinOff className="mr-2 h-4 w-4" />
                            {t('messaging:group.unpinMessage')}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => void handlePin(msg.id)}>
                            <Pin className="mr-2 h-4 w-4" />
                            {t('messaging:group.pinMessage')}
                          </DropdownMenuItem>
                        ))}
                        {!isMine && !isSystem && (
                          <DropdownMenuItem onClick={() => setReportMessageId(msg.id)}>
                            <Flag className="mr-2 h-4 w-4" />
                            {t('messaging:group.reportMessage')}
                          </DropdownMenuItem>
                        )}
                        {!isMine && !isSystem && senderId && (
                          <DropdownMenuItem onClick={() => void handleBlock(senderId)}>
                            <UserX className="mr-2 h-4 w-4" />
                            {t('messaging:group.blockSender', { name: senderName })}
                          </DropdownMenuItem>
                        )}
                        {canModerate && !isSystem && (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => void handleDelete(msg.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t('messaging:group.deleteMessage')}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </MessageScroller>

      <form
        onSubmit={(e) => void handleSend(e)}
        className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 border-t border-border/30 bg-card/70 px-4 pt-3 backdrop-blur-xl supports-[backdrop-filter]:bg-card/55"
        style={{
          paddingBottom: isMobile
            ? mobileFooterPaddingBottom
            : 'calc(var(--keyboard-height, 0px) + max(0.75rem, env(safe-area-inset-bottom, 0px)))',
        }}
      >
        {/* modal={false} + the focus suppression below keep the iOS keyboard up
            when the share menu opens — see the note in ChatPanel.tsx. */}
        <DropdownMenu
          modal={false}
          onOpenChange={(open) => {
            if (!open) { plusOpenedByPointer.current = false; return; }
            plusItemSelected.current = false;
            if (plusOpenedByPointer.current) {
              requestAnimationFrame(() => composerInputRef.current?.focus());
            }
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground"
              disabled={isSending}
              onPointerDown={() => { plusOpenedByPointer.current = true; }}
              onMouseDown={(e) => e.preventDefault()}
              aria-label={t('messaging:group.share.menuLabel')}
            >
              <Plus className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="top"
            onFocusOutside={(e) => { if (plusOpenedByPointer.current) e.preventDefault(); }}
            onCloseAutoFocus={(e) => {
              if (!plusOpenedByPointer.current) return;
              e.preventDefault();
              if (!plusItemSelected.current) composerInputRef.current?.focus();
            }}
          >
            <DropdownMenuItem onSelect={() => { plusItemSelected.current = true; setShareItemOpen(true); }}>
              <Package className="mr-2 h-4 w-4" />
              {t('messaging:group.share.itemAction')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { plusItemSelected.current = true; void handleShareInstagram(); }}>
              <Instagram className="mr-2 h-4 w-4" />
              {t('messaging:group.share.igAction')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Input
          ref={composerInputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={onMessageInputFocus}
          onBlur={onMessageInputBlur}
          placeholder={t('messaging:group.composerPlaceholder', { name: group?.name ?? t('messaging:group.composerFallback') })}
          className="flex-1"
          disabled={isSending}
        />
        {/* One slot, one control: send is always mounted and simply disables on
            an empty draft, so the composer never reflows as the user types. */}
        <Button type="submit" size="icon" haptic="light" disabled={!inputValue.trim() || isSending} aria-label={t('messaging:composer.sendLabel')}>
          <Send className="h-4 w-4" />
        </Button>
      </form>

      <ShareChecklistItemDialog
        open={shareItemOpen}
        onOpenChange={setShareItemOpen}
        onPick={(meta) => void handleShareChecklistItem(meta)}
      />

      <ReportContentDialog
        open={reportMessageId !== null}
        onOpenChange={(open) => {
          if (!open) setReportMessageId(null);
        }}
        contentType="group_message"
        contentId={reportMessageId}
        contentLabel={t('messaging:group.reportLabel')}
      />
    </div>
  );
}
