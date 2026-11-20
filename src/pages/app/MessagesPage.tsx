import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { PullToRefreshIndicator } from '@/components/ui/pull-to-refresh-indicator';
import { SwipeRow } from '@/components/ui/swipe-row';
import { usePullToRefreshQueries } from '@/hooks/usePullToRefresh';
import { useNavigate, useSearchParams } from 'react-router';
import { Plus, MessageCircle, ChevronRight, Trash2, ArrowLeft, Users } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '@/hooks/useAuth';
import { useChat } from '@/contexts/ChatContext';
import { supabase } from '@/integrations/supabase/client';
import { ChatPanel } from '@/components/ChatPanel';
import { BookmarkToggle } from '@/components/app/BookmarkToggle';
import { DmUserSearchModal } from '@/components/messages/DmUserSearchModal';
import { GroupChatPanel } from '@/components/messages/GroupChatPanel';
import { CreateGroupModal } from '@/components/messages/CreateGroupModal';
import { useModalOverlay } from '@/contexts/ModalOverlayContext';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useUniversity } from '@/contexts/UniversityContext';
import { ConversationListSkeleton } from '@/components/skeletons/ContentSkeletons';
import { CorkboardIllustration } from '@/components/illustrations/DormIllustrations';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ProfileAvatarFallback } from '@/components/profile/ProfileAvatarFallback';
import { useGroupConversations } from '@/hooks/useGroupConversations';
import { useGroupUnread } from '@/hooks/useGroupUnread';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { acceptConversationRequest, declineConversationRequest } from '@/lib/conversationRequests';
import { isValidUuid } from '@/lib/sanitize';
import { cn } from '@/lib/utils';
import { LIST_CONTAINER_ATTR, LIST_ROW_ATTR, handleListArrowKeys } from '@/lib/listKeyboard';
import { useDmIncomingUnreadRealtime } from '@/hooks/useDmIncomingUnreadRealtime';
import { useConversations, isConversationUnread, type ConversationWithOther } from '@/hooks/useConversations';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { useIsMobile } from '@/hooks/use-mobile';
import { apiPost } from '@/lib/apiPost';

type InboxMode = 'dms' | 'groups';

/**
 * The inbox segmented control encodes a COMPOSITE of two independent states -
 * `inboxMode` (dms | groups) x `dmSubTab` (chats | requests). Radix `Tabs` was
 * evaluated and deliberately rejected here (T3.5): Tabs owns its panels and
 * unmounts the inactive one, which would tear the DM list down (losing its
 * realtime subscriptions and scroll position) on every chats<->requests switch,
 * and both DM sub-tabs render the SAME panel anyway. `ToggleGroup` is the right
 * primitive for a segmented control that only *selects*, so the composite is
 * flattened to one value string here and split back apart in onValueChange.
 */
type InboxTab = 'dms:chats' | 'dms:requests' | 'groups';

const inboxTabTriggerClass =
  'h-auto min-w-0 gap-0 rounded-full px-3.5 py-1.5 text-xs font-medium text-muted-foreground ' +
  'hover:bg-transparent hover:text-foreground data-[state=on]:bg-card ' +
  'data-[state=on]:text-foreground data-[state=on]:shadow-raised';

function readInitialInboxMode(groupsEnabled: boolean): InboxMode {
  if (!groupsEnabled) return 'dms';
  if (typeof window === 'undefined') return 'dms';
  const p = new URLSearchParams(window.location.search);
  if (p.get('mode') === 'groups') return 'groups';
  const gid = p.get('group');
  if (gid && isValidUuid(gid)) return 'groups';
  return 'dms';
}

function readInitialGroupId(groupsEnabled: boolean): string | null {
  if (!groupsEnabled) return null;
  if (typeof window === 'undefined') return null;
  const p = new URLSearchParams(window.location.search);
  const gid = p.get('group');
  return gid && isValidUuid(gid) ? gid : null;
}

