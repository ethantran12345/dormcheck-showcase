import { resolveApiUrl } from '@/lib/apiPost';
import { supabase } from '@/integrations/supabase/client';

export type ResolvedSchool = {
  school_id: string;
  name: string;
  ipeds_unitid: number;
  matched_university_id: string | null;
  matched_university_active: boolean;
};

/**
 * Name the school behind an email domain via the resolve_school_by_domain RPC
 * (anon-callable; progressively strips subdomains server-side). Naming only -
 * a resolved school never authorizes sign-in; the signup gate stays
 * universities.email_domains. Returns null on no match or any error.
 */
export async function resolveSchoolByDomain(domain: string): Promise<ResolvedSchool | null> {
  const trimmed = domain.trim().toLowerCase();
  if (!trimmed || trimmed.includes('@')) return null;
  try {
    const { data, error } = await supabase.rpc('resolve_school_by_domain', { p_domain: trimmed });
    if (error || !data) return null;
    return data as ResolvedSchool;
  } catch {
    return null;
  }
}

export type WaitlistResult =
  | { ok: true; alreadyOnList: boolean }
  | { ok: false; message: string };

/**
 * Join the university waitlist via POST /api/join-waitlist (unauthenticated,
 * IP rate-limited). The join moved server-side so the confirmation email is
 * sent against the address that was actually inserted; the server normalizes
 * the email and treats a repeat submit as success without resending.
 */
export async function submitWaitlist(
  email: string,
  schoolName?: string,
): Promise<WaitlistResult> {
  const trimmedEmail = email.trim();
  const trimmedSchool = schoolName?.trim();

  try {
    const resp = await fetch(resolveApiUrl('/api/join-waitlist'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: trimmedEmail,
        schoolName: trimmedSchool ? trimmedSchool : undefined,
      }),
    });

    if (resp.ok) {
      const data = (await resp.json().catch(() => null)) as { alreadyJoined?: boolean } | null;
      return { ok: true, alreadyOnList: data?.alreadyJoined === true };
    }
  } catch {
    /* network failure - fall through to the friendly error */
  }

  return {
    ok: false,
    message: 'Something went wrong joining the waitlist. Please try again.',
  };
}
