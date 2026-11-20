/**
 * Determines the graduation year of the current Freshman class.
 * - Before August: current Freshman class graduates in currentYear + 3
 * - August or later: new Freshman class graduates in currentYear + 4
 */
export function getFreshmanGraduationYear(): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed, August = 7
  return month < 7 ? year + 3 : year + 4;
}

export type MainYearToggle = 'Freshmen' | 'Upperclassmen';

export type YearStandingLabel = 'Sophomore' | 'Junior' | 'Senior' | 'Graduate';

export const YEAR_STANDING_LABELS: YearStandingLabel[] = [
  'Sophomore',
  'Junior',
  'Senior',
  'Graduate',
];

/**
 * Formats academic status for display.
 * - Both year and grade_level: "Sophomore • 2028"
 * - Year only: "Class of 2028"
 * - Grade level only: "Sophomore"
 * - Neither: " - "
 */
export function formatAcademicStatus(
  graduationYear: number | null | undefined,
  options?: { gradeLevel?: string | null; graduationSemester?: string | null }
): string {
  const hasYear = graduationYear != null;
  const standing = options?.gradeLevel?.trim() || null;
  const hasStanding = !!standing;

  if (hasYear && hasStanding) {
    return `${standing} • ${graduationYear}`;
  }
  if (hasYear) {
    return `Class of ${graduationYear}`;
  }
  if (hasStanding) {
    return standing;
  }
  return ' - ';
}

/**
 * Builds Supabase filter criteria for main toggle + year standing.
 * - Freshmen: graduation_year === baseYear or grade_level === Freshman
 * - Upperclassmen (no year standing): graduation_year < baseYear or grade_level in Soph/Jr/Sr/Grad
 * - Upperclassmen + year standing: match graduation_year OR grade_level so users without year still appear
 */
export function getGraduationCriteriaForMainAndStanding(
  mainToggle: MainYearToggle,
  yearStandingFilters: YearStandingLabel[],
  baseYear: number
): { exact?: number; orClause?: string; lt?: number; orClauseWithGrade?: string } {
  if (mainToggle === 'Freshmen') {
    return { orClause: `graduation_year.eq.${baseYear},grade_level.eq.Freshman` };
  }
  // Upperclassmen (no standing filter): year < baseYear OR any upperclassman grade_level
  if (yearStandingFilters.length === 0) {
    return {
      orClause: `graduation_year.lt.${baseYear},graduation_year.is.null,grade_level.eq.Sophomore,grade_level.eq.Junior,grade_level.eq.Senior,grade_level.eq.Graduate`,
    };
  }
  const conditions: string[] = [];
  if (yearStandingFilters.includes('Sophomore')) {
    conditions.push(`graduation_year.eq.${baseYear - 1}`);
    conditions.push('grade_level.eq.Sophomore');
  }
  if (yearStandingFilters.includes('Junior')) {
    conditions.push(`graduation_year.eq.${baseYear - 2}`);
    conditions.push('grade_level.eq.Junior');
  }
  if (yearStandingFilters.includes('Senior')) {
    conditions.push(`graduation_year.eq.${baseYear - 3}`);
    conditions.push('grade_level.eq.Senior');
  }
  if (yearStandingFilters.includes('Graduate')) {
    conditions.push(`graduation_year.lt.${baseYear - 3}`);
    conditions.push('grade_level.eq.Graduate');
  }
  return { orClause: conditions.join(',') };
}
