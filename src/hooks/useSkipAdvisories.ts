import { useMemo } from 'react';
import { SKIP_ADVISORIES, type SkipAdvisory } from '@/data/skipAdvisories';
import type { ChecklistItem } from '@/types';

const normalize = (s: string) => s.trim().toLowerCase();

export type UseSkipAdvisoriesResult = {
  /** Key: normalized item name → matching advisory */
  inlineBadges: Map<string, SkipAdvisory>;
  /** Advisories that don't match any current checklist row */
  skipSection: SkipAdvisory[];
};

export function useSkipAdvisories(items: ChecklistItem[]): UseSkipAdvisoriesResult {
  return useMemo(() => {
    const userItemNames = new Set(items.map((i) => normalize(i.item)));
    const inlineBadges = new Map<string, SkipAdvisory>();
    const skipSection: SkipAdvisory[] = [];

    for (const adv of SKIP_ADVISORIES) {
      const matches = adv.matchItemNames?.map(normalize) ?? [];
      const matchedName = matches.find((m) => userItemNames.has(m));

      if (matchedName) {
        for (const candidateName of matches) {
          if (userItemNames.has(candidateName)) {
            inlineBadges.set(candidateName, adv);
          }
        }
      } else {
        skipSection.push(adv);
      }
    }

    return { inlineBadges, skipSection };
  }, [items]);
}
