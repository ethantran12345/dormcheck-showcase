import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { MessageCircle, X, Maximize2, Minimize2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useChat } from '@/contexts/ChatContext';
import { ChatPanel } from '@/components/ChatPanel';
import { DmUserSearchModal } from '@/components/messages/DmUserSearchModal';
import { acceptConversationRequest, declineConversationRequest } from '@/lib/conversationRequests';
import { supabase } from '@/integrations/supabase/client';
import { useDmIncomingUnreadRealtime } from '@/hooks/useDmIncomingUnreadRealtime';
import { cn } from '@/lib/utils';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ── Draggable + resizable compact desktop panel ─────────────────────────────

const CHAT_PANEL_LAYOUT_KEY = 'dormcheck_chat_panel_layout';
/** @deprecated read-only migration */
const CHAT_PANEL_SIZE_KEY_LEGACY = 'dormcheck_chat_panel_size';

const DEFAULT_PANEL_W = 520;
const DEFAULT_PANEL_H = 650;
const MIN_PANEL_W = 320;
const MIN_PANEL_H = 400;
/** Keep at least this many pixels of the panel visible on each viewport edge */
const PANEL_VISIBLE_PX = 100;

interface ChatPanelLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clampPanelSize(w: number, h: number): { width: number; height: number } {
  if (typeof window === 'undefined') {
    return {
      width: Math.max(MIN_PANEL_W, w),
      height: Math.max(MIN_PANEL_H, h),
    };
  }
  const maxW = Math.floor(window.innerWidth * 0.8);
  const maxH = Math.floor(window.innerHeight * 0.9);
  return {
    width: Math.min(maxW, Math.max(MIN_PANEL_W, w)),
    height: Math.min(maxH, Math.max(MIN_PANEL_H, h)),
  };
}

function clampLayoutPosition(l: ChatPanelLayout): ChatPanelLayout {
  if (typeof window === 'undefined') return l;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const { width: w, height: h } = l;
  const x = Math.min(Math.max(l.x, PANEL_VISIBLE_PX - w), vw - PANEL_VISIBLE_PX);
  const y = Math.min(Math.max(l.y, PANEL_VISIBLE_PX - h), vh - PANEL_VISIBLE_PX);
  return { ...l, x, y };
}

function clampLayout(l: ChatPanelLayout): ChatPanelLayout {
  const { width, height } = clampPanelSize(l.width, l.height);
  return clampLayoutPosition({ ...l, width, height });
}

function defaultBottomRightLayout(): ChatPanelLayout {
  const { width: w, height: h } = clampPanelSize(DEFAULT_PANEL_W, DEFAULT_PANEL_H);
  const x = window.innerWidth - w - 24;
  const y = window.innerHeight - h - 80;
  return clampLayout({ x, y, width: w, height: h });
}

function readStoredLayout(): ChatPanelLayout {
  if (typeof window === 'undefined') {
    const { width, height } = clampPanelSize(DEFAULT_PANEL_W, DEFAULT_PANEL_H);
    return { x: 0, y: 0, width, height };
  }
  try {
    const raw = localStorage.getItem(CHAT_PANEL_LAYOUT_KEY);
    if (raw) {
      const o = JSON.parse(raw) as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
      if (
        typeof o.x === 'number' &&
        typeof o.y === 'number' &&
        typeof o.width === 'number' &&
        typeof o.height === 'number' &&
        [o.x, o.y, o.width, o.height].every(Number.isFinite)
      ) {
        return clampLayout({
          x: o.x,
          y: o.y,
          width: o.width,
          height: o.height,
        });
      }
    }
    const legacy = localStorage.getItem(CHAT_PANEL_SIZE_KEY_LEGACY);
    if (legacy) {
      const p = JSON.parse(legacy) as { w?: unknown; h?: unknown };
      if (typeof p.w === 'number' && typeof p.h === 'number') {
        const { width, height } = clampPanelSize(p.w, p.h);
        const x = window.innerWidth - width - 24;
        const y = window.innerHeight - height - 80;
        return clampLayout({ x, y, width, height });
      }
    }
  } catch {
    /* ignore */
  }
  return defaultBottomRightLayout();
}

function persistPanelLayout(l: ChatPanelLayout) {
  try {
    localStorage.setItem(
      CHAT_PANEL_LAYOUT_KEY,
      JSON.stringify({ x: l.x, y: l.y, width: l.width, height: l.height })
    );
  } catch {
    /* ignore */
  }
}

