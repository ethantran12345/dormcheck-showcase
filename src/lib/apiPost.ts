import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';

const nativeApiBase =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'https://dormcheck.com';

export function resolveApiUrl(path: string): string {
  if (!Capacitor.isNativePlatform()) return path;
  const base = nativeApiBase.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * POST to a Vercel /api endpoint with the caller's Supabase access token.
 * All /api handlers require a verified JWT.
 */
export async function apiPost(path: string, body: unknown): Promise<Response> {
  const url = resolveApiUrl(path);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  async function postWithToken(token: string | undefined): Promise<Response> {
    const reqHeaders = { ...headers };
    if (token) reqHeaders.Authorization = `Bearer ${token}`;
    return fetch(url, { method: 'POST', headers: reqHeaders, body: JSON.stringify(body) });
  }

  const { data: sessionData } = await supabase.auth.getSession();
  let token = sessionData.session?.access_token;
  let resp = await postWithToken(token);

  if (resp.status === 401) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    token = refreshed.session?.access_token;
    if (token) resp = await postWithToken(token);
  }

  return resp;
}
