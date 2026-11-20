import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

/**
 * Force a pure-white canvas on the native shell while the calling screen is
 * mounted: `html.native-auth-canvas` (src/index.css) overrides `--background`
 * to white and disables the iOS overscroll rubber-band, so the green-tinted
 * app background never bleeds in behind white-card layouts. No-op on web.
 * Keyboard-driven shifting (`--keyboard-height`) is unaffected.
 */
export function useNativeAuthCanvas() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const root = document.documentElement;
    root.classList.add('native-auth-canvas');
    return () => root.classList.remove('native-auth-canvas');
  }, []);
}