/** Skips starting panel drag when the gesture targets typical interactive content (ChatPanel rows use role="button"). */
function isWidgetDragBlockedTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  return !!target.closest(
    'button,a[href],input,textarea,select,option,[role="button"],[contenteditable="true"]'
  );
}

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

interface ResizeDragState {
  edge: ResizeEdge;
  startX: number;
  startY: number;
  startLayout: ChatPanelLayout;
}

interface HeaderDragState {
  startX: number;
  startY: number;
  startLayout: ChatPanelLayout;
}

/** Compute layout during resize; keeps opposite edges fixed, then clamps size + position. */
function computeResizedLayout(edge: ResizeEdge, d: ResizeDragState, cx: number, cy: number): ChatPanelLayout {
  const { startLayout: s } = d;
  const dx = cx - d.startX;
  const dy = cy - d.startY;
  const right = s.x + s.width;
  const bottom = s.y + s.height;

  let w = s.width;
  let h = s.height;
  let x: number;
  let y: number;

  if (edge === 'e' || edge === 'ne' || edge === 'se') w = s.width + dx;
  if (edge === 'w' || edge === 'nw' || edge === 'sw') w = s.width - dx;
  if (edge === 's' || edge === 'sw' || edge === 'se') h = s.height + dy;
  if (edge === 'n' || edge === 'nw' || edge === 'ne') h = s.height - dy;

  const cw = clampPanelSize(w, h);
  w = cw.width;
  h = cw.height;

  if (edge === 'w' || edge === 'nw' || edge === 'sw') x = right - w;
  else x = s.x;

  if (edge === 'n' || edge === 'nw' || edge === 'ne') y = bottom - h;
  else y = s.y;

  return clampLayout({ x, y, width: w, height: h });
}

