import { supabase } from '@/integrations/supabase/client';
import { LogIn, LogOut, KeyRound, ShieldCheck, UserPlus, RotateCcw, Activity } from 'lucide-react';
import { type LucideIcon } from 'lucide-react';

/**
 * Settings > Security (R4): the caller's recent security activity.
 *
 * Data comes from the `get_my_security_events()` RPC (migration
 * 20260731070000), a SECURITY DEFINER function scoped strictly to auth.uid()
 * over auth-schema tables - same safe pattern as get_my_sessions. Every event
 * is REAL: sign-ins are one row per live auth.sessions row; the auth audit-log
 * branch (password changes, recovery, re-auth) lights up only if GoTrue audit
 * logging is enabled on the project - it is not today, so that branch is empty
 * and the UI shows an honest empty state rather than fabricating history.
 * `last_sign_in_at` (from auth.users) is the guaranteed-real anchor.
 */

export interface SecurityEvent {
  id: string;
  /** 'sign_in' from sessions, or a raw GoTrue audit action for audit-log rows. */
  type: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface SecurityActivity {
  last_sign_in_at: string | null;
  events: SecurityEvent[];
}

export async function getMySecurityEvents(): Promise<SecurityActivity> {
  const { data, error } = await supabase.rpc('get_my_security_events' as never);
  if (error) throw error;
  const payload = (data ?? {}) as Partial<SecurityActivity>;
  return {
    last_sign_in_at: payload.last_sign_in_at ?? null,
    events: Array.isArray(payload.events) ? payload.events : [],
  };
}

/** Human label for an event type (sign-in, plus known GoTrue audit actions). */
export function describeSecurityEvent(type: string): string {
  switch (type) {
    case 'sign_in':
    case 'login':
      return 'Signed in';
    case 'logout':
      return 'Signed out';
    case 'user_signedup':
      return 'Account created';
    case 'user_recovery_requested':
      return 'Password reset requested';
    case 'user_reauthenticate_requested':
      return 'Re-authentication requested';
    case 'user_updated_password':
      return 'Password changed';
    case 'user_modified':
      return 'Account updated';
    case 'factor_verified':
    case 'factor_unenrolled':
    case 'mfa_challenge_verified':
      return 'Two-factor updated';
    default:
      // Humanize any other GoTrue action: "some_action" -> "Some action".
      return type
        .replace(/_/g, ' ')
        .replace(/^\w/, (c) => c.toUpperCase());
  }
}

/** Icon for an event type. */
export function securityEventIcon(type: string): LucideIcon {
  switch (type) {
    case 'sign_in':
    case 'login':
      return LogIn;
    case 'logout':
      return LogOut;
    case 'user_signedup':
      return UserPlus;
    case 'user_recovery_requested':
    case 'user_updated_password':
      return KeyRound;
    case 'user_reauthenticate_requested':
      return RotateCcw;
    case 'factor_verified':
    case 'factor_unenrolled':
    case 'mfa_challenge_verified':
      return ShieldCheck;
    default:
      return Activity;
  }
}
