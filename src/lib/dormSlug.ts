import type { Dorm } from '@/types';

/** URL segment from residence name: lowercase, whitespace → hyphens */
export function dormSlugFromName(name: string): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
}

export function findDormBySlugInList(dorms: Dorm[], slug: string): Dorm | null {
  return dorms.find((d) => dormSlugFromName(d.name) === slug) ?? null;
}