// ── Hooks ────────────────────────────────────────────────────────────────────

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    setIsMobile(mq.matches);
    const listener = () => setIsMobile(mq.matches);
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, []);
  return isMobile;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChatWidget({ hideFloatingLauncher = false }: { hideFloatingLauncher?: boolean } = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isOpen, setIsOpen, hasUnreadMessages, activeConversationId, setActiveConversationId } =
    useChat();
  const isMobile = useIsMobile();
  const [fullScreen, setFullScreen] = useState(false);
  const [showDmSearch, setShowDmSearch] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<{
    status: string;
    initiated_by: string | null;
  } | null>(null);

  const dmIncomingViewingRef = useRef<(id: string) => boolean>(() => false);
  dmIncomingViewingRef.current = (id) => isOpen && activeConversationId === id;

  const { burstUnreadByConversation } = useDmIncomingUnreadRealtime({
    userId: user?.id,
    activeConversationId,
    viewingRef: dmIncomingViewingRef,
  });

  // Fetch full conversation when DM is selected so we can pass status/initiated_by for Accept/Decline banner
  useEffect(() => {
    if (!activeConversationId || !user?.id) {
      setSelectedConversation(null);
      return;
    }
    let cancelled = false;
    supabase
      .from('conversations')
      .select('status, initiated_by')
      .eq('id', activeConversationId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data)
          setSelectedConversation({
            status: (data as { status?: string }).status ?? 'accepted',
            initiated_by: (data as { initiated_by?: string | null }).initiated_by ?? null,
          });
        else if (!cancelled) setSelectedConversation(null);
      });
    return () => { cancelled = true; };
  }, [activeConversationId, user?.id]);
  const [dmRealtimeTrigger, setDmRealtimeTrigger] = useState(0);
  const widgetConvosChannelRef = useRef<RealtimeChannel | null>(null);

  // Realtime: conversations so new DM requests appear in the widget list without refresh
  useEffect(() => {
    if (!user?.id || !isOpen) return;
    const ch = supabase
      .channel('widget-dm-requests')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `participant_1=eq.${user.id}` },
        () => setDmRealtimeTrigger((t) => t + 1)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `participant_2=eq.${user.id}` },
        () => setDmRealtimeTrigger((t) => t + 1)
      );
    ch.subscribe();
    widgetConvosChannelRef.current = ch;
    return () => {
      if (widgetConvosChannelRef.current) {
        supabase.removeChannel(widgetConvosChannelRef.current);
        widgetConvosChannelRef.current = null;
      }
    };
  }, [user?.id, isOpen]);

  const handleExpandToPage = () => {
    const url = activeConversationId
      ? `/messages?conversation=${encodeURIComponent(activeConversationId)}`
      : '/messages';
    setIsOpen(false);
    navigate(url);
  };

  const isDmRequest =
    !!selectedConversation &&
    selectedConversation.status === 'pending' &&
    selectedConversation.initiated_by !== user?.id;

  const handleAcceptRequest = useCallback(async () => {
    if (!activeConversationId) return;
    const { error } = await acceptConversationRequest(activeConversationId);
    if (error) return;
    setDmRealtimeTrigger((t) => t + 1);
  }, [activeConversationId]);

  const handleDeclineRequest = useCallback(async () => {
    if (!activeConversationId) return;
    await declineConversationRequest(activeConversationId);
    setActiveConversationId(null);
    setDmRealtimeTrigger((t) => t + 1);
  }, [activeConversationId]);

  const [panelLayout, setPanelLayout] = useState<ChatPanelLayout>(() => readStoredLayout());
  const layoutRef = useRef(panelLayout);
  const resizeDragRef = useRef<ResizeDragState | null>(null);
  const headerDragRef = useRef<HeaderDragState | null>(null);
  const [interactionBoostZ, setInteractionBoostZ] = useState(false);
  const [isDraggingHeader, setIsDraggingHeader] = useState(false);

  useEffect(() => {
    layoutRef.current = panelLayout;
  }, [panelLayout]);

  useEffect(() => {
    const onWinResize = () => {
      setPanelLayout((prev) => {
        const next = clampLayout(prev);
        if (next.x !== prev.x || next.y !== prev.y || next.width !== prev.width || next.height !== prev.height) {
          persistPanelLayout(next);
        }
        return next;
      });
    };
    window.addEventListener('resize', onWinResize);
    return () => window.removeEventListener('resize', onWinResize);
  }, []);

  const clearInteractionChrome = useCallback(() => {
    document.body.classList.remove('select-none');
    document.body.style.userSelect = '';
    document.body.style.overflow = '';
    setInteractionBoostZ(false);
    setIsDraggingHeader(false);
  }, []);

  const beginResizeDrag = useCallback(
    (edge: ResizeEdge, clientX: number, clientY: number, pointer: 'mouse' | 'touch') => {
      const L = layoutRef.current;
      resizeDragRef.current = {
        edge,
        startX: clientX,
        startY: clientY,
        startLayout: { ...L },
      };
      document.body.classList.add('select-none');
      document.body.style.userSelect = 'none';
      document.body.style.overflow = 'hidden';
      setInteractionBoostZ(true);

      const apply = (cx: number, cy: number) => {
        const d = resizeDragRef.current;
        if (!d) return;
        const next = computeResizedLayout(d.edge, d, cx, cy);
        layoutRef.current = next;
        setPanelLayout(next);
      };

      let finished = false;
      const onMouseMove = (e: MouseEvent) => {
        e.preventDefault();
        apply(e.clientX, e.clientY);
      };
      const onTouchMove = (e: TouchEvent) => {
        e.preventDefault();
        const t = e.touches[0];
        if (t) apply(t.clientX, t.clientY);
      };
      function end() {
        if (finished) return;
        finished = true;
        resizeDragRef.current = null;
        clearInteractionChrome();
        persistPanelLayout(layoutRef.current);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onTouchEnd);
        window.removeEventListener('touchcancel', onTouchEnd);
      }
      const onMouseUp = () => end();
      const onTouchEnd = () => end();

      if (pointer === 'mouse') {
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      } else {
        window.addEventListener('touchmove', onTouchMove, { passive: false });
        window.addEventListener('touchend', onTouchEnd);
        window.addEventListener('touchcancel', onTouchEnd);
      }
    },
    [clearInteractionChrome]
  );

  const beginHeaderDrag = useCallback(
    (clientX: number, clientY: number, pointer: 'mouse' | 'touch') => {
      const L = layoutRef.current;
      headerDragRef.current = {
        startX: clientX,
        startY: clientY,
        startLayout: { ...L },
      };
      document.body.classList.add('select-none');
      document.body.style.userSelect = 'none';
      document.body.style.overflow = 'hidden';
      setInteractionBoostZ(true);
      setIsDraggingHeader(true);

      const apply = (cx: number, cy: number) => {
        const d = headerDragRef.current;
        if (!d) return;
        const dx = cx - d.startX;
        const dy = cy - d.startY;
        const raw: ChatPanelLayout = {
          ...d.startLayout,
          x: d.startLayout.x + dx,
          y: d.startLayout.y + dy,
        };
        const next = clampLayout(raw);
        layoutRef.current = next;
        setPanelLayout(next);
      };

      let finished = false;
      const onMouseMove = (e: MouseEvent) => {
        e.preventDefault();
        apply(e.clientX, e.clientY);
      };
      const onTouchMove = (e: TouchEvent) => {
        e.preventDefault();
        const t = e.touches[0];
        if (t) apply(t.clientX, t.clientY);
      };
      function end() {
        if (finished) return;
        finished = true;
        headerDragRef.current = null;
        clearInteractionChrome();
        persistPanelLayout(layoutRef.current);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onTouchEnd);
        window.removeEventListener('touchcancel', onTouchEnd);
      }
      const onMouseUp = () => end();
      const onTouchEnd = () => end();

      if (pointer === 'mouse') {
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      } else {
        window.addEventListener('touchmove', onTouchMove, { passive: false });
        window.addEventListener('touchend', onTouchEnd);
        window.addEventListener('touchcancel', onTouchEnd);
      }
    },
    [clearInteractionChrome]
  );

  const resetPanelToDefault = useCallback(() => {
    const next = defaultBottomRightLayout();
    layoutRef.current = next;
    setPanelLayout(next);
    persistPanelLayout(next);
    toast.message(t('messaging:widget.resetPosition'));
  }, [t]);

  const effectiveFullScreen = fullScreen || (isMobile && isOpen);

  if (!user) return null;

  const isCompactDesktop = isOpen && !isMobile && !effectiveFullScreen;

  const containerClass = effectiveFullScreen
    ? cn(
        'pointer-events-auto fixed flex flex-col overflow-hidden',
        isMobile
          ? 'inset-x-0 top-[env(safe-area-inset-top)] bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[1100] m-0 w-full rounded-none bg-card p-0'
          : 'inset-0 z-[1000] m-0 h-screen w-screen max-w-none rounded-none border-0 bg-card p-0'
      )
    : cn(
        // `fixed` only - never add `relative` on this outer node; twMerge would drop `fixed` and the panel would flow in the document and push page content.
        'pointer-events-auto fixed flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl'
      );

  const compactPanelStyle: CSSProperties | undefined = isCompactDesktop
    ? {
        left: panelLayout.x,
        top: panelLayout.y,
        width: panelLayout.width,
        height: panelLayout.height,
        zIndex: interactionBoostZ ? 9999 : 999,
      }
    : undefined;

  const newMessageButton = (
    <Button
      type="button"
      variant="ghost"
      className="w-full justify-center gap-2 border border-malachite-600/60 text-malachite-600 hover:bg-malachite-50 dark:hover:bg-muted hover:text-malachite-600 dark:text-malachite-300 dark:hover:text-malachite-300"
      onClick={() => setShowDmSearch(true)}
    >
      <Pencil className="h-4 w-4 shrink-0" />
      {t('messaging:widget.newMessage')}
    </Button>
  );

  return (
    <>
      {/* Floating button - desktop only; mobile uses the top nav messages icon */}
      {!hideFloatingLauncher && (
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className={cn(
            'hidden md:flex fixed bottom-6 right-6 z-[999] h-14 w-14 items-center justify-center rounded-full shadow-overlay transition-all',
            'bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-105',
            'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2'
          )}
          aria-label={hasUnreadMessages ? t('messaging:widget.messagesUnread') : t('messaging:widget.openMessages')}
        >
          <MessageCircle className="h-6 w-6" />
          {hasUnreadMessages && (
            <span
              className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-500 border-2 border-background"
              aria-hidden
            />
          )}
        </button>
      )}

      {/* Pop-over / full-screen chat window */}
      {isOpen && (
        <div
          className={cn(
            containerClass,
            isCompactDesktop && 'cursor-grab active:cursor-grabbing',
            isCompactDesktop && isDraggingHeader && 'cursor-grabbing'
          )}
          style={compactPanelStyle}
          aria-label={isCompactDesktop ? t('messaging:widget.dragToMove') : undefined}
          role={isCompactDesktop ? 'button' : undefined}
          onMouseDown={
            isCompactDesktop
              ? (e) => {
                  if (e.button !== 0) return;
                  if (isWidgetDragBlockedTarget(e.target)) return;
                  e.preventDefault();
                  beginHeaderDrag(e.clientX, e.clientY, 'mouse');
                }
              : undefined
          }
          onTouchStart={
            isCompactDesktop
              ? (e) => {
                  const t = e.touches[0];
                  if (!t) return;
                  if (isWidgetDragBlockedTarget(e.target)) return;
                  e.preventDefault();
                  beginHeaderDrag(t.clientX, t.clientY, 'touch');
                }
              : undefined
          }
          onDoubleClick={
            isCompactDesktop
              ? (e) => {
                  if (isWidgetDragBlockedTarget(e.target)) return;
                  resetPanelToDefault();
                }
              : undefined
          }
          onKeyDown={
            isCompactDesktop
              ? (e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    resetPanelToDefault();
                  }
                }
              : undefined
          }
        >
          <div
            className={cn(
              'flex h-full w-full min-h-0 flex-1 flex-col',
              isCompactDesktop && 'relative'
            )}
          >
          {isCompactDesktop && (
            <>
              <div
                role="presentation"
                aria-hidden
                className="absolute left-0 top-0 z-10 h-3 w-3 cursor-nw-resize touch-none"
                style={{ touchAction: 'none' }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  beginResizeDrag('nw', e.clientX, e.clientY, 'mouse');
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const t = e.touches[0];
                  if (t) beginResizeDrag('nw', t.clientX, t.clientY, 'touch');
                }}
              />
              <div
                role="presentation"
                aria-hidden
                className="absolute right-0 top-0 z-10 h-3 w-3 cursor-ne-resize touch-none"
                style={{ touchAction: 'none' }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  beginResizeDrag('ne', e.clientX, e.clientY, 'mouse');
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const t = e.touches[0];
                  if (t) beginResizeDrag('ne', t.clientX, t.clientY, 'touch');
                }}
              />
              <div
                role="presentation"
                aria-hidden
                className="absolute bottom-0 left-0 z-10 h-3 w-3 cursor-sw-resize touch-none"
                style={{ touchAction: 'none' }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  beginResizeDrag('sw', e.clientX, e.clientY, 'mouse');
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const t = e.touches[0];
                  if (t) beginResizeDrag('sw', t.clientX, t.clientY, 'touch');
                }}
              />
              <div
                role="presentation"
                aria-hidden
                className="absolute bottom-0 right-0 z-10 h-3 w-3 cursor-se-resize touch-none"
                style={{ touchAction: 'none' }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  beginResizeDrag('se', e.clientX, e.clientY, 'mouse');
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const t = e.touches[0];
                  if (t) beginResizeDrag('se', t.clientX, t.clientY, 'touch');
                }}
              />
              <div
                role="presentation"
                aria-hidden
                className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize touch-none z-[5]"
                style={{ touchAction: 'none' }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  beginResizeDrag('w', e.clientX, e.clientY, 'mouse');
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const t = e.touches[0];
                  if (t) beginResizeDrag('w', t.clientX, t.clientY, 'touch');
                }}
              />
              <div
                role="presentation"
                aria-hidden
                className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize touch-none z-[5]"
                style={{ touchAction: 'none' }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  beginResizeDrag('e', e.clientX, e.clientY, 'mouse');
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const t = e.touches[0];
                  if (t) beginResizeDrag('e', t.clientX, t.clientY, 'touch');
                }}
              />
              <div
                role="presentation"
                aria-hidden
                className="absolute left-0 right-0 top-0 h-2 cursor-row-resize touch-none z-[5]"
                style={{ touchAction: 'none' }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  beginResizeDrag('n', e.clientX, e.clientY, 'mouse');
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const t = e.touches[0];
                  if (t) beginResizeDrag('n', t.clientX, t.clientY, 'touch');
                }}
              />
              <div
                role="presentation"
                aria-hidden
                className="absolute left-0 right-0 bottom-0 h-2 cursor-row-resize touch-none z-[5]"
                style={{ touchAction: 'none' }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  beginResizeDrag('s', e.clientX, e.clientY, 'mouse');
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const t = e.touches[0];
                  if (t) beginResizeDrag('s', t.clientX, t.clientY, 'touch');
                }}
              />
            </>
          )}
          {/* Header */}
          <div
            className={cn(
              'flex items-center justify-between gap-2 px-3 py-2 border-b border-border shrink-0 relative z-20',
              isMobile ? 'bg-card border-border' : 'bg-muted/30'
            )}
          >
            {isCompactDesktop ? (
              <h2 className="font-semibold text-foreground text-sm flex-1 min-w-0 text-center leading-tight">
                {t('labels.messages')}
              </h2>
            ) : (
              <h2 className="font-semibold text-foreground text-sm flex-1 min-w-0">{t('labels.messages')}</h2>
            )}
            <div className="flex items-center gap-1 shrink-0">
              {!isMobile && (
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  onClick={fullScreen ? () => setFullScreen(false) : handleExpandToPage}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  aria-label={fullScreen ? t('messaging:widget.exitFullScreen') : t('messaging:widget.expandFullPage')}
                >
                  {fullScreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
                </button>
              )}
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label={t('actions.close')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div
            className={cn(
              'flex-1 min-h-0 overflow-hidden flex flex-col w-full h-full',
              isDraggingHeader && 'pointer-events-none'
            )}
          >
            {effectiveFullScreen && isMobile ? (
              <div className="flex-1 min-h-0 overflow-hidden w-full h-full bg-card">
                <ChatPanel
                  activeConversationId={activeConversationId}
                  onSelectConversation={setActiveConversationId}
                  onClearConversation={() => setActiveConversationId(null)}
                  compact
                  fullScreen={effectiveFullScreen}
                  isMobile={isMobile}
                  onClose={() => setIsOpen(false)}
                  onBack={() => setActiveConversationId(null)}
                  conversationStatus={selectedConversation?.status as 'pending' | 'accepted' | undefined}
                  isInitiatedByMe={selectedConversation?.initiated_by === user?.id}
                  onAcceptRequest={isDmRequest ? handleAcceptRequest : undefined}
                  onDeclineRequest={isDmRequest ? handleDeclineRequest : undefined}
                  onOpenUserSearch={() => setShowDmSearch(true)}
                  sidebarFooter={newMessageButton}
                  realtimeRefreshTrigger={dmRealtimeTrigger}
                  inlineDeleteConfirm
                  burstUnreadByConversation={burstUnreadByConversation}
                />
              </div>
            ) : effectiveFullScreen ? (
              <div className="flex-1 min-h-0 overflow-hidden flex flex-col w-full h-full bg-muted/30">
                <div className="flex-1 min-h-0 overflow-hidden w-full flex flex-col">
                  <ChatPanel
                    activeConversationId={activeConversationId}
                    onSelectConversation={setActiveConversationId}
                    onClearConversation={() => setActiveConversationId(null)}
                    compact
                    fullScreen={effectiveFullScreen}
                    onClose={() => setIsOpen(false)}
                    onBack={() => setActiveConversationId(null)}
                    conversationStatus={selectedConversation?.status as 'pending' | 'accepted' | undefined}
                    isInitiatedByMe={selectedConversation?.initiated_by === user?.id}
                    onAcceptRequest={isDmRequest ? handleAcceptRequest : undefined}
                    onDeclineRequest={isDmRequest ? handleDeclineRequest : undefined}
                    onOpenUserSearch={() => setShowDmSearch(true)}
                    sidebarFooter={newMessageButton}
                    realtimeRefreshTrigger={dmRealtimeTrigger}
                    inlineDeleteConfirm
                    burstUnreadByConversation={burstUnreadByConversation}
                  />
                </div>
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-hidden w-full flex flex-col">
                <ChatPanel
                  activeConversationId={activeConversationId}
                  onSelectConversation={setActiveConversationId}
                  onClearConversation={() => setActiveConversationId(null)}
                  compact
                  fullScreen={effectiveFullScreen}
                  onClose={() => setIsOpen(false)}
                  onBack={() => setActiveConversationId(null)}
                  conversationStatus={selectedConversation?.status as 'pending' | 'accepted' | undefined}
                  isInitiatedByMe={selectedConversation?.initiated_by === user?.id}
                  onAcceptRequest={isDmRequest ? handleAcceptRequest : undefined}
                  onDeclineRequest={isDmRequest ? handleDeclineRequest : undefined}
                  onOpenUserSearch={() => setShowDmSearch(true)}
                  sidebarFooter={newMessageButton}
                  realtimeRefreshTrigger={dmRealtimeTrigger}
                  inlineDeleteConfirm
                  burstUnreadByConversation={burstUnreadByConversation}
                />
              </div>
            )}
          </div>
          </div>
        </div>
      )}
      {showDmSearch && user && (
        <DmUserSearchModal
          isOpen={showDmSearch}
          onClose={() => setShowDmSearch(false)}
          currentUserId={user.id}
          onConversationSelected={(convId) => {
            setActiveConversationId(convId);
            setShowDmSearch(false);
          }}
        />
      )}
    </>
  );
}
