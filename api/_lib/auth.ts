import type { VercelRequest } from '@vercel/node';
import { supabase } from './supabase.js';

export type AuthedUser = { id: string; email: string | null };

/** Email domains allowed to use DormCheck (mirrors the client gates + the
 *  validate_university_email() trigger on auth.users, which reads ACTIVE rows
 *  in public.universities). Keep in sync with src/config/universities.ts
 *  (source of truth) - this API bundle is built separately from src/ and
 *  cannot import from it. Add 'andrew.cmu.edu' and 'cmu.edu' HERE as part of
 *  the CMU flip (handoff-cmu-multi-university-activation.md step 8), not
 *  before - while CMU is inactive this list must stay Pitt-only.
 *
 *  CARLOW (tenant #3) is activated in the same release across this allowlist,
 *  src/config/universities.ts, and public.universities. The student suffix is
 *  confirmed by Carlow's official FERPA release form. */
const ALLOWED_EMAIL_DOMAINS = [
  'pitt.edu',
  'andrew.cmu.edu',
  'cmu.edu',
  'live.carlow.edu',
  'carlow.edu',
];

/** Server-side allowed-domain assertion. Case-insensitive; rejects null/empty. */
export function isAllowedEmailDomain(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  return ALLOWED_EMAIL_DOMAINS.some((domain) => normalized.endsWith('@' + domain));
}

/**
 * Verifies the Supabase JWT from the Authorization header AND re-checks the
 * allowed-domain gate server-side (all tenants in `ALLOWED_EMAIL_DOMAINS`, not
 * just Pitt). The client gates and the auth.users INSERT trigger are not enough
 * on their own - a custom client with a valid JWT for a non-allowed account
 * would otherwise reach these handlers. Returns the authenticated user, or null
 * if the token is missing/invalid/not from an allowed domain.
 */
export async function getAuthedUser(
  req: VercelRequest,
  opts?: { requireAal2?: boolean },
): Promise<AuthedUser | null> {
  if (!supabase) return null;
  const header = req.headers.authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(Array.isArray(header) ? header[0] : header);
  if (!match) return null;
  const { data, error } = await supabase.auth.getUser(match[1]);
  if (error || !data.user) return null;
  const email = data.user.email ?? null;
  if (!isAllowedEmailDomain(email)) return null;
  // MFA step-up for admin surfaces: a phished password alone yields an aal1
  // JWT, which must not reach api/admin/*. Enforcement is opt-in per rollout
  // (REQUIRE_ADMIN_AAL2=1) so it cannot lock out an admin with no enrolled
  // factor before the staged DB migration + enrollment happen together.
  if (opts?.requireAal2 && process.env.REQUIRE_ADMIN_AAL2 === '1') {
    if (readJwtAal(match[1]) !== 'aal2') return null;
  }
  return { id: data.user.id, email };
}

/** Assurance level from an already-verified JWT payload (no signature trust). */
function readJwtAal(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { aal?: string };
    return parsed.aal ?? null;
  } catch {
    return null;
  }
}

/**
 * True if a block exists in either direction between two users. Used to stop
 * notification/invite handlers from relaying mail or push to/from a blocked
 * counterparty. Queried with the service-role client (bypasses RLS by design).
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function areUsersBlocked(a: string, b: string): Promise<boolean> {
  if (!supabase) return false;
  // Inputs are JWT-derived today, but they feed a string-built PostgREST .or()
  // filter - validate anyway, and fail closed (treat as blocked = skip the
  // notification) on anything that is not a UUID.
  if (!UUID_PATTERN.test(a) || !UUID_PATTERN.test(b)) return true;
  const { data } = await supabase
    .from('blocked_users')
    .select('blocker_id')
    .or(`and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`)
    .limit(1);
  return !!data?.length;
}

/** Display name for the authenticated caller, from their profile. */
export async function getCallerName(userId: string, fallbackEmail: string | null): Promise<string> {
  if (supabase) {
    const { data } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .maybeSingle();
    const name = (data as { full_name?: string | null } | null)?.full_name?.trim();
    if (name) return name;
  }
  return fallbackEmail?.split('@')[0] ?? 'Someone';
}