function readInitialConversationId(): string | null {
  if (typeof window === 'undefined') return null;
  const p = new URLSearchParams(window.location.search);
  const cid = p.get('conversation');
  return cid && isValidUuid(cid) ? cid : null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MessagesPage() {
  const { t } = useTranslation();
  const { university } = useUniversity();
  const { user, isLoading, isAdmin } = useAuth();
  const { showGroupChats, showBuildingChats } = useFeatureFlags();
  // Building/floor chats are Phase 1: groups mode must open for them even while
  // general group chats stay gated (creation stays behind showGroupChats).
  const groupsEnabled = showGroupChats || showBuildingChats;
  const { setIsOpen: setWidgetOpen } = useChat();
  const navigate = useNavigate();
  const goBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const modalOverlay = useModalOverlay();

  const [dmSubTab, setDmSubTab] = useState<'chats' | 'requests'>('chats');
  const [selectedConvId, setSelectedConvId] = useState<string | null>(readInitialConversationId);
  const [inboxMode, setInboxMode] = useState<InboxMode>(() => readInitialInboxMode(groupsEnabled));
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(() =>
    readInitialGroupId(groupsEnabled),
  );
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const { conversations, isLoading: loadingConvs, error: convError, reload: reloadConversations } =
    useConversations(user?.id);
  const [showDmSearch, setShowDmSearch] = useState(false);
  const [messageInputFocused, setMessageInputFocused] = useState(false);
  const [conversationToDelete, setConversationToDelete] = useState<string | null>(null);

  // `groups` (all memberships) still resolves deep-linked threads, but the
  // Groups tab lists only user-made groups - community (building/floor) rooms
  // live on /community now.
  const { groups, messageGroups, isLoading: groupsLoading } = useGroupConversations({ enabled: groupsEnabled });
  const { unreadCount: groupUnreadCount } = useGroupUnread({ enabled: groupsEnabled });

  const effectiveInboxMode: InboxMode = groupsEnabled ? inboxMode : 'dms';
  const inboxTab: InboxTab = effectiveInboxMode === 'groups' ? 'groups' : `dms:${dmSubTab}`;

  const userParamResolvedRef = useRef(false);

  // Pull-to-refresh for the inbox. Declared up here with the other top-level
  // hooks because renderDmList() sits behind early returns — the list scrolls in
  // its OWN overflow-y-auto box, not the window, which was the audit's one real
  // blocker to adopting usePullToRefresh here as written (window.scrollY is
  // permanently 0 on this page, so the pull would have engaged mid-list). The
  // hook grew a scrollRef for exactly this case.
  const dmListRef = useRef<HTMLDivElement | null>(null);
  const { pull, refreshing } = usePullToRefreshQueries(
    ['conversations', 'group-conversations'],
    { scrollRef: dmListRef },
  );

  const dmIncomingViewingRef = useRef<(id: string) => boolean>(() => false);
  dmIncomingViewingRef.current = (id) => selectedConvId === id;

  useDmIncomingUnreadRealtime({
    userId: user?.id,
    activeConversationId: selectedConvId,
    viewingRef: dmIncomingViewingRef,
  });

  // Close the floating widget when the messages page opens (prevents mobile overlay)
  useEffect(() => {
    setWidgetOpen(false);
  }, [setWidgetOpen]);

  useEffect(() => {
    if (!isMobile) {
      modalOverlay?.setHideBottomNav(false);
      return;
    }
    const hide =
      (effectiveInboxMode === 'dms' && (selectedConvId !== null || messageInputFocused)) ||
      (effectiveInboxMode === 'groups' && (selectedGroupId !== null || messageInputFocused));
    modalOverlay?.setHideBottomNav(hide);
  }, [isMobile, effectiveInboxMode, selectedConvId, selectedGroupId, messageInputFocused, modalOverlay]);

  useEffect(() => {
    if (groupsEnabled) return;
    setInboxMode('dms');
    setSelectedGroupId(null);
    setCreateGroupOpen(false);
  }, [groupsEnabled]);

  useEffect(() => {
    if (selectedConvId === null && selectedGroupId === null) {
      setMessageInputFocused(false);
    }
  }, [selectedConvId, selectedGroupId]);

  useEffect(() => {
    return () => {
      modalOverlay?.setHideBottomNav(false);
    };
  }, [modalOverlay]);

  // ── URL sync: ?mode=, ?group=, ?conversation= (preserves other params e.g. ?user=) ──

  useEffect(() => {
    if (!user?.id) return;

    const next = new URLSearchParams(searchParams);
    if (effectiveInboxMode === 'groups') {
      next.delete('conversation');
      next.set('mode', 'groups');
      if (selectedGroupId) next.set('group', selectedGroupId);
      else next.delete('group');
    } else {
      next.delete('mode');
      next.delete('group');
      if (selectedConvId) next.set('conversation', selectedConvId);
      else next.delete('conversation');
    }

    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [effectiveInboxMode, selectedConvId, selectedGroupId, user?.id, searchParams, setSearchParams]);

  // ── URL param: ?compose=1 (command palette "Start a message") ─────────────

  useEffect(() => {
    if (searchParams.get('compose') !== '1') return;
    setShowDmSearch(true);
    const next = new URLSearchParams(searchParams);
    next.delete('compose');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // ── URL param: ?user=<id> ─────────────────────────────────────────────────

  useEffect(() => {
    const userIdFromUrl = searchParams.get('user');
    if (
      !user?.id ||
      !userIdFromUrl ||
      !isValidUuid(userIdFromUrl) ||
      userIdFromUrl === user.id ||
      userParamResolvedRef.current
    )
      return;
    if (searchParams.get('conversation')) {
      userParamResolvedRef.current = true;
      return;
    }
    userParamResolvedRef.current = true;

    const me = user.id;
    const them = userIdFromUrl;

    void (async () => {
      const { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .or(
          `and(participant_1.eq.${me},participant_2.eq.${them}),and(participant_1.eq.${them},participant_2.eq.${me})`
        )
        .limit(1);

      if (existing?.[0]?.id) {
        setSelectedConvId(existing[0].id);
        setSearchParams({ conversation: existing[0].id }, { replace: true });
        return;
      }

      const p1 = me < them ? me : them;
      const p2 = me < them ? them : me;
      const { data: created, error } = await supabase
        .from('conversations')
        .insert({ participant_1: p1, participant_2: p2, initiated_by: me, status: 'pending' })
        .select('id')
        .single();

      if (!error && created?.id) {
        setSelectedConvId(created.id);
        setDmSubTab('chats');
        setSearchParams({ conversation: created.id }, { replace: true });
        void reloadConversations();
        if (!isAdmin) {
          void apiPost('/api/notify-message-request', { conversationId: created.id }).catch((e) => console.warn('[MessagesPage] notify-message-request failed:', e));
        }
      }
    })();
  }, [user?.id, searchParams, setSearchParams, reloadConversations, isAdmin]);

  // ── Auto-set sub-tab when conversation is selected ────────────────────────

  useEffect(() => {
    if (!selectedConvId) return;
    const conv = conversations.find((c) => c.id === selectedConvId);
    if (!conv) return;
    const isRequest = conv.status === 'pending' && conv.initiated_by !== user?.id;
    setDmSubTab(isRequest ? 'requests' : 'chats');
  }, [selectedConvId, conversations, user?.id]);

  // ── Filtered conversation lists ───────────────────────────────────────────

  const chatsConvs = useMemo(
    () =>
      conversations.filter(
        (c) => c.status === 'accepted' || (c.status === 'pending' && c.initiated_by === user?.id)
      ),
    [conversations, user?.id]
  );

  const requestConvs = useMemo(
    () =>
      conversations.filter(
        (c) => c.status === 'pending' && c.initiated_by !== user?.id
      ),
    [conversations, user?.id]
  );

  // ── Desktop auto-open ─────────────────────────────────────────────────────
  // Desktop shows list and detail side by side, so an empty "Select a
  // conversation" pane is a phone-ism — open the most recent chat once the
  // list loads. Runs at most once and never overrides a URL-restored
  // (?conversation=/?user=) or user-made selection; mobile keeps list-first.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    // Direct width check too: useIsMobile is false on the first render pass
    // even on phones, and this must never fire under the md breakpoint.
    if (isMobile || window.innerWidth < 768 || autoOpenedRef.current || loadingConvs) return;
    autoOpenedRef.current = true;
    if (effectiveInboxMode !== 'dms' || selectedConvId || selectedGroupId) return;
    if (searchParams.get('user')) return;
    if (chatsConvs.length > 0) setSelectedConvId(chatsConvs[0].id);
  }, [isMobile, loadingConvs, effectiveInboxMode, selectedConvId, selectedGroupId, chatsConvs, searchParams]);

  // ── Accept / Decline DM requests ─────────────────────────────────────────

  const handleAcceptRequest = useCallback(
    async (convId: string) => {
      const { error } = await acceptConversationRequest(convId);
      if (error) return;
      await reloadConversations();
      setDmSubTab('chats');
    },
    [reloadConversations]
  );

  const handleDeclineRequest = useCallback(
    async (convId: string) => {
      if (!user?.id) return;
      await declineConversationRequest(convId);
      if (selectedConvId === convId) setSelectedConvId(null);
      await reloadConversations();
    },
    [user?.id, selectedConvId, reloadConversations]
  );

  const handleHideConversation = useCallback(
    async (convId: string) => {
      if (!user?.id) return;
      const { error } = await supabase.from('conversations').delete().eq('id', convId);
      if (error) console.error('[MessagesPage] Delete conversation error:', error);
      if (selectedConvId === convId) setSelectedConvId(null);
      await reloadConversations();
    },
    [user?.id, selectedConvId, reloadConversations]
  );

  const handleSetInboxMode = useCallback((mode: InboxMode) => {
    if (mode === 'groups' && !groupsEnabled) return;
    setInboxMode(mode);
    if (mode === 'groups') {
      setSelectedConvId(null);
    } else {
      setSelectedGroupId(null);
    }
  }, [groupsEnabled]);

  // ── Derived state ─────────────────────────────────────────────────────────

  const selectedConv: ConversationWithOther | null =
    conversations.find((c) => c.id === selectedConvId) ?? null;
  const mobileShowThread =
    isMobile &&
    ((effectiveInboxMode === 'dms' && selectedConvId !== null) ||
      (effectiveInboxMode === 'groups' && selectedGroupId !== null));

  // iMessage-style slide + left-edge swipe back to the inbox.
  const threadDragControls = useDragControls();
  const closeMobileThread = useCallback(() => {
    setSelectedConvId(null);
    setSelectedGroupId(null);
  }, []);

  // ── Loading / auth guards ─────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  // ── Sidebar conversation list renderers ───────────────────────────────────

  const renderDmList = () => {
    const list = dmSubTab === 'chats' ? chatsConvs : requestConvs;

    if (loadingConvs) {
      return (
        <ConversationListSkeleton />
      );
    }

    if (convError) {
      return (
        <div className="flex-1 flex items-center justify-center py-12 px-6">
          <button
            type="button"
            onClick={() => void reloadConversations()}
            className="text-sm text-destructive font-medium text-center rounded-lg px-4 py-3 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('messaging:page.loadErrorRetry')}
          </button>
        </div>
      );
    }

    if (list.length === 0) {
      return (
        <EmptyState
          className="flex-1"
          icon={MessageCircle}
          illustration={dmSubTab === 'chats' ? <CorkboardIllustration /> : undefined}
          title={dmSubTab === 'requests' ? t('messaging:page.noRequests') : t('messaging:page.noConversations')}
          description={dmSubTab === 'chats' ? t('messaging:page.startChatHint', { school: university.shortName }) : undefined}
        />
      );
    }

    return (
      <div
        ref={dmListRef}
        className="relative flex-1 overflow-y-auto min-h-0"
        // P8.2: bounds the arrow-walk (see listKeyboard.ts) — attribute only, so
        // this scroll container stays a non-interactive div.
        {...{ [LIST_CONTAINER_ATTR]: '' }}
      >
        <PullToRefreshIndicator pull={pull} refreshing={refreshing} />
        {list.map((c) => {
          const unread = isConversationUnread(c, user.id);
          const isActive = selectedConvId === c.id;
          const displayName = c.otherName?.trim() || 'Student';
          const updatedAt = c.updated_at
            ? formatDistanceToNow(new Date(c.updated_at), { addSuffix: true })
            : '';

          const deleteLabel =
            c.status === 'pending' && c.initiated_by === user?.id
              ? t('messaging:page.retractRequestAria')
              : t('messaging:chat.deleteConversation');

          const rowBody = (
            <div
              role="button"
              tabIndex={0}
              {...{ [LIST_ROW_ATTR]: '' }}
              onClick={() => {
                setSelectedConvId(c.id);
              }}
              onKeyDown={(e) => {
                // P8.2: Up/Down walk the list first (focus only, no activation).
                if (handleListArrowKeys(e)) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedConvId(c.id);
                }
              }}
              className={cn(
                // P8.5 desktop density: py-3 is the thumb-sized row; a pointer at lg+
                // gets more conversations per screen instead of more whitespace.
                'w-full text-left py-3 px-4 flex items-center gap-3 border-b border-border/50 transition-colors hover:bg-muted/50 cursor-pointer group lg:py-2.5',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-malachite-600',
                isActive && 'bg-muted/70'
              )}
            >
              <Avatar className="h-11 w-11 shrink-0 rounded-full overflow-hidden">
                <AvatarImage src={c.otherAvatarUrl ?? undefined} alt="" className="object-cover" />
                <ProfileAvatarFallback size="md" name={displayName} />
              </Avatar>
              <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                <div className="flex items-center justify-between gap-2 w-full">
                  <span className="font-semibold text-sm text-foreground truncate">{displayName}</span>
                  <div className="shrink-0 flex items-center gap-1.5">
                    {unread && <span className="h-2 w-2 rounded-full bg-foreground" />}
                    <span className="text-xs text-muted-foreground">{updatedAt}</span>
                  </div>
                </div>
                <span
                  className={cn(
                    'text-xs truncate',
                    c.status === 'accepted' && c.initiated_by === user.id && !c.last_message?.trim()
                      ? 'text-foreground font-medium'
                      : unread
                        ? 'text-foreground font-semibold'
                        : 'text-muted-foreground'
                  )}
                >
                  {c.status === 'pending' && c.initiated_by === user.id
                    ? t('messaging:chat.pending')
                    : c.status === 'accepted' && c.initiated_by === user.id && !c.last_message?.trim()
                      ? t('messaging:chat.acceptancePreview')
                      : c.last_message || t('messaging:chat.noMessagesYet')}
                </span>
              </div>
              {/* Desktop keeps its hover trash affordance. On mobile the row now
                  shows the chevron AND carries SwipeRow's always-focusable delete
                  button — before this, mobile had NO way to delete a conversation
                  from the list at all, so adding the swipe without it would have
                  shipped a gesture-only destructive action. */}
              {isMobile ? (
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <button
                  type="button"
                  aria-label={deleteLabel}
                  onClick={(e) => {
                    e.stopPropagation();
                    setConversationToDelete(c.id);
                  }}
                  // `opacity-0` alone meant a keyboard user could TAB to this delete
                  // button and never see it — hover was the only thing that revealed
                  // it. Hover stays an additive pointer affordance; focus now reveals
                  // it too, so the action is never hover-gated.
                  className="shrink-0 p-1.5 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-red-500 hover:bg-red-50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          );

          // Desktop already has an accessible delete control (the hover trash
          // above), so it does NOT get wrapped — SwipeRow would render a second,
          // duplicate button announcing the same action. Mobile had none, so
          // there SwipeRow owns the action and supplies both the gesture and the
          // always-focusable button behind it.
          return isMobile ? (
            <SwipeRow
              key={c.id}
              actionLabel={deleteLabel}
              actionIcon={<Trash2 className="h-4 w-4" />}
              onAction={() => setConversationToDelete(c.id)}
            >
              {rowBody}
            </SwipeRow>
          ) : (
            <div key={c.id}>{rowBody}</div>
          );
        })}
      </div>
    );
  };

  // ── Sidebar (tabs + list) ─────────────────────────────────────────────────

  const renderSidebar = () => (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Messages is the one mobile route that opts out of the shell's `pt-12`
          (it is a fixed-viewport, internally-scrolling layout), so it has to
          clear the mobile-web top pill itself - otherwise this row's back arrow
          and "new message" button render UNDER the floating pill and are dead to
          touch. Native has no top bar on this route, so the offset is web-only. */}
      <div className="shrink-0 px-4 pt-4 [.platform-web_&]:pt-14 md:[.platform-web_&]:pt-4 pb-3 border-b border-border/50">
        <div className="flex items-center gap-2 mb-3">
          {isMobile && (
            <button
              type="button"
              onClick={goBack}
              className="-ml-1 shrink-0 rounded-full p-1.5 text-foreground hover:bg-muted/80 transition-colors"
              aria-label={t('actions.back')}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <h1 className="min-w-0 flex-1 text-xl font-bold text-foreground">{t('labels.messages')}</h1>
          <BookmarkToggle />
          {(effectiveInboxMode === 'dms' || showGroupChats) && (
            <button
              type="button"
              onClick={() =>
                effectiveInboxMode === 'groups' ? setCreateGroupOpen(true) : setShowDmSearch(true)
              }
              aria-label={effectiveInboxMode === 'groups' ? t('messaging:createGroup.title') : t('messaging:page.newMessageAria')}
              // KEEP: primary CTA of the messages screen (start a new chat)
              className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-full bg-malachite-800 text-white shadow-raised transition-colors hover:bg-malachite-900"
            >
              <Plus className="h-5 w-5" strokeWidth={2.5} />
            </button>
          )}
        </div>

        {/* One segmented control instead of two stacked tab bars. Composite
            value (see InboxTab above) - ToggleGroup, not Tabs, on purpose. */}
        <ToggleGroup
          type="single"
          value={inboxTab}
          onValueChange={(v) => {
            // Deselect-guard: this control always has exactly one active tab.
            if (!v) return;
            if (v === 'groups') {
              handleSetInboxMode('groups');
              return;
            }
            handleSetInboxMode('dms');
            setDmSubTab(v === 'dms:requests' ? 'requests' : 'chats');
          }}
          className="inline-flex gap-0 rounded-full bg-muted p-1"
        >
          <ToggleGroupItem value="dms:chats" className={inboxTabTriggerClass}>
            {t('messaging:page.tabs.chats')}
          </ToggleGroupItem>
          {groupsEnabled && (
            <ToggleGroupItem value="groups" className={inboxTabTriggerClass}>
              {t('messaging:page.tabs.groups')}
              {groupUnreadCount > 0 && (
                <span className="ml-1.5 inline-flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                  {groupUnreadCount}
                </span>
              )}
            </ToggleGroupItem>
          )}
          {(requestConvs.length > 0 || (effectiveInboxMode === 'dms' && dmSubTab === 'requests')) && (
            <ToggleGroupItem value="dms:requests" className={inboxTabTriggerClass}>
              {t('messaging:page.tabs.requests', { n: requestConvs.length })}
            </ToggleGroupItem>
          )}
        </ToggleGroup>
      </div>

      {effectiveInboxMode === 'dms' && (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{renderDmList()}</div>
      )}

      {groupsEnabled && effectiveInboxMode === 'groups' && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {groupsLoading ? (
            <>
              <span className="sr-only" role="status">{t('messaging:page.loadingGroups')}</span>
              <ConversationListSkeleton rows={4} />
            </>
          ) : messageGroups.length === 0 ? (
            <EmptyState
              icon={Users}
              title={t('messaging:page.noGroupsTitle')}
              description={
                showGroupChats
                  ? t('messaging:page.noGroupsHintCreate')
                  : t('messaging:page.noGroupsHintJoin')
              }
              action={
                showGroupChats ? (
                  <Button type="button" size="sm" onClick={() => setCreateGroupOpen(true)}>
                    <Plus className="mr-1 h-4 w-4" />
                    {t('messaging:createGroup.title')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div
              className="min-h-0 flex-1 divide-y divide-border overflow-y-auto"
              // Same P8.2 arrow-walk as the DM list — groups are the same inbox.
              {...{ [LIST_CONTAINER_ATTR]: '' }}
            >
              {messageGroups.map((group) => {
                const isSelected = selectedGroupId === group.id;
                const memberPreview = group.members.slice(0, 3);
                return (
                  <button
                    key={group.id}
                    type="button"
                    {...{ [LIST_ROW_ATTR]: '' }}
                    onKeyDown={handleListArrowKeys}
                    onClick={() => setSelectedGroupId(group.id)}
                    className={cn(
                      // P8.5 desktop density (matches the DM row).
                      'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent lg:py-2.5',
                      isSelected && 'bg-muted'
                    )}
                  >
                    <div className="flex shrink-0 -space-x-2">
                      {memberPreview.map((m) => (
                        <Avatar key={m.id} className="h-8 w-8 border-2 border-background">
                          {m.avatar_url ? <AvatarImage src={m.avatar_url} alt={m.full_name ?? ''} /> : null}
                          <AvatarFallback className="bg-muted text-xs text-muted-foreground">
                            {(m.full_name ?? '?').charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      ))}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">{group.name}</p>
                        {group.isUnread && (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label={t('messaging:chat.unread')} />
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {group.last_message ??
                          t('messaging:group.memberCount', { count: group.memberCount })}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(group.updated_at), { addSuffix: false })}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <CreateGroupModal
            open={createGroupOpen}
            onOpenChange={setCreateGroupOpen}
            onGroupCreated={(newGroupId) => setSelectedGroupId(newGroupId)}
          />
        </div>
      )}
    </div>
  );

  // ── Thread view ───────────────────────────────────────────────────────────

  const renderThreadView = () => {
    if (groupsEnabled && effectiveInboxMode === 'groups') {
      return (
        <GroupChatPanel
          activeGroupId={selectedGroupId}
          onClearGroup={() => setSelectedGroupId(null)}
          isMobile={isMobile}
          onBack={
            isMobile
              ? () => {
                  setSelectedGroupId(null);
                }
              : undefined
          }
          onMessageInputFocus={() => setMessageInputFocused(true)}
          onMessageInputBlur={() => setMessageInputFocused(false)}
          activeGroup={groups.find((g) => g.id === selectedGroupId) ?? null}
        />
      );
    }

    if (selectedConvId) {
      const isRequest =
        selectedConv?.status === 'pending' && selectedConv?.initiated_by !== user.id;
      const isInitiatedByMe = selectedConv?.initiated_by === user.id;

      return (
        <ChatPanel
          activeConversationId={selectedConvId}
          onSelectConversation={setSelectedConvId}
          onClearConversation={() => setSelectedConvId(null)}
          isMobile={isMobile}
          hideSidebar
          fullScreen
          conversationStatus={selectedConv?.status as 'pending' | 'accepted' | undefined}
          isInitiatedByMe={isInitiatedByMe}
          onAcceptRequest={
            isRequest ? () => void handleAcceptRequest(selectedConvId) : undefined
          }
          onDeclineRequest={
            isRequest ? () => void handleDeclineRequest(selectedConvId) : undefined
          }
          onBack={isMobile ? () => setSelectedConvId(null) : undefined}
          onMessageInputFocus={() => setMessageInputFocused(true)}
          onMessageInputBlur={() => setMessageInputFocused(false)}
        />
      );
    }

    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-6 gap-3">
        <MessageCircle className="h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm text-center font-medium text-foreground">{t('messaging:page.selectConversationTitle')}</p>
        <p className="text-sm text-center max-w-sm">
          {t('messaging:page.selectConversationBody')}
        </p>
        <button
          type="button"
          onClick={() => setShowDmSearch(true)}
          // KEEP: empty-state variant of the same start-a-chat action
          className="rounded-full px-6 py-2.5 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {t('messaging:chat.startConversation')}
        </button>
      </div>
    );
  };

  // ── Mobile layout ─────────────────────────────────────────────────────────

  if (isMobile) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-card pt-[env(safe-area-inset-top)]">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Inbox stays mounted underneath so the thread can slide over it. */}
          <div className="absolute inset-0 flex min-h-0 flex-col overflow-hidden">{renderSidebar()}</div>
          <AnimatePresence initial={false}>
            {mobileShowThread && (
              <motion.div
                key="thread"
                className="absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-card shadow-[-10px_0_30px_rgba(0,0,0,0.10)]"
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', stiffness: 420, damping: 38 }}
                drag="x"
                dragListener={false}
                dragControls={threadDragControls}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={{ left: 0, right: 0.85 }}
                onDragEnd={(_, info) => {
                  if (info.offset.x > 90 || info.velocity.x > 480) closeMobileThread();
                }}
              >
                {renderThreadView()}
                {/* Left-edge grab strip - only edge swipes start the back drag, so message
                    scrolling and taps are unaffected. */}
                <div
                  aria-hidden
                  className="absolute inset-y-0 left-0 z-30 w-6"
                  style={{ touchAction: 'pan-y' }}
                  onPointerDown={(e) => threadDragControls.start(e)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {showDmSearch && (
          <DmUserSearchModal
            isOpen={showDmSearch}
            onClose={() => setShowDmSearch(false)}
            currentUserId={user.id}
            onConversationSelected={(convId) => {
              setSelectedConvId(convId);
              setDmSubTab('chats');
              setShowDmSearch(false);
              void reloadConversations();
            }}
          />
        )}
      </div>
    );
  }

  // ── Desktop layout ────────────────────────────────────────────────────────

  return (
    <div className="h-full min-h-0 overflow-hidden bg-card flex">
      {/* Sidebar */}
      <aside className="w-72 min-w-[220px] max-w-xs lg:w-80 border-r border-border shrink-0 h-full overflow-hidden">
        {renderSidebar()}
      </aside>

      {/* Thread panel */}
      <div className="flex-1 min-w-0 h-full overflow-hidden flex flex-col">
        {renderThreadView()}
      </div>

      {showDmSearch && (
        <DmUserSearchModal
          isOpen={showDmSearch}
          onClose={() => setShowDmSearch(false)}
          currentUserId={user.id}
          onConversationSelected={(convId) => {
            setSelectedConvId(convId);
            setDmSubTab('chats');
            setShowDmSearch(false);
            void reloadConversations();
          }}
        />
      )}

      {/* Delete / Retract conversation confirmation (sidebar list) */}
      {(() => {
        const convToDelete = conversations.find((c) => c.id === conversationToDelete);
        const isRetractPending = !!(
          conversationToDelete &&
          convToDelete?.status === 'pending' &&
          convToDelete?.initiated_by === user?.id
        );
        return (
          <AlertDialog open={!!conversationToDelete} onOpenChange={(open) => !open && setConversationToDelete(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{isRetractPending ? t('messaging:chat.retractRequestTitle') : t('messaging:chat.deleteConversationTitle')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {isRetractPending
                    ? t('messaging:chat.requestDeleteDesc')
                    : t('messaging:chat.deleteConversationDesc')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (conversationToDelete) {
                      void handleHideConversation(conversationToDelete);
                      setConversationToDelete(null);
                    }
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isRetractPending ? t('messaging:chat.retract') : t('actions.delete')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        );
      })()}

    </div>
  );
}
