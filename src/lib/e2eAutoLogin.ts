import { supabase } from '@/integrations/supabase/client';

/**
 * Dev/e2e-only auto-login so Simulator and audit runs never type credentials.
 * Provably dead in prod: requires DEV mode, the VITE_E2E_AUTOLOGIN flag, and a
 * local Supabase URL. NEVER set VITE_E2E_AUTOLOGIN in a prod build.
 */
function debugBadge(msg: string): void {
  // eslint-disable-next-line no-console -- callers are DEV + VITE_E2E_AUTOLOGIN gated; dead in prod.
  console.info(`[e2e] ${msg}`);
}

export async function e2eAutoLogin(): Promise<void> {
  if (!import.meta.env.DEV) return;
  if (import.meta.env.VITE_E2E_AUTOLOGIN !== '1') return;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url || !/127\.0\.0\.1|localhost/.test(url)) return;
  const email = import.meta.env.VITE_E2E_EMAIL as string | undefined;
  const password = import.meta.env.VITE_E2E_PASSWORD as string | undefined;
  if (!email || !password) return;
  debugBadge('e2e: checking session…');
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      debugBadge(error ? `e2e sign-in error: ${error.message}` : 'e2e: signed in');
    } else {
      debugBadge('e2e: session present');
    }
  } catch (e) {
    debugBadge(`e2e exception: ${String(e)}`);
  }
  // Harness runs exercise admin-gated routes; the seeded user is admin.
  try {
    localStorage.setItem('dc_admin_full_app_preview', 'true');
  } catch {
    /* ignore */
  }
  pollE2eRoute();
}

/**
 * Dev/e2e-only remote navigation: the harness writes a route to
 * public/e2e-route.txt and the app follows it. Lets Simulator runs navigate
 * without the iOS 26 deep-link consent dialog. Same guards as autologin.
 */
function pollE2eRoute(): void {
  let last = '';
  setInterval(async () => {
    try {
      const res = await fetch('/e2e-route.txt', { cache: 'no-store' });
      if (!res.ok) return;
      const route = (await res.text()).trim();
      if (route && route.startsWith('/') && route !== last) {
        last = route;
        window.location.hash = '';
        window.history.pushState({}, '', route);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    } catch {
      /* dev server unreachable; ignore */
    }
  }, 1000);
}
