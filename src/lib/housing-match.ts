/**
 * Housing match utilities - keep these in lockstep with the SQL
 * normalization in user_current_dorm_matches_building (migration
 * 20260514215826_building_chats_v1.sql):
 *   lower(btrim(regexp_replace(coalesce(name, ''), '\s+', ' ', 'g')))
 *
 * If you change one, change the other.
 */

/**
 * Normalize a residence hall name for comparison.
 * - Coalesces null/undefined to empty string
 * - Trims leading/trailing whitespace
 * - Collapses internal whitespace runs to a single space
 * - Lowercases
 */
export function normalizeResidenceHallName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Does the given user's current_dorm match the given residence hall?
 *
 * Returns true when:
 *   - housingType is exactly 'on-campus'
 *   - normalized currentDorm equals normalized residenceHall
 *
 * Returns false in all other cases, including when either input is
 * empty/null after normalization.
 */
export function userBelongsInBuilding(params: {
  currentDorm: string | null | undefined;
  housingType: string | null | undefined;
  residenceHall: string | null | undefined;
}): boolean {
  if (params.housingType !== 'on-campus') return false;
  const a = normalizeResidenceHallName(params.currentDorm);
  const b = normalizeResidenceHallName(params.residenceHall);
  if (!a || !b) return false;
  return a === b;
}

/**
 * Normalize a floor identifier the same way the schema's partial
 * unique index expects.
 * - Trim, collapse whitespace, lowercase
 * - Returns null if the result is empty (so a blank floor becomes
 *   a building-wide chat, not a separate "" chat)
 */
export function normalizeFloor(floor: string | null | undefined): string | null {
  if (!floor) return null;
  const normalized = floor.replace(/\s+/g, ' ').trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}
