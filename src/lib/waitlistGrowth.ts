import { supabase } from '@/integrations/supabase/client';
import { isActiveUniversityEmail, isEduEmail } from '@/config/universities';
import { resolveApiUrl } from '@/lib/apiPost';

/**
 * Waitlist growth loop: school-level rank aggregates + admin outreach.
 *
 * `get_waitlist_rank` / `university_admin_leads` ship in migration
 * 20260714000000_waitlist_growth.sql (live in prod 2026-07-08); both are
 * in the generated types.ts, so the client is used directly (no casts).
 */

export type WaitlistSchoolAggregate = {
  domain: string;
  school_name: string | null;
  rank: number;
  count: number;
};

export type WaitlistRankResult = {
  domain: string;
  school_name: string | null;
  /** null = domain has no signups yet (e.g. a friend landing pre-join). */
  rank: number | null;
  count: number;
  total_schools: number;
  nearby: WaitlistSchoolAggregate[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseAggregate(value: unknown): WaitlistSchoolAggregate | null {
  const row = asRecord(value);
  if (!row || typeof row.domain !== 'string') return null;
  return {
    domain: row.domain,
    school_name: typeof row.school_name === 'string' ? row.school_name : null,
    rank: Number(row.rank ?? 0),
    count: Number(row.count ?? 0),
  };
}

/** Parse the jsonb payload of get_waitlist_rank. Exported for tests. */
export function parseWaitlistRank(data: unknown): WaitlistRankResult | null {
  const row = asRecord(data);
  if (!row || typeof row.domain !== 'string' || 'error' in row) return null;
  return {
    domain: row.domain,
    school_name: typeof row.school_name === 'string' ? row.school_name : null,
    rank: row.rank == null ? null : Number(row.rank),
    count: Number(row.count ?? 0),
    total_schools: Number(row.total_schools ?? 0),
    nearby: Array.isArray(row.nearby)
      ? row.nearby
          .map(parseAggregate)
          .filter((item): item is WaitlistSchoolAggregate => item != null)
      : [],
  };
}

export async function fetchWaitlistRank(
  domain: string,
): Promise<WaitlistRankResult | null> {
  const { data, error } = await supabase.rpc('get_waitlist_rank', {
    p_domain: domain.trim().toLowerCase(),
  });
  if (error) throw new Error(error.message);
  return parseWaitlistRank(data);
}

export type AdminLeadInput = {
  adminName: string;
  adminRole?: string;
  adminEmail: string;
  schoolDomain: string;
  referredByEmail?: string | null;
};

export type AdminLeadResult = { ok: true } | { ok: false; message: string };

/** Submit a partnership lead through the rate-limited server endpoint. */
export async function submitAdminLead(input: AdminLeadInput): Promise<AdminLeadResult> {
  try {
    const response = await fetch(resolveApiUrl('/api/submit-admin-lead'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminName: input.adminName.trim(),
        adminRole: input.adminRole?.trim() || undefined,
        adminEmail: input.adminEmail.trim(),
        schoolDomain: input.schoolDomain.trim().toLowerCase(),
        referredByEmail: input.referredByEmail?.trim() || undefined,
      }),
    });
    if (response.ok) return { ok: true };
  } catch {
    // Fall through to the existing friendly form error.
  }
  return {
    ok: false,
    message: 'Something went wrong saving the contact. Please try again.',
  };
}

/**
 * School-level share link. Deliberately carries ONLY the school domain - 
 * never the referring student's email (the link is meant to be pasted
 * into group chats).
 */
export function buildShareUrl(domain: string, origin?: string): string {
  const base = origin ?? window.location.origin;
  return `${base}/waitlist?school=${encodeURIComponent(domain.trim().toLowerCase())}`;
}

/** CC address for the pre-written admin email (partnership pipeline). */
export const PARTNERSHIP_CC = 'etran@dormcheck.com';

export type AdminEmailContext = {
  /** School's live waitlist rank; the rank line renders only when both are set. */
  rank?: number | null;
  totalSchools?: number | null;
};

/**
 * Pre-written student-to-admin advocacy email. Honest framing only:
 * backing means the school jumps the line and the partnership process
 * starts - never "goes live immediately". Expanded 2026-07-10 (Date
 * Drop-depth rewrite of the 2026-07-08 template): richer body, optional
 * live-rank line when the page has rank data. Guardrails unchanged: no
 * launch promises, no em dashes.
 */
