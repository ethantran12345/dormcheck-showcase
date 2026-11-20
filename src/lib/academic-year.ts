/**
 * Academic year math, mirrors the SQL current_academic_year() function
 * in migration 20260514223622_building_chat_links_v1.sql.
 *
 * Cutover: May 15
 *   - Jan 1 - May 14: previous_year-current_year (e.g. "2025-2026")
 *   - May 15 - Dec 31: current_year-next_year (e.g. "2026-2027")
 */

export function getCurrentAcademicYear(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed: Jan=0, May=4, Dec=11
  const day = now.getDate();

  // Before May 15 → previous-current
  const beforeCutover = month < 4 || (month === 4 && day < 15);

  if (beforeCutover) {
    return `${year - 1}-${year}`;
  }
  return `${year}-${year + 1}`;
}

export function getPreviousAcademicYear(now: Date = new Date()): string {
  const current = getCurrentAcademicYear(now);
  const [startStr] = current.split('-');
  const start = parseInt(startStr, 10);
  return `${start - 1}-${start}`;
}
