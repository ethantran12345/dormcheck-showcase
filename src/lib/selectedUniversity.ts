import {
  University,
  activeUniversities,
  getUniversityBySlug,
} from '@/config/universities';

/**
 * Pre-auth school selection.
 *
 * This layer owns the school choice a student makes BEFORE they log in - it
 * decides which provider buttons and OAuth domain hint the auth screen shows.
 * It is deliberately separate from the post-auth `UniversityProvider`
 * (src/contexts/UniversityContext.tsx), which resolves a signed-in user's
 * university from profiles.university_id. Do not conflate the two.
 *
 * While exactly one school is active (today: Pitt), the picker never renders
 * and `resolveSelectedUniversity` always returns that sole school, so there is
 * zero behavior change until a second school activates.
 */

const SELECTED_UNIVERSITY_KEY = 'dc_selected_university';

export function persistSelectedUniversity(slug: string): void {
  try {
    localStorage.setItem(SELECTED_UNIVERSITY_KEY, slug);
  } catch {
    // ignore (private mode / storage disabled)
  }
}

export function clearPersistedUniversity(): void {
  try {
    localStorage.removeItem(SELECTED_UNIVERSITY_KEY);
  } catch {
    // ignore (private mode / storage disabled)
  }
}

export function readPersistedUniversitySlug(): string | null {
  try {
    return localStorage.getItem(SELECTED_UNIVERSITY_KEY);
  } catch {
    return null;
  }
}

/** An active university whose slug OR one of whose email domains matches the
 *  `?school=` param. Lenient so both /select-school (slug) and legacy
 *  domain-style links resolve. */
function matchActiveUniversity(schoolParam: string): University | undefined {
  const needle = schoolParam.trim().toLowerCase();
  if (!needle) return undefined;
  const bySlug = getUniversityBySlug(needle);
  if (bySlug?.isActive) return bySlug;
  return activeUniversities().find((u) =>
    u.emailDomains.some((d) => d.toLowerCase() === needle),
  );
}

/**
 * Resolve the pre-auth selected university, in precedence order:
 *   1. `?school=` param (slug, else email domain) - must be active; persists it
 *   2. persisted localStorage choice (if still active)
 *   3. sole active university (auto-skip the picker)
 *   4. null -> more than one active school and no choice yet: show the picker
 */
export function resolveSelectedUniversity(
  schoolParam?: string | null,
): University | null {
  if (schoolParam) {
    const matched = matchActiveUniversity(schoolParam);
    if (matched) {
      persistSelectedUniversity(matched.slug);
      return matched;
    }
  }

  const active = activeUniversities();

  const persistedSlug = readPersistedUniversitySlug();
  if (persistedSlug) {
    const persisted = active.find((u) => u.slug === persistedSlug);
    if (persisted) return persisted;
  }

  if (active.length === 1) return active[0];

  return null;
}
