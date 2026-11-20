/**
 * Tenant-neutral fallback for a person's display name.
 *
 * This used to be the literal `'Pitt student'`, duplicated across the DM list,
 * the DM unread notification, the marketplace seller line and seller ratings.
 * Every one of those surfaces is live for CMU, so a CMU student with an unnamed
 * counterparty read the word "Pitt" inside their own school's app.
 *
 * The fallback is deliberately school-FREE rather than derived from the viewer's
 * university. Deriving it would be correct only while RLS confines every one of
 * these surfaces to a single tenant: the moment marketplace listings are shared
 * across schools, "CMU student" printed under a Pitt seller is a new falsehood
 * in the same slot. A neutral noun is true for every tenant, in both worlds.
 *
 * The school still reaches the student where it is actually known and actually
 * about that person: the `Verified {{school}} Student` badge
 * (`marketplace:badge.verifiedStudent`), which resolves per-profile.
 */
export const STUDENT_DISPLAY_FALLBACK = 'Student';

/**
 * First non-empty trimmed name, else the neutral fallback. Accepts the several
 * shapes the call sites hold a name in (joined profile, realtime payload,
 * conversation cache), so none of them re-implement the trim-and-default dance.
 */
export function studentDisplayName(...names: (string | null | undefined)[]): string {
  for (const name of names) {
    const trimmed = name?.trim();
    if (trimmed) return trimmed;
  }
  return STUDENT_DISPLAY_FALLBACK;
}
