import { supabase } from '@/integrations/supabase/client';

/**
 * In-app 2FA helpers (P0.3). TOTP enroll/challenge/verify is native GoTrue
 * (supabase.auth.mfa.*); backup codes and session listing are ours. Backup
 * codes are minted server-side by mint_backup_codes() (SECURITY DEFINER,
 * requires an aal2 session) — the client never writes mfa_backup_codes, and
 * plaintext leaves the server exactly once on the mint response.
 */

/** Matches use_backup_code() server-side normalization: trim, lowercase, strip dashes. */
export function normalizeBackupCode(code: string): string {
  return code.trim().toLowerCase().replace(/-/g, '');
}

/**
 * Mint a fresh set of 10 backup codes, replacing any previous set. Requires
 * an aal2 session (call right after a successful TOTP verify).
 */
export async function mintBackupCodes(): Promise<string[]> {
  const { data, error } = await supabase.rpc('mint_backup_codes' as never);
  if (error) throw error;
  return (data ?? []) as string[];
}

/**
 * Burn a backup code (single-use, rate-limited server-side). TOTP factors
 * survive; the profile is flagged for MFA re-enrollment instead.
 */
export async function redeemBackupCode(code: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('use_backup_code' as never, {
    p_code: code,
  } as never);
  if (error) throw error;
  return data === true;
}

export interface SessionRow {
  id: string;
  created_at: string;
  last_seen_at: string;
  user_agent: string | null;
  ip: string | null;
  is_current: boolean;
}

export async function getMySessions(): Promise<SessionRow[]> {
  const { data, error } = await supabase.rpc('get_my_sessions' as never);
  if (error) throw error;
  return (data ?? []) as SessionRow[];
}

export async function revokeSession(sessionId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('revoke_my_session' as never, {
    p_session_id: sessionId,
  } as never);
  if (error) throw error;
  return data === true;
}

export async function revokeOtherSessions(): Promise<number> {
  const { data, error } = await supabase.rpc('revoke_my_other_sessions' as never);
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

/** Human label for a session's user agent ("Safari on iPhone", "Chrome on Mac"). */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /CriOS\/|Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Macintosh|Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'device';
  return `${browser} on ${device}`;
}
