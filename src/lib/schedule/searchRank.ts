/**
 * Rank a catalog search result for a query: lower = more relevant.
 * 0 subject/course-code prefix, 1 catalog-number prefix, 2 title starts-with,
 * 3 title contains, 4 otherwise. Keeps "Chem" -> CHEM courses above
 * title-keyword matches like "Chemical Engineering".
 */
export function rankSection(
  s: { subject: string; catalog_number: string; title: string | null; title_display: string | null },
  query: string,
): number {
  const q = query.trim().toUpperCase();
  const course = `${s.subject} ${s.catalog_number}`;
  if (s.subject.startsWith(q) || course.startsWith(q)) return 0;
  if (s.catalog_number.startsWith(q)) return 1;
  const title = (s.title_display ?? s.title ?? '').toUpperCase();
  if (title.startsWith(q)) return 2;
  if (title.includes(q)) return 3;
  return 4;
}
