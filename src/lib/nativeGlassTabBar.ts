import { Capacitor } from '@capacitor/core';

/**
 * The iOS shell owns the physical tab bar; React remains the only router. This
 * deliberately uses a tiny `WKScriptMessageHandler` bridge instead of a second
 * navigation state store, so deep links and in-app navigation cannot drift.
 */
export const NATIVE_GLASS_TAB_PRESS_EVENT = 'dormcheck-native-glass-tab-press';
export const NATIVE_GLASS_MORE_PRESS_EVENT = 'dormcheck-native-glass-more-press';

export type NativeGlassTabId = 'home' | 'housing' | 'checklist' | 'marketplace';

type NativeGlassTabBarMessage = {
  visible?: boolean;
  route?: string;
  menuOpen?: boolean;
};

type NativeGlassTabBarHandler = {
  postMessage: (message: NativeGlassTabBarMessage) => void;
};

export type NativeIMessageBridge = {
  postMessage: (body: {
    action: 'sendMessage';
    url: string;
    title: string;
    imageURL?: string;
  }) => void;
};

export type NativeShareBridge = {
  postMessage: (content: {
    title?: string;
    text?: string;
    url?: string;
  }) => void;
};

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        dormcheckNativeGlassTabBar?: NativeGlassTabBarHandler;
        dormcheck?: NativeIMessageBridge;
        dormcheckNativeShare?: NativeShareBridge;
      };
    };
  }
}

export function usesNativeGlassTabBar(): boolean {
  return Capacitor.getPlatform() === 'ios';
}

export function syncNativeGlassTabBar(message: NativeGlassTabBarMessage): void {
  if (!usesNativeGlassTabBar()) return;
  window.webkit?.messageHandlers?.dormcheckNativeGlassTabBar?.postMessage(message);
}

export function syncNativeGlassMoreMenu(menuOpen: boolean): void {
  if (!usesNativeGlassTabBar()) return;
  window.webkit?.messageHandlers?.dormcheckNativeGlassTabBar?.postMessage({
    menuOpen,
  });
}
