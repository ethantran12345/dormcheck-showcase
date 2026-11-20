import { useState, useEffect, useRef, useCallback, Component, ErrorInfo, ReactNode, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import i18n from '@/i18n';
import { studentDisplayName } from '@/lib/studentDisplayName';
import { useKeyboardOpen } from '@/hooks/useKeyboardInset';
import { ArrowLeft, MessageCircle, MoreVertical, Trash2, Flag, ArrowUp, UserPlus, Plus, Tag, AtSign, Image as ImageIcon, Camera, Loader2, Mic, Square, BarChart3 } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { useUniversity } from '@/contexts/UniversityContext';
import { CorkboardIllustration } from '@/components/illustrations/DormIllustrations';
import { formatDistanceToNow, format } from 'date-fns';
import { useChat } from '@/contexts/ChatContext';
import { supabase } from '@/integrations/supabase/client';
import { apiPost } from '@/lib/apiPost';
import { useAuth } from '@/hooks/useAuth';
import { useAnalytics } from '@/hooks/useAnalytics';
import { Input } from '@/components/ui/input';
import { Button, buttonVariants } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
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
import { MessageBubble, bubbleSurfaceClass } from '@/components/chat/MessageBubble';
import { MessagePreviewCard } from '@/components/chat/MessagePreviewCard';
import { MessageScroller } from '@/components/chat/MessageScroller';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { MessageGroup, Message, MessageContent, MessageFooter } from '@/components/ui/message';
import { MessageReactions, reactionOverlapClass } from '@/components/chat/MessageReactions';
import { ShareListingDialog, type ShareableListing } from '@/components/messages/ShareListingDialog';
import { ShareSocialDialog } from '@/components/messages/ShareSocialDialog';
import { useMessageReactions } from '@/hooks/useMessageReactions';
import { useLongPress } from '@/hooks/useLongPress';
import { useResolvedColorScheme } from '@/hooks/useResolvedColorScheme';
import { computeMessageGrouping, type GroupingInput } from '@/lib/messageGrouping';
import { appendMessageById, byCreatedAtAsc } from '@/lib/messageDedup';
import { isPendingId, nextPendingId, optimisticWrite } from '@/lib/optimistic';
import { BlockUserButton } from '@/components/safety/BlockUserButton';
import { ReportContentDialog } from '@/components/ReportContentDialog';
import { PaymentSafetyNotice } from '@/components/messages/PaymentSafetyNotice';
import { DmAudioMessage } from '@/components/chat/DmAudioMessage';
import { DmPollCard } from '@/components/chat/DmPollCard';
import { toast } from 'sonner';
import {
  contactShareConfirmKey,
  hasContactShareSignal,
  hasPaymentRiskSignal,
  paymentWarningDismissKey,
} from '@/lib/scamPatterns';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { buildListingShareContent, parseMessageContext } from '@/lib/messageContext';
import { parseDmAttachmentMetadata, type DmMessageMetadata } from '@/types/dmMessageMeta';
import { deleteDmPhoto, dmPhotoPath, uploadDmPhoto, readImageSize } from '@/lib/dmPhotos';
import { audioDurationLabel, deleteDmAudio, uploadDmAudio } from '@/lib/dmAudio';
import { makeDmPoll } from '@/lib/dmPolls';
import { useDmPollVotes } from '@/hooks/useDmPollVotes';
import { ImageRejectedError } from '@/lib/imageModeration';
import { useImageUpload, imageUploadErrorCode } from '@/hooks/useImageUpload';
import { CollaborateModal } from '@/components/collaborate/CollaborateModal';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { useRoommateGroup } from '@/hooks/useRoommateGroup';
import { useConversations, isConversationUnread, type ConversationWithOther } from '@/hooks/useConversations';
import { cn, devLog } from '@/lib/utils';
import { sanitizeText } from '@/lib/sanitize';
import { haptic } from '@/lib/haptics';
import { canShareContent, shareContent } from '@/lib/nativeShare';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Database, TablesUpdate } from '@/integrations/supabase/types';
import type { PostgrestError } from '@supabase/supabase-js';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** Log Supabase error with hint for 400s (e.g. missing column). */
function logConversationsError(context: string, err: PostgrestError) {
  const msg = err.message ?? '';
  const hint = (err as PostgrestError & { hint?: string }).hint ?? '';
  const details = err.details ?? '';
  const likelyColumn = /column "([^"]+)"|"([^"]+)" does not exist|unknown column/i.exec(msg + hint + details);
  devLog(`${context} failed.`, {
    message: msg,
    code: err.code,
    details,
    hint,
    ...(likelyColumn && {
      likelyMissingOrWrongColumn: likelyColumn[1] ?? likelyColumn[2],
      expectedColumns: 'participant_1, participant_2, participant_1_last_read, participant_2_last_read',
    }),
    full: err,
  });
}

export { isConversationUnread, type ConversationWithOther } from '@/hooks/useConversations';

// `metadata` is real in the database (migration 20260825000000) but not yet in
// the generated types — the repo's convention is a localized widening here plus
// a cast at the insert, not a premature types.ts regen.
type MessageRow = Database['public']['Tables']['messages']['Row'] & {
  metadata?: unknown;
  report_uuid?: string | null;
};

/** Display label for conversation list and headers. */
function getOtherDisplayLabel(c: ConversationWithOther): string {
  return studentDisplayName(c.otherName);
}

function getOtherDisplayInitial(name: string | null | undefined): string {
  return studentDisplayName(name).slice(0, 1).toUpperCase();
}

function resolveOtherDisplayName(...names: (string | null | undefined)[]): string {
  return studentDisplayName(...names);
}

/** Preview text for the conversation list. When the sender's request was just accepted, show acceptance copy in green until they send. */
function getConversationPreview(
  c: ConversationWithOther & { status?: string; initiated_by?: string | null },
  userId: string | undefined
): { text: string; isAcceptance: boolean } {
  const noMessages = i18n.t('messaging:chat.noMessagesYet');
  if (!userId) return { text: c.last_message || noMessages, isAcceptance: false };
  const status = c.status ?? 'accepted';
  const initiatedByMe = c.initiated_by === userId;
  if (status === 'accepted' && initiatedByMe) {
    // Show acceptance until sender sends (we clear last_message on accept so it stays empty until they send)
    const hasSentSinceAcceptance = !!c.last_message?.trim();
    return hasSentSinceAcceptance
      ? { text: c.last_message!, isAcceptance: false }
      : { text: i18n.t('messaging:chat.acceptancePreview'), isAcceptance: true };
  }
  if (status === 'pending' && initiatedByMe) {
    return { text: i18n.t('messaging:chat.pending'), isAcceptance: false };
  }
  return { text: c.last_message || noMessages, isAcceptance: false };
}

class MessageListErrorBoundary extends Component<{ children: ReactNode }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Message list error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="py-8 text-center text-sm text-muted-foreground">
          <p>{i18n.t('messaging:chat.messageListError')}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function EmptyConversationsState({
  compact,
  onStartConversation,
}: {
  compact?: boolean;
  onStartConversation?: () => void;
}) {
  const { t } = useTranslation();
  const { university } = useUniversity();
  const navigate = useNavigate();
  return (
    <EmptyState
      className={cn('flex-1', compact ? 'min-h-64' : 'min-h-[300px]')}
      icon={MessageCircle}
      illustration={<CorkboardIllustration />}
      // The full sentence used to be the TITLE; it is guidance, so it moves under
      // a short headline.
      title={t('messaging:chat.noMessagesYet')}
      description={t('messaging:chat.emptyInbox', { school: university.shortName })}
      action={
        <button
          type="button"
          onClick={onStartConversation ?? (() => navigate('/marketplace'))}
          className="rounded-full px-6 py-2.5 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {t('messaging:chat.startConversation')}
        </button>
      }
    />
  );
}

interface ChatPanelProps {
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onClearConversation?: () => void;
  compact?: boolean;
  fullScreen?: boolean;
  isMobile?: boolean;
  onClose?: () => void;
  onBack?: () => void;
  onMessageInputFocus?: () => void;
  onMessageInputBlur?: () => void;
  /** Hide the conversation list sidebar - thread-only mode used by MessagesPage */
  hideSidebar?: boolean;
  /** Status of the active conversation for showing accept/decline UI */
  conversationStatus?: 'pending' | 'accepted';
  /** Whether the current user initiated this conversation (affects request UI) */
  isInitiatedByMe?: boolean;
  /** Accept a pending DM request */
  onAcceptRequest?: () => void;
  /** Decline a pending DM request */
  onDeclineRequest?: () => void;
  /** When provided, "Start a Conversation" opens this (e.g. user search) instead of navigating to marketplace */
  onOpenUserSearch?: () => void;
  /** Optional footer rendered at the bottom of the conversation list sidebar (e.g. "New Message" button) */
  sidebarFooter?: ReactNode;
  /** When this value changes, reloadConversations is called (e.g. parent Realtime subscription fired) */
  realtimeRefreshTrigger?: number;
  /** When true, delete confirmation is shown inside the panel (no portal/modal overlay). Used by ChatWidget. */
  inlineDeleteConfirm?: boolean;
  /** Burst unread counts while the thread is not active (e.g. from useDmIncomingUnreadRealtime); widget sidebar badges */
  burstUnreadByConversation?: Record<string, number>;
}

export function ChatPanel({ activeConversationId, onSelectConversation, onClearConversation, compact, fullScreen, isMobile, onBack, onMessageInputFocus, onMessageInputBlur, hideSidebar, conversationStatus, isInitiatedByMe, onAcceptRequest, onDeclineRequest, onOpenUserSearch, sidebarFooter, realtimeRefreshTrigger, inlineDeleteConfirm = false, burstUnreadByConversation }: ChatPanelProps) {
  const { t } = useTranslation();
  const { user, isLoading } = useAuth();
  const { trackAction } = useAnalytics();
  // The messages pane already sits at the keyboard top (bottom: --keyboard-height), so the
  // composer must NOT also add --keyboard-height. It only needs the home-indicator inset when
  // the keyboard is DOWN; when it's up the keyboard covers that, so drop it to sit flush.
  const keyboardOpen = useKeyboardOpen();
  const mobileFooterPaddingBottom = keyboardOpen
    ? '0.375rem'
    : 'max(0.75rem, env(safe-area-inset-bottom, 0px))';
  const { requestInputFocus, clearRequestInputFocus } = useChat();
  const messageInputRef = useRef<HTMLInputElement>(null);
  // Whether the composer "+" menu was opened by a tap (vs the keyboard). Only a
  // tap-open needs the focus suppression that keeps the iOS keyboard up.
  const plusOpenedByPointer = useRef(false);
  // A menu item that hands off to a picker/dialog owns focus from here; only a
  // dismissal-without-selection should pull focus back to the composer.
  const plusItemSelected = useRef(false);
  const { conversations, isLoading: conversationsLoading, error: conversationsError, reload: reloadConversations } =
    useConversations(user?.id);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [olderMessagesLoading, setOlderMessagesLoading] = useState(false);
  const prependingMessagesRef = useRef(false);
  // Emoji reactions (DM): live-synced pills + full picker. `reactionPickerId` lifts
  // the picker's open state so a long-press on a bubble can open it (mobile), while
  // hover opens it on desktop. A single long-press instance reads the pressed id
  // from a ref (hooks can't be called per-message inside the render loop).
  const { byMessage: reactionsByMessage, toggle: toggleReaction } =
    useMessageReactions(activeConversationId);
  const { byMessage: pollVotesByMessage, vote: voteInPoll, currentUserId: pollVoterId } =
    useDmPollVotes(activeConversationId);
  const [reactionPickerId, setReactionPickerId] = useState<number | null>(null);
  const reactionTheme = useResolvedColorScheme();
  const pendingLongPressId = useRef<number | null>(null);
  const reactionLongPress = useLongPress(() => {
    if (pendingLongPressId.current != null) {
      haptic.light();
      setReactionPickerId(pendingLongPressId.current);
    }
  });
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  // Composer "+" → share one of my marketplace listings into this thread.
  const [shareListingOpen, setShareListingOpen] = useState(false);
  // Composer "+" → share my own Instagram / Snapchat handle.
  const [shareSocialOpen, setShareSocialOpen] = useState(false);
  // A single reported message at a time: the uuid handle from `messages.report_uuid`
  // (content_reports.content_id is uuid; messages.id is a bigint).
  const [reportMessageId, setReportMessageId] = useState<string | null>(null);
  // Composer "+" → photo library / camera. `isCameraAvailable` latches false on
  // a device with no camera (Simulator, most desktops), so the capture entry is
  // hidden rather than offered and then failing.
  const { pickOne, isCameraAvailable } = useImageUpload();
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [recordingAudio, setRecordingAudio] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const discardRecordingRef = useRef(false);
  const recordingStartedAtRef = useRef(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [pollComposerOpen, setPollComposerOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);

  useEffect(() => () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    discardRecordingRef.current = true;
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  // Message actions on the long-press bar use the native iOS activity sheet when
  // the shell exposes it, then Web Share elsewhere. An absent action is better
  // than a visible button that silently does nothing.
  const canShareMessage = canShareContent();
  const copyMessage = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      haptic.light();
      toast.success(t('messaging:actions.copied'));
    } catch {
      toast.error(t('messaging:actions.copyFailed'));
    }
    setReactionPickerId(null);
  }, [t]);
  const shareMessage = useCallback(async (text: string) => {
    try {
      await shareContent({ text });
    } catch {
      // A dismissed share sheet rejects too — never report that as a failure.
    }
    setReactionPickerId(null);
  }, []);
  const [activeOtherDisplayName, setActiveOtherDisplayName] = useState<string | null>(null);
  const [otherProfileLoading, setOtherProfileLoading] = useState(false);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  // Typing indicator (DM only): ephemeral Realtime BROADCAST channel, separate
  // from the postgres_changes message channel above (different name so they
  // never collide, and all `.on()` handlers are registered before subscribe()).
  const [otherTyping, setOtherTyping] = useState(false);
  const typingChannelRef = useRef<RealtimeChannel | null>(null);
  const typingClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentRef = useRef(0);
  const conversationsRef = useRef<ConversationWithOther[]>([]);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);

  const [sidebarWidth, setSidebarWidth] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null);
  const [showDeclineConfirm, setShowDeclineConfirm] = useState(false);
  const [showRetractConfirm, setShowRetractConfirm] = useState(false);
  const [reportUserOpen, setReportUserOpen] = useState(false);
  const [paymentWarningDismissed, setPaymentWarningDismissed] = useState(false);
  const [confirmRoommateOpen, setConfirmRoommateOpen] = useState(false);

  const activeConversation = conversations.find((c) => c.id === activeConversationId);

  // "Confirm as roommate" bridge (DM -> confirmed roommate group): shown on
  // accepted conversations when the other party isn't already in the group.
  const { showConfirmedRoommates } = useFeatureFlags();
  const { roommateGroup } = useRoommateGroup(showConfirmedRoommates ? user?.id : null);

  // When parent does not pass status/initiated (e.g. mini widget), derive from active conversation
  const activeConvMeta = activeConversation as (ConversationWithOther & { status?: string; initiated_by?: string | null }) | undefined;
  const effectiveConversationStatus = (conversationStatus ?? activeConvMeta?.status ?? 'accepted') as 'pending' | 'accepted';
  const effectiveIsInitiatedByMe = isInitiatedByMe ?? (!!user?.id && activeConvMeta?.initiated_by === user.id);

  const canConfirmRoommate =
    showConfirmedRoommates &&
    effectiveConversationStatus === 'accepted' &&
    !!activeConversation?.otherUserId &&
    !(roommateGroup?.members.some((m) => m.id === activeConversation.otherUserId) ?? false);

  const MIN_SIDEBAR_PX = 150;
  const MIN_MAIN_PX = 150;
  const FULLSCREEN_MIN_RATIO = 0.15;
  const FULLSCREEN_MAX_RATIO = 0.5;
  const SMALL_WIDGET_DEFAULT_RATIO = 0.4;
  const FULLSCREEN_DEFAULT_RATIO = 0.25;

  useEffect(() => {
    if (sidebarWidth === null) {
      setSidebarWidth(fullScreen ? FULLSCREEN_DEFAULT_RATIO : SMALL_WIDGET_DEFAULT_RATIO);
    } else if (fullScreen) {
      // When switching to full-screen, clamp to valid range if needed
      const clamped = Math.max(FULLSCREEN_MIN_RATIO, Math.min(FULLSCREEN_MAX_RATIO, sidebarWidth));
      if (clamped !== sidebarWidth) {
        setSidebarWidth(clamped);
      }
    }
  }, [fullScreen, sidebarWidth]);

  // Auto-focus the composer when opened via a "Message" CTA. The keyboard was primed on a
  // hidden input during the tap (see primeKeyboard); focusing the real input here transfers
  // focus so the keyboard stays up - works on iOS where a detached focus would be ignored.
  useEffect(() => {
    if (!requestInputFocus || !activeConversationId) return;
    clearRequestInputFocus();
    const raf = requestAnimationFrame(() => messageInputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [requestInputFocus, activeConversationId, clearRequestInputFocus]);

  const handleGutterMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizingRef.current = true;
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) {
      isResizingRef.current = false;
      return;
    }
    const container = splitContainerRef.current;
    if (!container) return;

    const onMove = (e: MouseEvent) => {
      if (!isResizingRef.current || !container) return;
      const rect = container.getBoundingClientRect();
      const width = rect.width;
      const x = e.clientX - rect.left;
      
      let minRatio: number;
      let maxRatio: number;
      
      if (fullScreen) {
        minRatio = FULLSCREEN_MIN_RATIO;
        maxRatio = FULLSCREEN_MAX_RATIO;
      } else {
        minRatio = MIN_SIDEBAR_PX / width;
        maxRatio = (width - MIN_MAIN_PX) / width;
      }
      
      const ratio = Math.min(maxRatio, Math.max(minRatio, x / width));
      setSidebarWidth(ratio);
    };
    
    const onUp = () => {
      isResizingRef.current = false;
      setIsDragging(false);
    };
    
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      isResizingRef.current = false;
    };
  }, [isDragging, fullScreen]);

  // Payment-safety interstitial (P0.7): dismissed state is per conversation
  // per session; shows again in a new session or another risky thread.
  useEffect(() => {
    if (!activeConversationId) return;
    try {
      setPaymentWarningDismissed(
        sessionStorage.getItem(paymentWarningDismissKey(activeConversationId)) === '1',
      );
    } catch {
      setPaymentWarningDismissed(false);
    }
  }, [activeConversationId]);

  const dismissPaymentWarning = () => {
    setPaymentWarningDismissed(true);
    if (activeConversationId) {
      try {
        sessionStorage.setItem(paymentWarningDismissKey(activeConversationId), '1');
      } catch {
        /* ignore */
      }
    }
  };

  const showPaymentWarning =
    !paymentWarningDismissed && (messages ?? []).some((m) => hasPaymentRiskSignal(m.content));

  // Fallback: fetch other user's name from profiles when conversation has no otherName (e.g. RLS or missed in batch)
  useEffect(() => {
    if (!activeConversationId || !activeConversation?.otherUserId) {
      setActiveOtherDisplayName(null);
      setOtherProfileLoading(false);
      return;
    }
    const conv = conversationsRef.current.find((c) => c.id === activeConversationId);
    if (conv?.otherName) {
      setActiveOtherDisplayName(conv.otherName);
      setOtherProfileLoading(false);
      return;
    }
    setActiveOtherDisplayName(null);
    setOtherProfileLoading(true);
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('public_profiles')
        .select('full_name')
        .eq('id', activeConversation.otherUserId)
        .maybeSingle();
      if (!cancelled) {
        setActiveOtherDisplayName(data?.full_name ?? null);
        setOtherProfileLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeConversationId, activeConversation?.otherUserId, activeConversation?.otherName]);

  const scrollToBottom = useCallback(() => {
    const el = messagesScrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const markConversationAsRead = useCallback(
    async (convId: string) => {
      if (!user?.id) return;
      const conv = conversationsRef.current.find((x) => x.id === convId);
      if (!conv) return;
      const isParticipant1 = conv.participant_1 === user.id;
      const now = new Date().toISOString();
      // Literal key (not computed) so the update payload types against conversations.
      const patch: TablesUpdate<'conversations'> = isParticipant1
        ? { participant_1_last_read: now }
        : { participant_2_last_read: now };
      const { error } = await supabase
        .from('conversations')
        .update(patch)
        .eq('id', convId);
      if (error) logConversationsError('[ChatPanel] mark as read update', error);
      reloadConversations();
    },
    [user?.id, reloadConversations]
  );

  const markReadRef = useRef(markConversationAsRead);
  markReadRef.current = markConversationAsRead;

  const performDeleteConversation = useCallback(
    async (convId: string) => {
      if (!user?.id) return;
      const { error } = await supabase.from('conversations').delete().eq('id', convId);
      if (error) {
        console.error('[ChatPanel] delete conversation error:', error);
        return;
      }
      setDeletingConversationId(null);
      await reloadConversations();
      if (activeConversationId === convId && onClearConversation) {
        onClearConversation();
      }
    },
    [user?.id, reloadConversations, activeConversationId, onClearConversation]
  );

  const handleDeleteClick = useCallback((e: React.MouseEvent, convId: string) => {
    e.stopPropagation();
    setDeletingConversationId(convId);
  }, []);

  const handleConfirmDeleteConversation = useCallback(() => {
    if (deletingConversationId) {
      void performDeleteConversation(deletingConversationId);
      setDeletingConversationId(null);
    }
  }, [deletingConversationId, performDeleteConversation]);

  const handleConfirmDecline = useCallback(() => {
    onDeclineRequest?.();
    setShowDeclineConfirm(false);
  }, [onDeclineRequest]);

  // When parent (e.g. widget) signals a conversation change, refresh list
  useEffect(() => {
    if (typeof realtimeRefreshTrigger !== 'number') return;
    reloadConversations();
  }, [realtimeRefreshTrigger, reloadConversations]);

  useEffect(() => {
    if (activeConversationId && user?.id) {
      markConversationAsRead(activeConversationId);
    }
  }, [activeConversationId, user?.id, markConversationAsRead]);

  // Refresh profile names when active conversation changes so "Unknown" clears once RLS allows
  useEffect(() => {
    if (activeConversationId && user?.id) {
      reloadConversations();
    }
  }, [activeConversationId, user?.id, reloadConversations]);

  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      setMessagesLoading(false);
      setHasOlderMessages(false);
      return;
    }

    let cancelled = false;

    async function loadMessages() {
      setMessagesLoading(true);
      try {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', activeConversationId)
          .order('created_at', { ascending: false })
          .limit(50);

        if (cancelled) return;
        if (error) {
          console.error('Messages fetch error:', error);
          setMessages([]);
        } else {
          const rows = (data as MessageRow[]) ?? [];
          setMessages((previous) => {
            const latest = rows.slice().reverse();
            if (previous.length <= 50) return latest;
            const byId = new Map(previous.map((row) => [row.id, row]));
            latest.forEach((row) => byId.set(row.id, row));
            return Array.from(byId.values()).sort(byCreatedAtAsc);
          });
          setHasOlderMessages(rows.length === 50);
        }
      } catch {
        if (!cancelled) setMessages([]);
      } finally {
        if (!cancelled) setMessagesLoading(false);
      }
    }

    loadMessages();

    // Realtime: new messages in this conversation so thread updates without refresh
    const channel = supabase
      .channel(`chat-panel-msgs-${activeConversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${activeConversationId}`,
        },
        (payload) => {
          const newRow = payload.new as MessageRow;
          setMessages((prev) => appendMessageById<MessageRow>(prev, newRow, byCreatedAtAsc));
          if (newRow.sender_id !== user?.id) {
            markReadRef.current(activeConversationId);
            setOtherTyping(false); // their message landed — stop the dots
          }
        }
      );
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // A foreground/network reconnect can miss rows written between the old
        // socket closing and the new subscription becoming active. Reconcile
        // from the database on every successful join; id-based realtime append
        // remains the fast path between joins.
        void loadMessages();
      }
    });
    channelRef.current = channel;

    return () => {
      cancelled = true;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [activeConversationId, user?.id]);

  const loadOlderMessages = useCallback(async () => {
    const oldest = messages[0];
    if (!activeConversationId || !oldest || olderMessagesLoading) return;
    const viewport = messagesScrollRef.current;
    const previousHeight = viewport?.scrollHeight ?? 0;
    setOlderMessagesLoading(true);
    prependingMessagesRef.current = true;
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', activeConversationId)
        .lt('id', oldest.id)
        .order('id', { ascending: false })
        .limit(50);
      if (error) throw error;
      const older = ((data as MessageRow[]) ?? []).slice().reverse();
      setMessages((current) => {
        const ids = new Set(current.map((row) => row.id));
        return [...older.filter((row) => !ids.has(row.id)), ...current];
      });
      setHasOlderMessages(older.length === 50);
      requestAnimationFrame(() => {
        if (viewport) viewport.scrollTop += viewport.scrollHeight - previousHeight;
        prependingMessagesRef.current = false;
      });
    } catch (error) {
      prependingMessagesRef.current = false;
      console.error('[ChatPanel] older messages fetch error:', error);
      toast.error('Older messages could not be loaded.');
    } finally {
      setOlderMessagesLoading(false);
    }
  }, [activeConversationId, messages, olderMessagesLoading]);

  useEffect(() => {
    if (prependingMessagesRef.current) return;
    scrollToBottom();
  }, [messages, otherTyping, scrollToBottom]);

  // Typing indicator (DM): ephemeral BROADCAST channel keyed by conversation.
  // Kept separate from the postgres_changes message channel — all `.on()`
  // handlers are registered before subscribe() to avoid the "cannot add … after
  // subscribe" gotcha, and the name (`typing:<id>`) never collides with it.
  useEffect(() => {
    setOtherTyping(false);
    if (!activeConversationId || !user?.id) return;

    const channel = supabase.channel(`typing:${activeConversationId}`, {
      config: { broadcast: { self: false } },
    });
    const meId = user.id;
    channel
      .on('broadcast', { event: 'typing' }, (payload) => {
        if ((payload.payload as { userId?: string })?.userId === meId) return;
        setOtherTyping(true);
        if (typingClearTimerRef.current) clearTimeout(typingClearTimerRef.current);
        typingClearTimerRef.current = setTimeout(() => setOtherTyping(false), 3500);
      })
      .on('broadcast', { event: 'stop' }, (payload) => {
        if ((payload.payload as { userId?: string })?.userId === meId) return;
        if (typingClearTimerRef.current) clearTimeout(typingClearTimerRef.current);
        setOtherTyping(false);
      });
    channel.subscribe();
    typingChannelRef.current = channel;

    return () => {
      if (typingClearTimerRef.current) {
        clearTimeout(typingClearTimerRef.current);
        typingClearTimerRef.current = null;
      }
      supabase.removeChannel(channel);
      typingChannelRef.current = null;
      setOtherTyping(false);
    };
  }, [activeConversationId, user?.id]);

  // Throttled "I'm typing" emit (once per 1.5s of keypresses); auto-clears on the
  // receiver after ~3.5s idle. `stopTyping` fires an explicit clear on send.
  const notifyTyping = useCallback(() => {
    const ch = typingChannelRef.current;
    if (!ch || !user?.id) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < 1500) return;
    lastTypingSentRef.current = now;
    void ch.send({ type: 'broadcast', event: 'typing', payload: { userId: user.id } });
  }, [user?.id]);

  const stopTyping = useCallback(() => {
    const ch = typingChannelRef.current;
    if (!ch || !user?.id) return;
    lastTypingSentRef.current = 0;
    void ch.send({ type: 'broadcast', event: 'stop', payload: { userId: user.id } });
  }, [user?.id]);

  // When the keyboard opens the pane shrinks; keep the latest message pinned just above the
  // composer (iMessage-style) once the pane finishes its lift transition.
  useEffect(() => {
    if (!keyboardOpen) return;
    const el = messagesScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight; // instant, before the smooth pass
    const t = setTimeout(scrollToBottom, 220);
    return () => clearTimeout(t);
  }, [keyboardOpen, scrollToBottom]);

  const hasSentFirstMessage = effectiveConversationStatus === 'pending' && effectiveIsInitiatedByMe && messages.some((m) => m.sender_id === user?.id);

  /**
   * `overrideText` sends content the composer never held — today that is a
   * shared-listing card built from a context marker. It bypasses the draft
   * entirely: nothing is cleared on send, and a failed send does NOT dump the
   * marker blob into the user's composer the way a failed typed message
   * correctly restores their words.
   */
  const sendMessage = async (overrideText?: string, metadata?: DmMessageMetadata) => {
    const isOverride = typeof overrideText === 'string';
    const rawText = (isOverride ? overrideText : inputValue).trim();
    if (!rawText || !user?.id || !activeConversationId || sending) return false;
    if (effectiveConversationStatus === 'pending' && effectiveIsInitiatedByMe && hasSentFirstMessage) return false;
    const text = sanitizeText(rawText);
    if (!text) return false;

    // Outbound contact/payment share check (P1.11): the first risky send per
    // conversation asks for a deliberate second tap - never blocks.
    if (hasContactShareSignal(text)) {
      let confirmed = false;
      try {
        confirmed = sessionStorage.getItem(contactShareConfirmKey(activeConversationId)) === '1';
      } catch {
        confirmed = true; // storage unavailable: don't trap the user
      }
      if (!confirmed) {
        try {
          sessionStorage.setItem(contactShareConfirmKey(activeConversationId), '1');
        } catch {
          /* ignore */
        }
        toast.warning(t('messaging:safety.contactShareWarning'));
        return false;
      }
    }

    haptic.light();
    setSending(true);
    if (!isOverride) setInputValue('');
    stopTyping();
    // Captured before the insert: an empty thread means this send starts the conversation.
    const firstInConversation = messages.length === 0;

    // Paint the bubble NOW, before the insert is issued. The row carries a negative
    // pending id (real ids are positive bigints) so `appendMessageById` still keys
    // the list correctly and the realtime echo of our own INSERT can't collide with
    // it. `commit` swaps the pending row for the server's; `rollback` removes it and
    // hands the user's text back to the composer.
    const pendingRow = {
      id: nextPendingId(),
      conversation_id: activeConversationId,
      sender_id: user.id,
      content: text,
      created_at: new Date().toISOString(),
      metadata: metadata ?? null,
    } as MessageRow;

    let messagePersisted = false;
    try {
      const inserted = await optimisticWrite<MessageRow>({
        paint: () =>
          setMessages((prev) => appendMessageById<MessageRow>(prev, pendingRow, byCreatedAtAsc)),
        run: () =>
          supabase
            .from('messages')
            .insert({
              conversation_id: activeConversationId,
              sender_id: user.id,
              content: text,
              ...(metadata ? { metadata } : {}),
            } as never)
            .select('id, conversation_id, sender_id, content, created_at, metadata')
            .single() as PromiseLike<{ data: MessageRow | null; error: { message: string } | null }>,
        // Idempotent by id: the realtime postgres_changes echo of our own INSERT can
        // land before this resolves. Drop the pending row, then append the real one
        // only if the echo hasn't already added it — without the guard both writers
        // push the same row and the message renders twice.
        commit: (row) =>
          setMessages((prev) =>
            appendMessageById<MessageRow>(
              prev.filter((m) => m.id !== pendingRow.id),
              row,
              byCreatedAtAsc,
            ),
          ),
        rollback: () => {
          setMessages((prev) => prev.filter((m) => m.id !== pendingRow.id));
          if (!isOverride) setInputValue(rawText);
        },
        // A failed send used to be silent: the bubble vanished and the draft
        // reappeared with no explanation, which reads as the app eating the
        // message. Say so, and offer the retry inline with the notice — the
        // draft is already back in the composer, so retrying just re-runs send.
        onError: (e) => {
          console.error('Send message error:', e);
          toast.error(t('messaging:send.failed'), {
            action: {
              label: t('messaging:send.retry'),
              onClick: () => { void sendMessage(isOverride ? rawText : undefined); },
            },
          });
        },
      });

      if (!inserted) {
        setSending(false);
        return false;
      }
      messagePersisted = true;

      await trackAction('message_sent', {
        conversation_id: activeConversationId,
        first_in_conversation: firstInConversation,
        listing_context: false,
        source: 'chat_panel',
      });

      // Notify recipient (fire-and-forget). Recipient email, sender name and
      // cooldown are all resolved server-side from the verified JWT.
      const conv = conversationsRef.current.find((c) => c.id === activeConversationId);
      if (conv) {
        const recipientParticipant = conv.participant_1 === user.id ? 2 : 1;
        void apiPost('/api/notify-message', {
          conversationId: activeConversationId,
          recipientParticipant,
        }).catch((e) => console.warn('[ChatPanel] notify-message failed:', e));
      }

      const now = new Date().toISOString();
      const isParticipant1 = conv?.participant_1 === user.id;
      const patch: TablesUpdate<'conversations'> = {
        last_message: text,
        updated_at: now,
        ...(isParticipant1
          ? { participant_1_last_read: now }
          : { participant_2_last_read: now }),
      };
      const { error: updateErr } = await supabase
        .from('conversations')
        .update(patch)
        .eq('id', activeConversationId);
      if (updateErr) logConversationsError('[ChatPanel] send message conversation update', updateErr);

      reloadConversations();
    } catch (err) {
      // Everything past `optimisticWrite` is post-send bookkeeping (analytics, the
      // notify call, the conversation-summary update). The message itself is already
      // persisted and on screen, so a failure here must NOT restore the draft —
      // that would leave the user retyping a message they already sent.
      console.error('Send error:', err);
    }
    setSending(false);
    return messagePersisted;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const selectConversation = (id: string) => {
    onSelectConversation(id);
    markConversationAsRead(id);
  };

  // Guards: prevent crash
  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center', compact ? 'h-64' : 'min-h-[300px]')}>
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user?.id) {
    return (
      <div className={cn('flex items-center justify-center text-muted-foreground', compact ? 'h-64' : 'min-h-[300px]')}>
        <p className="text-sm">{t('messaging:chat.signInToView')}</p>
      </div>
    );
  }

  if (conversationsLoading) {
    return (
      <div className={cn('flex items-center justify-center', compact ? 'h-64' : 'min-h-[300px]')}>
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (conversationsError) {
    return (
      <div className={cn('flex flex-col items-center justify-center text-muted-foreground p-6', compact ? 'h-64' : 'min-h-[300px]')}>
        <p className="text-sm text-center">{t('messaging:chat.loadError')}</p>
      </div>
    );
  }

  if (!hideSidebar && !conversations.length && !activeConversationId) {
    return (
      <EmptyConversationsState compact={compact} onStartConversation={onOpenUserSearch} />
    );
  }

  const showSidebar = !isMobile && !hideSidebar && (fullScreen || compact);
  const showGutter = !isMobile && !hideSidebar && fullScreen && !compact;

  const renderInlineDeleteLayer = () =>
    inlineDeleteConfirm && deletingConversationId ? (
      <div
        className="absolute inset-0 z-20 flex flex-col bg-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="chat-inline-delete-title"
        aria-describedby="chat-inline-delete-desc"
      >
        <div className="flex-1 flex flex-col justify-center px-5 py-6 min-h-0 overflow-y-auto">
          <h2 id="chat-inline-delete-title" className="text-lg font-semibold text-foreground">
            {t('messaging:chat.deleteConversationTitle')}
          </h2>
          <p id="chat-inline-delete-desc" className="text-sm text-muted-foreground mt-2">
            {t('messaging:chat.deleteConversationDesc')}
          </p>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-8 sm:space-x-2">
            <button
              type="button"
              className={cn(buttonVariants({ variant: 'outline' }), 'w-full sm:w-auto mt-2 sm:mt-0')}
              onClick={() => setDeletingConversationId(null)}
            >
              {t('actions.cancel')}
            </button>
            <button
              type="button"
              className={cn(buttonVariants({ variant: 'destructive' }), 'w-full sm:w-auto')}
              onClick={handleConfirmDeleteConversation}
            >
              {t('actions.delete')}
            </button>
          </div>
        </div>
      </div>
    ) : null;

  const confirmDialogs = (
    <>
      {/* Delete conversation confirmation */}
      {!inlineDeleteConfirm && (
        <AlertDialog open={!!deletingConversationId} onOpenChange={(open) => !open && setDeletingConversationId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('messaging:chat.deleteConversationTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('messaging:chat.deleteConversationDesc')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmDeleteConversation}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {t('actions.delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Decline request confirmation */}
      <AlertDialog open={showDeclineConfirm} onOpenChange={setShowDeclineConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('messaging:chat.declineRequestTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('messaging:chat.requestDeleteDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDecline}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('messaging:chat.decline')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Retract request confirmation (pending DM initiated by me) */}
      <AlertDialog open={showRetractConfirm} onOpenChange={setShowRetractConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('messaging:chat.retractRequestTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('messaging:chat.requestDeleteDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (activeConversationId) {
                  void performDeleteConversation(activeConversationId);
                  setShowRetractConfirm(false);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('messaging:chat.retract')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  // Read receipt (DM only): id of my last outgoing message that the OTHER
  // participant has read. Derived from the conversation row's last_read (the
  // maintained signal) vs the message's created_at — NOT messages.is_read,
  // which is currently unwritten. Group chat gets no receipts (handled elsewhere).
  const readAnchorId = (() => {
    if (!user?.id || !activeConversation) return null;
    const isP1 = activeConversation.participant_1 === user.id;
    const raw = (activeConversation as unknown as Record<string, unknown>)[
      isP1 ? 'participant_2_last_read' : 'participant_1_last_read'
    ];
    if (!raw) return null;
    const otherReadAt = new Date(String(raw)).getTime();
    if (Number.isNaN(otherReadAt)) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.sender_id === user.id) {
        return new Date(m.created_at).getTime() <= otherReadAt ? m.id : null;
      }
    }
    return null;
  })();

  /**
   * Loading placeholder for the thread body.
   *
   * The old placeholder was a single centred 24x128 pill, so the swap to a real
   * thread replaced one small box with a full column of bubbles. These stand-ins
   * carry the same `py-3 space-y-3` rhythm and the same 75%-max bubble geometry as
   * `renderThread`, alternating sides, so the loaded thread lands on roughly the
   * shape already on screen instead of displacing it.
   */
  const renderThreadSkeleton = (): ReactNode => (
    <div aria-hidden="true" data-testid="message-thread-skeleton" className="space-y-3">
      {[
        { me: false, w: 'w-40' },
        { me: true, w: 'w-32' },
        { me: false, w: 'w-52' },
        { me: true, w: 'w-24' },
        { me: false, w: 'w-36' },
      ].map((row, i) => (
        <div key={i} className={cn('flex', row.me ? 'justify-end' : 'justify-start')}>
          <Skeleton className={cn('h-9 max-w-[75%] rounded-2xl', row.w)} />
        </div>
      ))}
    </div>
  );

  // Thread body: collapse same-sender runs (within 5 min) into MessageGroups —
  // tight spacing + a single trailing timestamp per run. Context-marker rows
  // (shared checklist items) render standalone and break runs.
  const renderThread = (): ReactNode[] => {
    const rows = (messages ?? []).filter((m) => m?.id);
    const parsed = rows.map((m) => parseMessageContext(m?.content ?? ''));
    const groupingInput: GroupingInput[] = rows.map((m, i) => ({
      senderId: m.sender_id ?? null,
      createdAt: m.created_at,
      breaksRun: !!parsed[i].marker,
    }));
    const flags = computeMessageGrouping(groupingInput);

    const out: ReactNode[] = [];
    let currentRun: ReactNode[] = [];
    const flushRun = (key: string) => {
      if (currentRun.length) {
        out.push(<MessageGroup key={`run-${key}`}>{currentRun}</MessageGroup>);
        currentRun = [];
      }
    };

    rows.forEach((msg, i) => {
      const isMe = msg.sender_id === user?.id;
      const { marker, introText } = parsed[i];
      const { isLastInGroup } = flags[i];

      if (marker) {
        flushRun(`m${i}`);
        out.push(
          <Fragment key={msg.id}>
            {introText ? <MessageBubble content={introText} isMe={isMe} /> : null}
            <MessagePreviewCard marker={marker} isMe={isMe} />
          </Fragment>
        );
        return;
      }

      const showRead = readAnchorId === msg.id;
      const showTime = isLastInGroup && !showRead;
      // Optimistically painted row: it is on screen before the insert resolves, so it
      // has no server id yet. Render it as a real bubble (that IS the point) but
      // slightly recessed, and withhold the affordances that need a persisted row —
      // you cannot react to, or long-press, a message the server has never seen.
      const pending = isPendingId(msg.id);
      const attachment = parseDmAttachmentMetadata(msg.metadata);
      const msgReactions = reactionsByMessage.get(String(msg.id)) ?? [];
      currentRun.push(
        <Message key={msg.id} align={isMe ? 'end' : 'start'}>
          <MessageContent>
            <Bubble
              align={isMe ? 'end' : 'start'}
              className={cn('max-w-[75%]', msgReactions.length > 0 && reactionOverlapClass)}
              onPointerDown={(e) => {
                if (pending) return;
                pendingLongPressId.current = msg.id;
                reactionLongPress.onPointerDown(e);
              }}
              onPointerMove={reactionLongPress.onPointerMove}
              onPointerUp={reactionLongPress.onPointerUp}
              onPointerLeave={reactionLongPress.onPointerLeave}
              onPointerCancel={reactionLongPress.onPointerCancel}
              onContextMenu={(e) => e.preventDefault()}
            >
              {attachment?.type === 'image' ? (
                // A photo is the bubble: no fill, no padding, just the image
                // clipped to the same corner radius. The intrinsic size, when
                // we captured it, reserves the box so the thread does not jump
                // when the image decodes.
                <BubbleContent
                  className={cn(
                    'overflow-hidden rounded-2xl bg-muted',
                    isMe ? 'rounded-br-md' : 'rounded-bl-md',
                    'transition-opacity duration-200 motion-reduce:transition-none',
                    pending && 'opacity-70',
                  )}
                >
                  <img
                    src={attachment.url}
                    alt={msg.content?.trim() || t('messaging:photo.alt')}
                    width={attachment.width ?? undefined}
                    height={attachment.height ?? undefined}
                    loading="lazy"
                    className="block h-auto w-full max-w-[240px] object-cover"
                  />
                </BubbleContent>
              ) : attachment?.type === 'audio' ? (
                <BubbleContent
                  className={cn(
                    bubbleSurfaceClass(isMe),
                    'transition-opacity duration-200 motion-reduce:transition-none',
                    pending && 'opacity-70',
                  )}
                >
                  <DmAudioMessage metadata={attachment} isMe={isMe} />
                </BubbleContent>
              ) : attachment?.type === 'poll' ? (
                <BubbleContent
                  className={cn(
                    bubbleSurfaceClass(isMe),
                    'p-3 transition-opacity duration-200 motion-reduce:transition-none',
                    pending && 'opacity-70',
                  )}
                >
                  <DmPollCard
                    poll={attachment}
                    votes={pollVotesByMessage.get(msg.id) ?? []}
                    currentUserId={pollVoterId}
                    disabled={pending}
                    onVote={(optionIndex) => {
                      haptic.selection();
                      void voteInPoll(msg.id, optionIndex).catch(() => {
                        haptic.error();
                        toast.error('Your vote could not be saved.');
                      });
                    }}
                  />
                </BubbleContent>
              ) : (
              <BubbleContent
                className={cn(
                  bubbleSurfaceClass(isMe),
                  // Opacity only, and only via a transition the OS can switch off.
                  'transition-opacity duration-200 motion-reduce:transition-none',
                  pending && 'opacity-70',
                )}
              >
                {msg.content ?? ''}
              </BubbleContent>
              )}
              {!pending && (
              <MessageReactions
                align={isMe ? 'end' : 'start'}
                theme={reactionTheme}
                reactions={msgReactions}
                onToggle={(emoji) => {
                  // Reversible by repeating the same tap → `light`, not `medium`.
                  // Kept identical to GroupChatPanel so the two never drift.
                  haptic.light();
                  void toggleReaction(msg.id, emoji);
                }}
                open={reactionPickerId === msg.id}
                onOpenChange={(o) => setReactionPickerId(o ? msg.id : null)}
                onReport={msg.report_uuid ? () => {
                  setReactionPickerId(null);
                  setReportMessageId(msg.report_uuid ?? null);
                } : undefined}
                onCopy={!attachment && msg.content ? () => { void copyMessage(msg.content ?? ''); } : undefined}
                onShare={canShareMessage && !attachment && msg.content ? () => { void shareMessage(msg.content ?? ''); } : undefined}
              />
              )}
            </Bubble>
            {(showTime || showRead) && (
              <MessageFooter className="pt-1 text-xs font-normal text-muted-foreground/70">
                {showRead ? t('messaging:chat.read', { defaultValue: 'Read' }) : format(new Date(msg.created_at), 'h:mm a')}
              </MessageFooter>
            )}
          </MessageContent>
        </Message>
      );

      if (isLastInGroup) flushRun(`r${i}`);
    });
    flushRun('tail');
    return out;
  };

  /**
   * A shared listing is sent as a short line of text plus the context marker
   * the thread already knows how to render (`MessagePreviewCard`). Deliberately
   * NO price/category lines in the text: `parseMessageContext` treats
   * everything outside the marker as intro copy and renders it as its own
   * bubble, so restating the listing there would print it twice — once as text,
   * once as the card.
   */
  const handleShareListing = (listing: ShareableListing) => {
    const title = listing.title?.trim();
    const intro = title
      ? t('messaging:share.introNamed', { title, defaultValue: `Sharing my listing: ${title}` })
      : t('messaging:share.intro', { defaultValue: 'Sharing one of my listings' });
    void sendMessage(buildListingShareContent(listing.id, intro));
  };

  /**
   * Pick → upload → send, in that order, and NOT optimistically: the bubble
   * only appears once the object is actually in the bucket. Painting a photo
   * bubble before the upload resolves would mean rolling a visible image back
   * out of the thread on a failed upload, which reads as the app losing it.
   */
  const sendPhoto = async (source: 'library' | 'camera') => {
    if (!user?.id || uploadingPhoto) return;
    let file: File | null = null;
    try {
      file = await pickOne({ source });
    } catch (e) {
      const code = imageUploadErrorCode(e);
      toast.error(
        code === 'permission-denied'
          ? t('messaging:photo.permissionDenied')
          : t('messaging:photo.pickFailed'),
      );
      return;
    }
    if (!file) return; // user cancelled the picker — not an error

    setUploadingPhoto(true);
    let uploadedPath: string | null = null;
    try {
      const size = await readImageSize(file);
      const seed = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const path = dmPhotoPath(user.id, file, seed);
      const url = await uploadDmPhoto(user.id, file, seed);
      uploadedPath = path;
      // `content` carries a readable fallback so the inbox preview and any
      // client that predates the metadata column still say something true.
      const sent = await sendMessage(t('messaging:photo.fallbackText'), {
        type: 'image',
        url,
        width: size?.width ?? null,
        height: size?.height ?? null,
      });
      if (!sent) {
        await deleteDmPhoto(uploadedPath);
        uploadedPath = null;
      }
    } catch (e) {
      if (uploadedPath) {
        try {
          await deleteDmPhoto(uploadedPath);
        } catch (cleanupError) {
          console.error('Photo orphan cleanup error:', cleanupError);
        }
      }
      console.error('Photo send error:', e);
      // A blocked photo is not an upload failure, and saying "upload failed"
      // would invite the user to retry the same file forever. The sentence comes
      // from the error itself: src/i18n/** belongs to another lane right now, so
      // a t() key for it would fail the unresolved-key gate.
      toast.error(
        e instanceof ImageRejectedError ? e.message : t('messaging:photo.uploadFailed'),
      );
    } finally {
      setUploadingPhoto(false);
    }
  };

  const clearRecordingTimer = () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    recordingTimerRef.current = null;
  };

  /**
   * WKWebView's MediaRecorder uses the OS microphone permission sheet and the
   * system-selected audio route, so this stays one shared React composer rather
   * than duplicating the thread in Swift. The blob is only uploaded once Stop is
   * explicit; cancelled permission never creates an object or a message row.
   */
  const startVoiceMessage = async () => {
    if (recordingAudio || uploadingAudio || !user?.id || !activeConversationId) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast.error('Voice messages are not available on this device.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      discardRecordingRef.current = false;
      recordingStreamRef.current = stream;
      const preferred = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus']
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        const durationMs = Math.max(1, Date.now() - recordingStartedAtRef.current);
        const mimeType = recorder.mimeType || preferred || 'audio/mp4';
        const audio = new Blob(chunks, { type: mimeType });
        stream.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        recorderRef.current = null;
        clearRecordingTimer();
        setRecordingAudio(false);
        setRecordingElapsedMs(0);
        if (!audio.size || discardRecordingRef.current) return;
        void (async () => {
          setUploadingAudio(true);
          let uploadedPath: string | null = null;
          try {
            const metadata = await uploadDmAudio({
              conversationId: activeConversationId,
              userId: user.id,
              audio,
              durationMs,
              mimeType,
            });
            uploadedPath = metadata.path;
            const sent = await sendMessage('Voice message', metadata);
            if (!sent) {
              await deleteDmAudio(metadata.path);
              uploadedPath = null;
              return;
            }
            haptic.success();
          } catch (error) {
            if (uploadedPath) {
              try {
                await deleteDmAudio(uploadedPath);
              } catch (cleanupError) {
                console.error('Voice message orphan cleanup error:', cleanupError);
              }
            }
            console.error('Voice message send error:', error);
            haptic.error();
            toast.error('Voice message could not be sent.');
          } finally {
            setUploadingAudio(false);
          }
        })();
      };
      recorderRef.current = recorder;
      recordingStartedAtRef.current = Date.now();
      recorder.start(250);
      setRecordingAudio(true);
      setRecordingElapsedMs(0);
      clearRecordingTimer();
      recordingTimerRef.current = setInterval(() => {
        setRecordingElapsedMs(Date.now() - recordingStartedAtRef.current);
      }, 250);
      haptic.light();
    } catch (error) {
      console.error('Voice message recording error:', error);
      haptic.error();
      toast.error('Microphone access is needed to record a voice message.');
    }
  };

  const stopVoiceMessage = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    haptic.medium();
    recorder.stop();
  };

  const sendPoll = async () => {
    try {
      const metadata = makeDmPoll(pollQuestion, pollOptions);
      await sendMessage(`Poll: ${metadata.question}`, metadata);
      setPollComposerOpen(false);
      setPollQuestion('');
      setPollOptions(['', '']);
      haptic.success();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Poll could not be sent.');
    }
  };

  // The composer's "+" — its own menu so more share types can land beside the
  // listing one without the composer growing another button each time.
  const composerPlusMenu = (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (!open) { plusOpenedByPointer.current = false; return; }
        plusItemSelected.current = false;
        // Radix owns the open-focus for a dropdown (no onOpenAutoFocus to
        // prevent), so take focus back on the next frame instead. onFocusOutside
        // below stops that from reading as a dismissal.
        if (plusOpenedByPointer.current) {
          requestAnimationFrame(() => messageInputRef.current?.focus());
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          // iOS drops the keyboard the moment the composer input blurs. A tap on
          // the "+" would blur it twice over: once from the browser focusing the
          // button, once from Radix moving focus into the menu. Killing the
          // mousedown default stops the first (Radix opens on pointerdown, which
          // has already fired, so the menu still opens).
          onPointerDown={() => { plusOpenedByPointer.current = true; }}
          onMouseDown={(e) => e.preventDefault()}
          aria-label={
            uploadingPhoto
              ? t('messaging:photo.uploading')
              : t('messaging:composer.moreLabel', { defaultValue: 'Share something' })
          }
          disabled={sending || uploadingPhoto}
          className="shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-accent disabled:opacity-40"
        >
          {/* The upload has no bubble to show progress in (the photo is only
              painted once it is really in the bucket), so the "+" itself is the
              progress surface. */}
          {uploadingPhoto ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          ) : (
            <Plus className="h-5 w-5" strokeWidth={2.2} />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        className="w-52"
        // Focus living in the composer rather than the menu is the POINT here,
        // not an outside interaction — don't let it auto-dismiss. A real tap
        // outside still closes the menu (that's onPointerDownOutside).
        onFocusOutside={(e) => { if (plusOpenedByPointer.current) e.preventDefault(); }}
        // Radix returns focus to the trigger button on close, which blurs the
        // input just as surely. Send it back to the composer instead.
        onCloseAutoFocus={(e) => {
          if (!plusOpenedByPointer.current) return;
          e.preventDefault();
          if (!plusItemSelected.current) messageInputRef.current?.focus();
        }}
      >
        <DropdownMenuItem onSelect={() => { plusItemSelected.current = true; void sendPhoto('library'); }}>
          <ImageIcon className="mr-2 h-4 w-4" aria-hidden />
          {t('messaging:photo.libraryAction')}
        </DropdownMenuItem>
        {isCameraAvailable && (
          <DropdownMenuItem onSelect={() => { plusItemSelected.current = true; void sendPhoto('camera'); }}>
            <Camera className="mr-2 h-4 w-4" aria-hidden />
            {t('messaging:photo.cameraAction')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => { plusItemSelected.current = true; setShareListingOpen(true); }}>
          <Tag className="mr-2 h-4 w-4" aria-hidden />
          {t('messaging:share.listingAction', { defaultValue: 'Share a listing' })}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { plusItemSelected.current = true; setShareSocialOpen(true); }}>
          <AtSign className="mr-2 h-4 w-4" aria-hidden />
          {t('messaging:social.action', { defaultValue: 'Share social media' })}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { plusItemSelected.current = true; setPollComposerOpen(true); }}>
          <BarChart3 className="mr-2 h-4 w-4" aria-hidden />
          Create a poll
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // The send affordance both composers share. Apple's shape — a filled circle
  // with an up arrow — reads as "send this up into the thread" more directly
  // than a paper plane, and it is the same glyph iOS users press all day.
  // One slot, one control: the arrow is always mounted and simply disables on an
  // empty draft, so the composer never reflows as the user types the first char.
  const sendButton = (
    <button
      type="button"
      onClick={() => { void sendMessage(); }}
      disabled={!inputValue.trim() || sending}
      aria-label={t('messaging:composer.sendLabel')}
      className="shrink-0 flex h-9 w-9 items-center justify-center rounded-full bg-malachite-800 text-white transition-colors hover:bg-malachite-900 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
    >
      <ArrowUp className="h-5 w-5" strokeWidth={2.6} />
    </button>
  );

  const voiceButton = recordingAudio ? (
    <Button
      type="button"
      onClick={stopVoiceMessage}
      aria-label="Stop recording voice message"
      className="flex h-9 min-w-20 items-center justify-center gap-1.5 rounded-full bg-destructive px-3 text-xs font-semibold text-destructive-foreground transition-opacity [&_svg]:size-3 [&_svg]:text-destructive-foreground"
    >
      <Square className="fill-current" aria-hidden />
      {audioDurationLabel(recordingElapsedMs)}
    </Button>
  ) : (
    <Button
      type="button"
      onClick={() => { void startVoiceMessage(); }}
      disabled={uploadingAudio || sending}
      aria-label="Record voice message"
      variant="ghost"
      size="icon"
      className="h-9 w-9 rounded-full hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-5 [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground"
    >
      {uploadingAudio ? <Loader2 className="animate-spin" aria-hidden /> : <Mic aria-hidden />}
    </Button>
  );

  // Rendered by BOTH the mobile and the desktop tree. It used to live only in the
  // desktop return, so the options menu's "Report" did nothing on phones.
  const reportUserDialog = (
    <ReportContentDialog
      open={reportUserOpen}
      onOpenChange={setReportUserOpen}
      contentType="user"
      contentId={activeConversation?.otherUserId ?? null}
      contentLabel={
        resolveOtherDisplayName(activeConversation?.otherName, activeOtherDisplayName) || t('messaging:chat.thisUser')
      }
    />
  );

  const shareListingDialog = (
    <>
      <ShareListingDialog
        open={shareListingOpen}
        onOpenChange={setShareListingOpen}
        onPick={handleShareListing}
      />
      <ReportContentDialog
        open={reportMessageId !== null}
        onOpenChange={(o) => { if (!o) setReportMessageId(null); }}
        contentType="dm_message"
        contentId={reportMessageId}
        contentLabel={t('messaging:actions.reportLabel')}
      />
      <ShareSocialDialog
        open={shareSocialOpen}
        onOpenChange={setShareSocialOpen}
        onPick={(text) => { void sendMessage(text); }}
      />
      <Dialog open={pollComposerOpen} onOpenChange={setPollComposerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create a poll</DialogTitle>
            <DialogDescription>Ask one question and let everyone in this chat vote live.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={pollQuestion}
              onChange={(event) => setPollQuestion(event.target.value)}
              placeholder="Question"
              aria-label="Poll question"
              maxLength={180}
            />
            {pollOptions.map((option, index) => (
              <Input
                key={index}
                value={option}
                onChange={(event) => setPollOptions((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                placeholder={`Option ${index + 1}`}
                aria-label={`Poll option ${index + 1}`}
                maxLength={100}
              />
            ))}
            {pollOptions.length < 8 ? (
              <Button
                type="button"
                onClick={() => setPollOptions((current) => [...current, ''])}
                variant="link"
                size="sm"
                className="h-auto px-0 text-malachite-800 hover:text-malachite-900"
              >
                Add option
              </Button>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setPollComposerOpen(false)} variant="ghost">Cancel</Button>
            <Button type="button" onClick={() => { void sendPoll(); }}>Send poll</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  if (isMobile) {
    return (
      <>
      <div className="flex flex-col flex-1 min-h-0 h-full w-full overflow-hidden bg-card">
        {!activeConversationId ? (
          <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden w-full">
            <div className="flex-1 overflow-y-auto min-h-0">
              {(conversations ?? []).map((c) => {
                const unread = isConversationUnread(c, user?.id);
                const isActive = activeConversationId === c.id;
                const burstUnread = burstUnreadByConversation?.[c.id] ?? 0;
                const updatedAt = c.updated_at ? formatDistanceToNow(new Date(c.updated_at), { addSuffix: true }) : '';
                return (
                  <div
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectConversation(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        selectConversation(c.id);
                      }
                    }}
                    className={cn(
                      'group w-full text-left py-4 px-6 flex items-center gap-4 border-b border-border/50 transition-colors hover:bg-accent active:bg-muted cursor-pointer',
                      isActive && 'bg-muted'
                    )}
                  >
                    <span className="relative shrink-0 inline-flex">
                      <Avatar className="h-14 w-14 shrink-0 rounded-full overflow-hidden ring-2 ring-background shadow-raised">
                        <AvatarImage src={c.otherAvatarUrl ?? undefined} alt="" className="object-cover" />
                        <AvatarFallback className="bg-muted text-muted-foreground text-base font-medium">
                          {getOtherDisplayInitial(c.otherName)}
                        </AvatarFallback>
                      </Avatar>
                      {burstUnread > 0 && (
                        <span
                          className="pointer-events-none absolute -top-0.5 -right-0.5 min-w-[1.125rem] h-[1.125rem] px-0.5 rounded-full bg-malachite-800 text-white text-[10px] font-bold leading-none flex items-center justify-center border-2 border-background shadow-raised"
                          aria-hidden
                        >
                          {burstUnread > 99 ? '99+' : burstUnread}
                        </span>
                      )}
                    </span>
                    <div className="flex-1 min-w-0 flex flex-col items-start gap-0.5">
                      <div className="flex items-center justify-between w-full gap-2">
                        <span className="font-bold text-foreground truncate text-base">{getOtherDisplayLabel(c)}</span>
                        <div className="shrink-0 flex items-center gap-1.5">
                          {unread && <span className="h-2 w-2 rounded-full bg-malachite-600" aria-label={t('messaging:chat.unread')} />}
                          <span className="text-xs text-muted-foreground">{updatedAt}</span>
                        </div>
                      </div>
                      {(() => {
                        const { text, isAcceptance } = getConversationPreview(c, user?.id);
                        return (
                          <span
                            className={cn(
                              'text-sm line-clamp-1 w-full',
                              isAcceptance ? 'text-malachite-800 font-medium' : 'text-muted-foreground'
                            )}
                          >
                            {text}
                          </span>
                        );
                      })()}
                    </div>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteClick(e, c.id)}
                      className="shrink-0 p-2 rounded-full text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors touch-manipulation"
                      aria-label={t('messaging:chat.removeConversation')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
            {renderInlineDeleteLayer()}
          </div>
        ) : (
          <>
            <header className="shrink-0 flex-none flex items-center gap-2 px-3 py-2">
              {onBack && (
                <button
                  type="button"
                  onClick={onBack}
                  className="shrink-0 flex h-10 w-10 items-center justify-center rounded-full border border-border/50 bg-card/80 text-foreground shadow-raised backdrop-blur-xl transition-transform hover:bg-card active:scale-95 supports-[backdrop-filter]:bg-card/65"
                  aria-label={t('messaging:chat.backToConversations')}
                >
                  <ArrowLeft className="h-5 w-5" strokeWidth={2} />
                </button>
              )}
              <div className="mx-auto flex min-w-0 items-center gap-2 rounded-full border border-border/50 bg-card/80 py-1.5 pl-1.5 pr-3.5 shadow-raised backdrop-blur-xl supports-[backdrop-filter]:bg-card/65">
                <Avatar className="h-7 w-7 shrink-0 rounded-full overflow-hidden">
                  <AvatarImage src={activeConversation?.otherAvatarUrl ?? undefined} alt="" />
                  <AvatarFallback className="bg-muted text-muted-foreground text-xs">
                    {getOtherDisplayInitial(activeConversation?.otherName ?? activeOtherDisplayName)}
                  </AvatarFallback>
                </Avatar>
                <h3 className="font-bold text-foreground text-sm truncate">
                  {otherProfileLoading && !activeOtherDisplayName && !activeConversation?.otherName
                    ? t('state.loading')
                    : resolveOtherDisplayName(activeConversation?.otherName, activeOtherDisplayName)}
                </h3>
              </div>
              {activeConversation?.otherUserId ? (
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="shrink-0 flex h-10 w-10 items-center justify-center rounded-full border border-border/50 bg-card/80 text-muted-foreground shadow-raised backdrop-blur-xl transition-colors hover:text-foreground supports-[backdrop-filter]:bg-card/65"
                      aria-label={t('messaging:chat.conversationOptions')}
                    >
                      <MoreVertical className="h-5 w-5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    {canConfirmRoommate && (
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault();
                          setConfirmRoommateOpen(true);
                        }}
                      >
                        <UserPlus className="mr-2 h-4 w-4" />
                        {roommateGroup
                          ? t('messaging:chat.inviteToRoommateGroup')
                          : t('messaging:chat.confirmAsRoommate')}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        setReportUserOpen(true);
                      }}
                      className="text-destructive focus:text-destructive"
                    >
                      <Flag className="mr-2 h-4 w-4" />
                      {t('messaging:chat.report')}
                    </DropdownMenuItem>
                    <BlockUserButton
                      variant="menu-item"
                      targetUserId={activeConversation.otherUserId}
                      displayName={resolveOtherDisplayName(
                        activeConversation.otherName,
                        activeOtherDisplayName,
                      )}
                      onBlocked={onClearConversation}
                    />
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        if (activeConversationId) setDeletingConversationId(activeConversationId);
                      }}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {t('messaging:chat.deleteConversation')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <div className="h-10 w-10 shrink-0" aria-hidden />
              )}
            </header>
            <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
              {effectiveConversationStatus === 'pending' && !effectiveIsInitiatedByMe && (
                <div className="shrink-0 px-4 py-3 border-b border-blue-100 bg-blue-50 flex items-center justify-between gap-3">
                  <p className="text-sm text-blue-700 font-medium">{t('messaging:chat.wantsToMessageYouShort')}</p>
                  <div className="flex gap-2 shrink-0">
                    <button type="button" onClick={onAcceptRequest} className="px-3 py-1 text-xs font-semibold bg-primary text-primary-foreground rounded-full hover:bg-primary/90 transition-colors">{t('messaging:chat.accept')}</button>
                    <button type="button" onClick={() => setShowDeclineConfirm(true)} className="px-3 py-1 text-xs font-medium text-muted-foreground hover:text-red-600 hover:bg-red-50 rounded-full transition-colors">{t('messaging:chat.decline')}</button>
                  </div>
                </div>
              )}
              {effectiveConversationStatus === 'pending' && effectiveIsInitiatedByMe && (
                <div className="shrink-0 px-4 py-2.5 border-b border-amber-200 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800">
                  <p className="text-sm text-amber-800 dark:text-amber-300 text-center">{t('messaging:chat.requestSentNote')}</p>
                  <div className="flex justify-center mt-2">
                    <button
                      type="button"
                      onClick={() => setShowRetractConfirm(true)}
                      className="text-xs font-medium text-amber-700 dark:text-amber-300 hover:text-amber-900 underline"
                    >
                      {t('messaging:chat.retractRequest')}
                    </button>
                  </div>
                </div>
              )}
              <MessageScroller
                ref={messagesScrollRef}
                role="log"
                aria-live="polite"
                aria-label={t('labels.messages')}
                viewportClassName="flex flex-col flex-1 overflow-y-auto overflow-x-hidden min-h-0 px-3 bg-card scroll-smooth"
                jumpButtonClassName="bottom-24"
                jumpLabel={t('messaging:chat.jumpToLatest', { defaultValue: 'Scroll to latest messages' })}
              >
                <div className="mt-auto py-3 space-y-2 min-w-0 pb-24">
                  {effectiveConversationStatus === 'accepted' && effectiveIsInitiatedByMe && (
                    <p className="text-center text-xs text-muted-foreground py-2 px-3 rounded-lg bg-muted/50 mx-auto max-w-[85%]">
                      {t('messaging:chat.acceptedYourRequest', { name: getOtherDisplayLabel(activeConversation!) })}
                    </p>
                  )}
                  {messagesLoading ? (
                    renderThreadSkeleton()
                  ) : (
                    <MessageListErrorBoundary>
                      {hasOlderMessages && (
                        <div className="flex justify-center pb-2">
                          <Button type="button" variant="ghost" size="sm" disabled={olderMessagesLoading} onClick={() => void loadOlderMessages()}>
                            {olderMessagesLoading ? 'Loading…' : 'Load older messages'}
                          </Button>
                        </div>
                      )}
                      {showPaymentWarning && <PaymentSafetyNotice onDismiss={dismissPaymentWarning} />}
                      {renderThread()}
                      {otherTyping && <TypingIndicator className="pt-1" />}
                    </MessageListErrorBoundary>
                  )}
                </div>
              </MessageScroller>
              {effectiveConversationStatus === 'pending' && effectiveIsInitiatedByMe && hasSentFirstMessage ? (
                <div className="shrink-0 px-4 py-4 border-t border-border bg-muted pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
                  <p className="text-sm text-muted-foreground text-center">Waiting for approval. They&apos;ll need to accept before you can continue chatting.</p>
                </div>
              ) : (
                <footer
                  className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center px-3 pt-2"
                  style={{ paddingBottom: mobileFooterPaddingBottom }}
                >
                  {/* iMessage shape: the "+" is its OWN control outside the
                      input pill, so the pill is purely the text field. */}
                  <div className="flex min-w-0 w-full items-center gap-2">
                    {composerPlusMenu}
                    <div className="flex min-w-0 flex-1 items-center gap-1 rounded-full border border-border/50 bg-card/80 shadow-overlay pl-4 pr-1 py-1.5 backdrop-blur-xl supports-[backdrop-filter]:bg-card/65 focus-within:ring-2 focus-within:ring-malachite-600/30 focus-within:border-malachite-600/40">
                      <Input
                        ref={messageInputRef}
                        value={inputValue}
                        onChange={(e) => { setInputValue(e.target.value); notifyTyping(); }}
                        onKeyDown={handleKeyDown}
                        onFocus={onMessageInputFocus}
                        onBlur={onMessageInputBlur}
                        placeholder={t('messaging:composer.placeholder')}
                        className="flex-1 min-w-0 border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 h-10 text-base rounded-full bg-transparent"
                        disabled={sending}
                      />
                      {inputValue.trim() ? sendButton : voiceButton}
                    </div>
                  </div>
                </footer>
              )}
              {renderInlineDeleteLayer()}
            </div>
          </>
        )}
      </div>
      {confirmDialogs}
      {shareListingDialog}
      {reportUserDialog}
      </>
    );
  }

  return (
    <div className="flex flex-row flex-1 min-h-0 h-full w-full overflow-hidden">
      <div
        ref={splitContainerRef}
        className={cn(
          'flex flex-row flex-1 min-h-0 overflow-hidden w-full h-full',
          isDragging && 'select-none'
        )}
      >
        {showSidebar && (
          <aside
            className="border-r border-border bg-muted/20 flex flex-col overflow-hidden flex-none h-full min-h-0"
            style={{
              width: compact ? '40%' : (sidebarWidth !== null ? `${sidebarWidth * 100}%` : (fullScreen ? '25%' : '40%')),
              minWidth: compact ? undefined : MIN_SIDEBAR_PX,
              maxWidth: compact ? '40%' : (fullScreen ? `${FULLSCREEN_MAX_RATIO * 100}%` : undefined),
            }}
          >
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
                <div className="flex flex-col">
                  {(conversations ?? []).map((c) => {
                    const unread = isConversationUnread(c, user?.id);
                    const isActive = activeConversationId === c.id;
                    const burstUnread = burstUnreadByConversation?.[c.id] ?? 0;
                    return (
                      <div
                        key={c.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => selectConversation(c.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectConversation(c.id); } }}
                        className={cn(
                          'group w-full min-w-0 text-left flex items-center border-b border-border transition-colors hover:bg-muted/50 cursor-pointer',
                          compact ? 'gap-2 py-2.5 px-3' : 'gap-3 py-3 px-3',
                          isActive && 'bg-muted/70'
                        )}
                      >
                        <span className="relative shrink-0 inline-flex">
                          <Avatar className="h-11 w-11 shrink-0 rounded-full overflow-hidden">
                            <AvatarImage src={c.otherAvatarUrl ?? undefined} alt="" />
                            <AvatarFallback className="bg-muted text-muted-foreground text-sm">
                              {getOtherDisplayInitial(c.otherName)}
                            </AvatarFallback>
                          </Avatar>
                          {burstUnread > 0 && (
                            <span
                              className="pointer-events-none absolute -top-0.5 -right-0.5 min-w-[1.125rem] h-[1.125rem] px-0.5 rounded-full bg-malachite-800 text-white text-[10px] font-bold leading-none flex items-center justify-center border-2 border-background shadow-raised"
                              aria-hidden
                            >
                              {burstUnread > 99 ? '99+' : burstUnread}
                            </span>
                          )}
                        </span>
                        <div className="flex-1 min-w-0 flex flex-col items-start justify-center gap-0.5">
                          <div className="flex items-center gap-2 w-full min-w-0">
                            <span className="font-bold text-foreground truncate text-sm">{getOtherDisplayLabel(c)}</span>
                            {unread && <span className="shrink-0 h-2 w-2 rounded-full bg-primary" aria-label={t('messaging:chat.unread')} />}
                          </div>
                          {(() => {
                          const { text, isAcceptance } = getConversationPreview(c, user?.id);
                          return (
                            <span
                              className={cn(
                                'text-xs truncate w-full min-w-0',
                                isAcceptance ? 'text-malachite-800 font-medium' : 'text-muted-foreground'
                              )}
                            >
                              {text}
                            </span>
                          );
                        })()}
                        </div>
                        <button
                            type="button"
                            onClick={(e) => handleDeleteClick(e, c.id)}
                            className={cn(
                              'shrink-0 inline-flex items-center justify-center rounded-full text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-red-600 hover:bg-red-50 transition-opacity',
                              compact
                                ? 'h-8 w-8 min-h-8 min-w-8 p-0 m-0 self-center'
                                : 'p-1.5 self-center'
                            )}
                            aria-label={t('messaging:chat.removeConversation')}
                          >
                            <Trash2 className="h-3.5 w-3.5 shrink-0" />
                          </button>
                      </div>
                    );
                  })}
                </div>
              </div>
              {sidebarFooter != null && (
                <div className="shrink-0 border-t border-border/50 p-2 bg-card/80">
                  {sidebarFooter}
                </div>
              )}
            </aside>
        )}

        {showGutter && (
            <div
              role="separator"
              aria-label={t('messaging:chat.resizePanels')}
              onMouseDown={handleGutterMouseDown}
              className="w-[4px] shrink-0 cursor-col-resize transition-colors bg-border/80 hover:bg-primary"
            />
          )}

        <div
          className="flex flex-col h-full min-w-0 overflow-hidden flex-1"
          style={{
            minWidth: MIN_MAIN_PX,
          }}
        >
          {!activeConversationId ? (
            <div className="relative flex-1 flex items-center justify-center text-muted-foreground p-4 min-h-0 overflow-auto">
              <p className="text-sm text-center">{t('messaging:chat.selectFromTabs')}</p>
              {renderInlineDeleteLayer()}
            </div>
          ) : (
            <>
              <header className="px-2 py-2.5 border-b border-border/60 shrink-0 flex items-center gap-2 bg-card flex-none">
                {onBack && (
                  <button
                    type="button"
                    onClick={onBack}
                    className="shrink-0 p-1.5 rounded-full text-foreground hover:bg-muted/80 transition-colors"
                    aria-label={t('messaging:chat.backToInbox')}
                  >
                    <ArrowLeft className="h-6 w-6" strokeWidth={2} />
                  </button>
                )}
                <Avatar className="h-9 w-9 shrink-0 rounded-full overflow-hidden">
                  <AvatarImage src={activeConversation?.otherAvatarUrl ?? undefined} alt="" />
                  <AvatarFallback className="bg-muted text-muted-foreground text-sm">
                    {getOtherDisplayInitial(activeConversation?.otherName ?? activeOtherDisplayName)}
                  </AvatarFallback>
                </Avatar>
                <h3 className="font-bold text-foreground text-base truncate flex-1 min-w-0">
                  {otherProfileLoading && !activeOtherDisplayName && !activeConversation?.otherName
                    ? t('state.loading')
                    : resolveOtherDisplayName(activeConversation?.otherName, activeOtherDisplayName)}
                </h3>
                {activeConversation?.otherUserId && (
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="shrink-0 p-1.5 rounded-full text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors"
                        aria-label={t('messaging:chat.conversationOptions')}
                      >
                        <MoreVertical className="h-5 w-5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      {canConfirmRoommate && (
                        <DropdownMenuItem
                          onSelect={(e) => {
                            e.preventDefault();
                            setConfirmRoommateOpen(true);
                          }}
                        >
                          <UserPlus className="mr-2 h-4 w-4" />
                          {roommateGroup
                            ? t('messaging:chat.inviteToRoommateGroup')
                            : t('messaging:chat.confirmAsRoommate')}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault();
                          setReportUserOpen(true);
                        }}
                        className="text-destructive focus:text-destructive"
                      >
                        <Flag className="mr-2 h-4 w-4" />
                        Report
                      </DropdownMenuItem>
                      <BlockUserButton
                        variant="menu-item"
                        targetUserId={activeConversation.otherUserId}
                        displayName={resolveOtherDisplayName(
                          activeConversation.otherName,
                          activeOtherDisplayName,
                        )}
                        onBlocked={onClearConversation}
                      />
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault();
                          if (activeConversationId) setDeletingConversationId(activeConversationId);
                        }}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete conversation
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </header>
              <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
                {effectiveConversationStatus === 'pending' && !effectiveIsInitiatedByMe && (
                  <div className="shrink-0 px-4 py-3 border-b border-blue-100 bg-blue-50 flex items-center justify-between gap-3">
                    <p className="text-sm text-blue-700 font-medium">{t('messaging:chat.wantsToMessageYou')}</p>
                    <div className="flex gap-2 shrink-0">
                      <button type="button" onClick={onAcceptRequest} className="px-4 py-1.5 text-sm font-semibold bg-primary text-primary-foreground rounded-full hover:bg-primary/90 transition-colors">{t('messaging:chat.accept')}</button>
                      <button type="button" onClick={() => setShowDeclineConfirm(true)} className="px-4 py-1.5 text-sm font-medium text-muted-foreground hover:text-red-600 hover:bg-red-50 rounded-full transition-colors">{t('messaging:chat.decline')}</button>
                    </div>
                  </div>
                )}
                {effectiveConversationStatus === 'pending' && effectiveIsInitiatedByMe && (
                  <div className="shrink-0 px-4 py-2.5 border-b border-amber-200 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800">
                    <p className="text-sm text-amber-800 dark:text-amber-300 text-center">{t('messaging:chat.requestSentNote')}</p>
                    <div className="flex justify-center mt-2">
                      <button
                        type="button"
                        onClick={() => setShowRetractConfirm(true)}
                        className="text-xs font-medium text-amber-700 dark:text-amber-300 hover:text-amber-900 underline"
                      >
                        Retract Request
                      </button>
                    </div>
                  </div>
                )}

                <MessageScroller
                  ref={messagesScrollRef}
                  role="log"
                  aria-live="polite"
                  aria-label={t('labels.messages')}
                  viewportClassName="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3"
                  jumpLabel={t('messaging:chat.jumpToLatest', { defaultValue: 'Scroll to latest messages' })}
                >
                  <div className="py-3 space-y-2 min-w-0">
                    {effectiveConversationStatus === 'accepted' && effectiveIsInitiatedByMe && (
                      <p className="text-center text-xs text-muted-foreground py-2 px-3 rounded-lg bg-muted/50 mx-auto max-w-[85%]">
                        {t('messaging:chat.acceptedYourRequest', { name: getOtherDisplayLabel(activeConversation!) })}
                      </p>
                    )}
                    {messagesLoading ? (
                      <div className="flex justify-center py-6">
                        <Skeleton className="h-6 w-32" />
                      </div>
                    ) : (
                      <MessageListErrorBoundary>
                        {hasOlderMessages && (
                          <div className="flex justify-center pb-2">
                            <Button type="button" variant="ghost" size="sm" disabled={olderMessagesLoading} onClick={() => void loadOlderMessages()}>
                              {olderMessagesLoading ? 'Loading…' : 'Load older messages'}
                            </Button>
                          </div>
                        )}
                        {showPaymentWarning && (
                          <PaymentSafetyNotice onDismiss={dismissPaymentWarning} />
                        )}
                        {renderThread()}
                        {otherTyping && <TypingIndicator className="pt-1" />}
                      </MessageListErrorBoundary>
                    )}
                  </div>
                </MessageScroller>

                {effectiveConversationStatus === 'pending' && effectiveIsInitiatedByMe && hasSentFirstMessage ? (
                  <div className="border-t border-border bg-muted/30 shrink-0 flex-none flex items-center justify-center py-4 px-4">
                    <p className="text-sm text-muted-foreground text-center">{t('messaging:chat.waitingApproval')}</p>
                  </div>
                ) : (
                  <footer
                    className="border-t border-border bg-card shrink-0 flex-none flex items-center justify-center py-3 px-4"
                    style={{
                      paddingBottom:
                        'calc(var(--keyboard-height, 0px) + max(0.75rem, env(safe-area-inset-bottom, 0px)))',
                    }}
                  >
                    <div className="flex min-w-0 max-w-2xl w-full items-center gap-2">
                      {composerPlusMenu}
                      <div className="flex min-w-0 flex-1 items-center rounded-full border border-border bg-card pl-4 pr-1 py-1.5 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                      <Input
                        ref={messageInputRef}
                        value={inputValue}
                        onChange={(e) => { setInputValue(e.target.value); notifyTyping(); }}
                        onKeyDown={handleKeyDown}
                        onFocus={onMessageInputFocus}
                        onBlur={onMessageInputBlur}
                        placeholder={t('messaging:composer.placeholder')}
                        className="flex-1 min-w-0 border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 h-10 text-base rounded-full bg-transparent"
                        disabled={sending}
                      />
                      {inputValue.trim() ? sendButton : voiceButton}
                      </div>
                    </div>
                  </footer>
                )}
                {renderInlineDeleteLayer()}
              </div>
            </>
          )}
        </div>
      </div>

      {confirmDialogs}
      {shareListingDialog}
      {reportUserDialog}
      {/* DM -> confirmed-roommate bridge. Nothing is shared until the invitee
          accepts (pending ranking_group_members row is the authoritative invite). */}
      {canConfirmRoommate && activeConversation?.otherUserId ? (
        <CollaborateModal
          open={confirmRoommateOpen}
          onOpenChange={setConfirmRoommateOpen}
          currentGroupId={roommateGroup?.groupId ?? null}
          createMode={!roommateGroup}
          groupType="roommate"
          prestagedInvitee={{
            id: activeConversation.otherUserId,
            full_name: resolveOtherDisplayName(activeConversation.otherName, activeOtherDisplayName) || null,
            avatar_url: activeConversation.otherAvatarUrl ?? null,
          }}
        />
      ) : null}
    </div>
  );
}
