import { isMarketingPath } from '@/routes/marketingPaths';
import { isLegalPath } from '@/routes/legalPaths';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'dormcheck-theme';

/**
 * Pre-auth surfaces (marketing, auth, legal, onboarding) are always light —
 * dark mode is a signed-in app-shell feature only.
 *
 * The inline FOUC script in index.html hardcodes the same rules (it cannot
 * import modules); keep the two in sync — src/test/theme.test.ts pins both.
 */
export function isAlwaysLightPath(pathname: string): boolean {
  return (
    isMarketingPath(pathname) ||
    isLegalPath(pathname) ||
    // Marketing-shell pages outside MARKETING_PATHS (which also drives chrome,
    // so they are scoped here only): light-only designs that rendered in dark
    // for a signed-in student, putting the dark bottom-nav glass over white.
    pathname === '/contact' ||
    pathname === '/waitlist' ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/select-school') ||
    pathname.startsWith('/onboarding') ||
    // Admin console ships its own light-only chrome (AdminLayout slate shell).
    pathname.startsWith('/admin')
  );
}

/**
 * THE theme resolver — the only place 'system' is resolved and route scoping
 * is applied. Everything (ThemeProvider, tests) goes through this.
 */
export function resolveEffectiveTheme(
  pathname: string,
  preference: ThemePreference,
  systemTheme: ResolvedTheme,
  /** Auth has resolved and nobody is signed in. Dark mode is a signed-in
   *  feature: a guest on /marketplace or the 404 got the light-only marketing
   *  chrome under a dark document (wordmark 1.01:1). */
  signedOut = false,
): ResolvedTheme {
  if (signedOut || isAlwaysLightPath(pathname)) return 'light';
  return preference === 'system' ? systemTheme : preference;
}

/** Matches hsl(var(--background)) in :root (light). */
export const THEME_COLOR_LIGHT = '#ffffff';

/** Matches hsl(222 12% 7%) - .dark --background (near-neutral faintly-cool deep, Phase 1.6 2026-07-20). */
export const THEME_COLOR_DARK = '#101114';

export function getStoredThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) {
    meta.content = resolved === 'dark' ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
  }
}
