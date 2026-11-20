import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';

/**
 * Session storage for the Supabase client.
 *
 * Web: plain localStorage (unchanged behavior).
 * Native iOS: Keychain via @aparajita/capacitor-secure-storage (the plugin
 * exposes a getItem/setItem/removeItem surface for exactly this use), so the
 * auth session no longer lives in WKWebView localStorage.
 *
 * Migration: on native, the first read of a key checks localStorage for a
 * legacy value, moves it into the Keychain, and deletes the localStorage
 * copy - an app update keeps the user signed in.
 */
const isNative = Capacitor.isNativePlatform();

async function nativeGet(key: string): Promise<string | null> {
  const stored = await SecureStorage.getItem(key);
  if (stored !== null) return stored;
  // Legacy migration: session previously persisted in localStorage.
  const legacy = localStorage.getItem(key);
  if (legacy !== null) {
    await SecureStorage.setItem(key, legacy);
    localStorage.removeItem(key);
    return legacy;
  }
  return null;
}

export const sessionStorageAdapter = {
  getItem(key: string): Promise<string | null> | string | null {
    if (!isNative) return localStorage.getItem(key);
    return nativeGet(key).catch(() => localStorage.getItem(key));
  },
  setItem(key: string, value: string): Promise<void> | void {
    if (!isNative) {
      localStorage.setItem(key, value);
      return;
    }
    return SecureStorage.setItem(key, value).catch(() => {
      // Keychain write failed (should not happen): fall back so the user
      // is not signed out; a later successful read/write migrates back.
      localStorage.setItem(key, value);
    });
  },
  removeItem(key: string): Promise<void> | void {
    if (!isNative) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.removeItem(key);
    return SecureStorage.removeItem(key).catch(() => undefined);
  },
};
