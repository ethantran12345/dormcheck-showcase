import type { UniversityFeatureOverrides } from '@/hooks/useFeatureFlags';

/**
 * Mirrors public.universities.id for the Pitt seed row
 * (supabase/migrations/20260707034339_multi_university_groundwork.sql).
 * Never change once shipped - DB rows are backfilled against it.
 */
export const PITT_UNIVERSITY_ID = '00000000-0000-4000-8000-000000000001';

/** Login methods a school can expose. Each maps to a provider button (or the
 *  always-present email/password form) on the auth screen.
 *  'saml' is inert groundwork for campus SSO (Shibboleth/InCommon via the
 *  Supabase SSO provider API). This is NOT dead code and NOT Pitt-specific: it
 *  is the same config-driven path any school's SSO uses, blocked on the school's
 *  IT rather than on us. No school lists it yet, and none may until that school's
 *  IT has cleared the integration.
 *  The readiness note was vendor paperwork and was removed 2026-08-06; retrieve
 *  it with `git show ec16fc14:docs/sso-readiness.md`. */
export type AuthMethod = 'microsoft' | 'google' | 'email' | 'saml';

export type University = {
  /** uuid - mirrors universities.id in the DB */
  id: string;
  /** key for content registries (e.g. 'pitt') */
  slug: string;
  name: string;
  shortName: string;
  /** exact-match domains, lowercase, no '@' (subdomains do not match) */
  emailDomains: string[];
  city: string;
  /** whether signups/login are live for this tenant; the school picker lists
   *  only active schools and auto-skips while exactly one is active */
  isActive: boolean;
  /** logins that are LIVE and working for this school right now. Array order =
   *  button display order on the auth screen. */
  authMethods: AuthMethod[];
  brand?: {
    logoSrc?: string;
    primaryColor?: string;
  };
  /** Campus map default center, Mapbox order [lng, lat]. */
  campusCenter: [number, number];
  /**
   * Static per-tenant surface overrides, merged UNDER `universities.feature_flags`
   * (the DB row wins) and OVER the global defaults — see `useFeatureFlags`.
   * Live since 2026-08-05: this is how one school can run a marketplace post
   * type another does not, without a branch. Omit for the global defaults.
   */
  features?: UniversityFeatureOverrides;
  /** Master surface gate for this school. Omitted → global LIMITED_SURFACES default. */
  limitedSurfaces?: boolean;
};

export const PITT: University = {
  id: PITT_UNIVERSITY_ID,
  slug: 'pitt',
  name: 'University of Pittsburgh',
  shortName: 'Pitt',
  emailDomains: ['pitt.edu'],
  city: 'Pittsburgh, PA',
  isActive: true,
  // Microsoft is omitted until Pitt Entra admin-consent lands - "Continue with
  // Microsoft" currently hits a "needs admin approval" wall. Google Workspace
  // and email both work on @pitt.edu today. To restore Microsoft, add
  // 'microsoft' to this array (one line):
  // https://login.microsoftonline.com/pitt.edu/adminconsent?client_id=131b7890-6b60-45f1-b9d9-a921fc9e75ab
  authMethods: ['google', 'email'],
  // Schenley Quad - mirrors the long-standing MapView default.
  campusCenter: [-79.956, 40.443],
  // Pitt stays on the reduced surface set (checklist, marketplace, messages).
  limitedSurfaces: true,
  // ...except housing browse, restored 2026-08-05 per vault
  // `Reviews Subleases Services PRD.md` §5b. Dorm reviews are spec'd onto the
  // dorm detail portal, which sits behind showHousing; shipping them under the
  // master gate would ship a feature no student can reach. Unlocks /housing,
  // /campus, /gallery and the dorm detail portal.
  //
  // This is a per-surface override, NOT `limitedSurfaces: false` — Roommates, Map,
  // Rankings and Saved Dorms stay off, since those are engagement features that
  // need a userbase that does not exist yet.
  features: { showHousing: true },
};

/**
 * Mirrors public.universities.id for the CMU seed row
 * (supabase/migrations/20260710055408_seed_cmu_university.sql).
 * Never change once shipped - DB rows are seeded against it.
 */
export const CMU_UNIVERSITY_ID = '00000000-0000-4000-8000-000000000002';

export const CMU: University = {
  id: CMU_UNIVERSITY_ID,
  slug: 'cmu',
  name: 'Carnegie Mellon University',
  shortName: 'CMU',
  emailDomains: ['andrew.cmu.edu', 'cmu.edu'],
  city: 'Pittsburgh, PA',
  // Flipped live 2026-07-10 alongside the prod flip (UPDATE universities SET
  // is_active = true WHERE slug = 'cmu') and the api/_lib/auth.ts domain
  // additions - see handoff-cmu-multi-university-activation.md step 8.
  isActive: true,
  // Email-only at launch (Ethan, 2026-07-10); add SSO once verified for CMU domains.
  authMethods: ['email'],
  // The Cut / Forbes & Morewood - center of the CMU campus core.
  campusCenter: [-79.9426, 40.4433],
  // CMU launched un-gated (Ethan, 2026-07-11): full app from day one -
  // see handoff-cmu-ungate-phase1.md.
  limitedSurfaces: false,
};

