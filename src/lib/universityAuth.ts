import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import i18n from '@/i18n';
import {
  University,
  isUniversityEmail,
  primaryEmailDomain,
} from '@/config/universities';

// `university` is deliberately required (no DEFAULT_UNIVERSITY fallback):
// a silent Pitt default is exactly what broke CMU sign-in on 2026-07-10.
// Callers must resolve the school (typed email, ?school=, or session email)
// before gating.

export function universityOnlyMessage(university: University): string {
  return i18n.t('auth:errors.universityOnly', {
    shortName: university.shortName,
    domain: primaryEmailDomain(university),
  });
}

export function isAllowedEmail(
  email: string | undefined | null,
  university: University,
): boolean {
  return isUniversityEmail(university, email);
}

/**
 * Advertiser exception (P1.10): invite-gated business accounts are allowed
 * past the university email gate but never into the student app - callers
 * that get `advertiser` back must route to /advertise instead of the app.
 */
export type UniversityGateResult = 'allowed' | 'advertiser' | 'rejected';

export async function isAdvertiserAccount(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not yet in generated types (migration 20260713010000)
    const { data, error } = await (supabase as any).rpc('is_advertiser_account');
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function enforceUniversityEmailOrSignOut(
  email: string | undefined | null,
  university: University,
): Promise<boolean> {
  return (await gateUniversityEmail(email, university)) === 'allowed';
}

export async function gateUniversityEmail(
  email: string | undefined | null,
  university: University,
): Promise<UniversityGateResult> {
  if (isAllowedEmail(email, university)) return 'allowed';
  if (await isAdvertiserAccount()) return 'advertiser';
  await supabase.auth.signOut();
  toast.error(universityOnlyMessage(university));
  return 'rejected';
}