export function buildAdminEmail(
  schoolName: string,
  context?: AdminEmailContext,
): { subject: string; body: string } {
  const subject = `A free move-in platform ${schoolName} students are asking for`;
  const rankLine =
    context?.rank != null && context?.totalSchools != null
      ? `Right now ${schoolName} is #${context.rank} of ${context.totalSchools} schools on DormCheck's waitlist, and campuses go live faster when the`
      : `${schoolName} is on DormCheck's waitlist, and campuses go live faster when the`;
  const body = [
    'Hi [name / office],',
    '',
    `I'm a student at ${schoolName} and I signed up for DormCheck. I think it would be a great fit for our campus, and I wanted to bring it to your attention.`,
    '',
    `DormCheck is a free platform that helps students move in, live, and move out of college. Every account is verified through a school email, and it gives students a move-in checklist, a student-to-student marketplace for dorm essentials, and building and floor chats so they can meet the people they will actually live with. It is free for students and built to work alongside the systems ${schoolName} already uses, not replace them.`,
    '',
    `${rankLine} housing office or university administration is involved. The DormCheck team handles the setup and logistics of bringing it to a campus, so there is nothing for your office to run or manage.`,
    '',
    "I'd like us to have it here. Would you be open to a short conversation with the DormCheck team about a campus partnership? I've cc'd them so they can share how it works and answer any questions around security or student data. You can also learn more at https://dormcheck.com/for-universities.",
    '',
    'Thanks,',
    '[Your name]',
  ].join('\n');
  return { subject, body };
}

export function buildAdminMailto(
  adminEmail: string,
  schoolName: string,
  context?: AdminEmailContext,
): string {
  const { subject, body } = buildAdminEmail(schoolName, context);
  const params = new URLSearchParams();
  params.set('cc', PARTNERSHIP_CC);
  params.set('subject', subject);
  params.set('body', body);
  // URLSearchParams encodes spaces as '+', which mail clients render
  // literally - mailto needs percent-encoding throughout.
  const query = params.toString().replace(/\+/g, '%20');
  return `mailto:${encodeURIComponent(adminEmail.trim())}?${query}`;
}

const REF_STORAGE_KEY = 'dc_waitlist_ref';

export type WaitlistRef = { domain: string; email: string };

/**
 * Referring-student context handoff (auth waitlist join -> /waitlist).
 * sessionStorage, never the URL: the share link must stay clean of
 * personal emails.
 */
export function storeWaitlistRef(ref: WaitlistRef): void {
  try {
    sessionStorage.setItem(REF_STORAGE_KEY, JSON.stringify(ref));
  } catch {
    // Storage unavailable (private mode etc.) - attribution is optional.
  }
}

export function readWaitlistRef(): WaitlistRef | null {
  try {
    const raw = sessionStorage.getItem(REF_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const row = asRecord(parsed);
    if (!row || typeof row.domain !== 'string' || typeof row.email !== 'string') {
      return null;
    }
    return { domain: row.domain, email: row.email };
  } catch {
    return null;
  }
}

export type ColdStartClassification =
  | { kind: 'invalid' }
  | { kind: 'active' } // already-live campus (Pitt today) - route to sign-in
  | { kind: 'waitlist'; domain: string };

/**
 * Classify a cold-start /waitlist email. Pure and client-side only: the
 * address is never sent anywhere at this step - we only need its domain
 * to look up the school's aggregate rank.
 */
export function classifyWaitlistEmail(email: string): ColdStartClassification {
  if (!isEduEmail(email)) return { kind: 'invalid' };
  if (isActiveUniversityEmail(email)) return { kind: 'active' };
  const domain = emailDomain(email);
  return domain ? { kind: 'waitlist', domain } : { kind: 'invalid' };
}

/** you@school.edu -> school.edu (lowercased); null if not an address. */
export function emailDomain(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;
  return trimmed.slice(at + 1);
}

/** Display name for a school: recorded name, else the bare domain. */
export function schoolDisplayName(
  domain: string,
  schoolName?: string | null,
): string {
  return schoolName?.trim() || domain;
}
