import { createContext, useContext, useState, useCallback, useMemo, useRef, ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { useUnreadMessages } from '@/hooks/useUnreadMessages';

interface ChatContextValue {
  isOpen: boolean;
  setIsOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  openChat: () => void;
  hasUnreadMessages: boolean;
  /** Unread conversation count (drives the top-nav notifications badge). */
  unreadCount: number;
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null | ((prev: string | null) => string | null)) => void;
  /** Open the floating chat widget with a specific conversation and auto-focus the input */
  openChatWithConversation: (conversationId: string) => void;
  requestInputFocus: boolean;
  clearRequestInputFocus: () => void;
  /**
   * Call SYNCHRONOUSLY inside a tap handler (before any await/navigation) when an action
   * will open a chat and should land in the composer with the keyboard up. iOS only raises
   * the keyboard for a focus that happens inside the originating gesture, so we focus a
   * persistent hidden input now; it survives the async conversation lookup + route change,
   * keeping the keyboard open until the real composer mounts and transfers focus to itself.
   */
  primeKeyboard: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [requestInputFocus, setRequestInputFocus] = useState(false);
  const { hasUnreadMessages, unreadCount } = useUnreadMessages();
  const keyboardPrimerRef = useRef<HTMLInputElement>(null);
  const openChat = useCallback(() => setIsOpen(true), []);

  const openChatWithConversation = useCallback((conversationId: string) => {
    setActiveConversationId(conversationId);
    setIsOpen(true);
    setRequestInputFocus(true);
  }, []);

  const clearRequestInputFocus = useCallback(() => setRequestInputFocus(false), []);

  const primeKeyboard = useCallback(() => {
    if (!Capacitor.isNativePlatform()) return;
    // Synchronous focus inside the gesture so iOS opens the keyboard.
    keyboardPrimerRef.current?.focus();
    setRequestInputFocus(true);
  }, []);

  // Memoize so consumers only re-render when a value they read actually changes.
  // setIsOpen/setActiveConversationId are stable useState setters; the rest are stable useCallbacks.
  const value = useMemo<ChatContextValue>(
    () => ({
      isOpen,
      setIsOpen,
      openChat,
      hasUnreadMessages,
      unreadCount,
      activeConversationId,
      setActiveConversationId,
      openChatWithConversation,
      requestInputFocus,
      clearRequestInputFocus,
      primeKeyboard,
    }),
    [
      isOpen,
      hasUnreadMessages,
      unreadCount,
      activeConversationId,
      requestInputFocus,
      openChat,
      openChatWithConversation,
      clearRequestInputFocus,
      primeKeyboard,
    ]
  );

  return (
    <ChatContext.Provider value={value}>
      {children}
      {/* Persistent off-screen input used to keep the iOS keyboard up across navigation
          (see primeKeyboard). Focusable but invisible and not pointer-interactive. */}
      <input
        ref={keyboardPrimerRef}
        aria-hidden="true"
        tabIndex={-1}
        inputMode="text"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          width: 1,
          height: 1,
          opacity: 0,
          border: 0,
          padding: 0,
          margin: 0,
          fontSize: 16,
          pointerEvents: 'none',
        }}
      />
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    return {
      isOpen: false,
      setIsOpen: () => {},
      openChat: () => {},
      hasUnreadMessages: false,
      unreadCount: 0,
      activeConversationId: null as string | null,
      setActiveConversationId: () => {},
      openChatWithConversation: () => {},
      requestInputFocus: false,
      clearRequestInputFocus: () => {},
      primeKeyboard: () => {},
    };
  }
  return ctx;
}
