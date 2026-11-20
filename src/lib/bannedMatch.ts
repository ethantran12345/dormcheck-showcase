import { SKIP_ADVISORIES, type SkipAdvisory } from '@/data/skipAdvisories';

/**
 * Match a Shop product against the Pitt banned-items advisories
 * (skipAdvisories entries with `banned: true`) by checking each advisory's
 * `matchItemNames` keywords as whole-word substrings of the product name.
 * Returns the first matching advisory, or null.
 */
export function findBannedAdvisory(productName: string): SkipAdvisory | null {
  const name = productName.trim().toLowerCase();
  if (!name) return null;
  for (const advisory of SKIP_ADVISORIES) {
    if (!advisory.banned || !advisory.matchItemNames?.length) continue;
    for (const keyword of advisory.matchItemNames) {
      const kw = keyword.trim().toLowerCase();
      if (!kw) continue;
      // Whole-word match so "scooter" doesn't hit "scooter poster" false-positives
      // less than a bare includes() would; word boundaries keep "iron" from
      // matching "environment".
      const re = new RegExp(`(^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`);
      if (re.test(name)) return advisory;
    }
  }
  return null;
}