/**
 * Mirrors public.universities.id for the Carlow seed row
 * (supabase/migrations/20260918000001_seed_carlow_university.sql).
 * Never change once shipped - DB rows are seeded against it.
 */
export const CARLOW_UNIVERSITY_ID = '00000000-0000-4000-8000-000000000003';

export const CARLOW: University = {
  id: CARLOW_UNIVERSITY_ID,
  slug: 'carlow',
  name: 'Carlow University',
  shortName: 'Carlow',
  // Student mailboxes are documented as @live.carlow.edu; carlow.edu is the
  // staff/department domain. Both are listed for the same reason CMU carries
  // both of its domains - see the seed migration's header, which also records
  // Confirmed from Carlow's official FERPA release form, whose student email
  // field requires the @live.carlow.edu suffix. carlow.edu remains included
  // for staff accounts published across Carlow's official directory.
  emailDomains: ['live.carlow.edu', 'carlow.edu'],
  city: 'Pittsburgh, PA',
  // Tenant #3 activation is completed with the matching DB row and server
  // allowlist in the same release. Production remains the final authority.
  isActive: true,
  // Email-only at launch, as CMU did; add SSO once verified for Carlow domains.
  authMethods: ['email'],
  // 3333 Fifth Avenue. CORRECTED 2026-08-11 from a recalled -79.9497 after
  // OpenStreetMap and the Mapbox geocoder independently put the campus at
  // roughly -79.964 - appreciably WEST of Pitt's Cathedral (-79.9531), not east
  // of it. The first value would have opened every Carlow map about a kilometre
  // off, on Pitt's campus.
  campusCenter: [-79.964, 40.4388],
  // Launch on the reliable shared core: map, rankings and roommate discovery stay
  // gated rather than presenting an empty or borrowed campus experience.
  limitedSurfaces: true,
  // Housing browse turned ON 2026-08-27 (Ethan), bringing Carlow in line with Pitt
  // and CMU so dorms are the default housing surface for every live tenant.
  //
  // Stated plainly because it is the one thing to watch: prod has exactly TWO
  // Carlow rows in `master_housing` — Dougherty Hall and Frances Warde Hall, both
  // real halls — and they are skeletal. Coordinates only: no `image_url`, no
  // `details`, no `capacity`. So a Carlow student now gets a two-card dorms list
  // with no photos and no detail content, against 142 rows for Pitt and 65 for
  // CMU. That is a content gap, not a code one; seeding those two rows is what
  // makes this surface worth reaching.
  features: { showHousing: true },
};

export const UNIVERSITIES: Record<string, University> = {
  [PITT.slug]: PITT,
  [CMU.slug]: CMU,
  [CARLOW.slug]: CARLOW,
};

export const DEFAULT_UNIVERSITY: University = PITT;

/** Schools with signups/login live right now. */
export function activeUniversities(): University[] {
  return Object.values(UNIVERSITIES).filter((u) => u.isActive);
}

export function getUniversityBySlug(slug: string): University | undefined {
  return UNIVERSITIES[slug];
}

export function getUniversityById(id: string): University | undefined {
  return Object.values(UNIVERSITIES).find((u) => u.id === id);
}

export function primaryEmailDomain(university: University): string {
  return university.emailDomains[0];
}

/**
 * Exact-domain email check. `endsWith('@' + domain)` keeps the accepted set
 * character-identical to the original `isPittEmail` (`.endsWith('@pitt.edu')`).
 */
export function isUniversityEmail(
  university: University,
  email: string | undefined | null,
): boolean {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  return university.emailDomains.some((domain) => normalized.endsWith('@' + domain));
}

/**
 * True if the email belongs to ANY configured active university.
 * The signup gate uses the per-university check; this is the correct predicate
 * for "should we route this address to the waitlist" - as more tenants activate,
 * their students stop seeing the waitlist without touching the auth flow.
 */
export function isActiveUniversityEmail(email: string | undefined | null): boolean {
  return activeUniversities().some((u) => isUniversityEmail(u, email));
}

/**
 * Resolves the active university an email actually belongs to, for auth-flow
 * callers (OAuth deep links, magic-link callbacks) that only ever see a
 * session email - no picked-school context to fall back on. Do NOT default
 * these callers to DEFAULT_UNIVERSITY (Pitt): that silently rejects every
 * other active tenant's students.
 */
export function resolveUniversityByEmail(
  email: string | undefined | null,
): University | undefined {
  return activeUniversities().find((u) => isUniversityEmail(u, email));
}

/**
 * True for any well-formed address on a `.edu` domain (including subdomains,
 * e.g. student@mail.school.edu). The waitlist is for students only: a valid
 * `.edu` that isn't an active university joins the waitlist; anything else
 * gets the "use your school (.edu) email" message. Not an access check - 
 * signup stays gated by isUniversityEmail / the DB trigger.
 */
export function isEduEmail(email: string | undefined | null): boolean {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && /\.edu$/.test(normalized);
}
