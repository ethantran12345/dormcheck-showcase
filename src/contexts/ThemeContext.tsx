import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  applyResolvedTheme,
  getStoredThemePreference,
  getSystemTheme,
  resolveEffectiveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme';

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function syncNativeStatusBar(resolved: ResolvedTheme): void {
  if (!Capacitor.isNativePlatform()) return;
  // Light app chrome keeps Style.Light (existing behavior); dark uses the inverse.
  const style = resolved === 'dark' ? Style.Dark : Style.Light;
  void StatusBar.setStyle({ style }).catch(() => {});
}

/** Must be mounted inside BrowserRouter — theme resolution is route-scoped. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => getStoredThemePreference());
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme());
  const { pathname } = useLocation();
  const { user, isLoading: authLoading } = useAuth();
  // Only once auth has resolved: forcing light while it loads would flash a
  // signed-in dark-mode student light on every cold start.
  const signedOut = !authLoading && !user;
  // Set once the user touches the control this session; guards the profile
  // loader from clobbering a just-made choice.
  const localChangeRef = useRef(false);

  const resolvedTheme = useMemo(
    () => resolveEffectiveTheme(pathname, preference, systemTheme, signedOut),
    [pathname, preference, systemTheme, signedOut],
  );

  const setPreference = useCallback((next: ThemePreference) => {
    localChangeRef.current = true;
    setPreferenceState(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
  }, []);

  useLayoutEffect(() => {
    applyResolvedTheme(resolvedTheme);
    syncNativeStatusBar(resolvedTheme);
  }, [resolvedTheme]);

  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemTheme(media.matches ? 'dark' : 'light');
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  // Cross-tab sync: another tab changed the preference.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY) return;
      if (e.newValue === 'light' || e.newValue === 'dark' || e.newValue === 'system') {
        setPreferenceState(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // On sign-in, adopt the preference saved on the profile (unless the user
  // already picked one on this device this session).
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void supabase
      .from('profiles')
      .select('theme_preference')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || localChangeRef.current) return;
        const pref = (data as { theme_preference: string | null } | null)?.theme_preference;
        if (pref === 'light' || pref === 'dark' || pref === 'system') {
          setPreferenceState(pref);
          localStorage.setItem(THEME_STORAGE_KEY, pref);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Write-through: persist the user's choice on their profile (debounced).
  useEffect(() => {
    if (!user?.id || !localChangeRef.current) return;
    const timer = setTimeout(() => {
      void supabase
        .from('profiles')
        .update({ theme_preference: preference })
        .eq('id', user.id)
        .then(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [preference, user?.id]);

  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}
