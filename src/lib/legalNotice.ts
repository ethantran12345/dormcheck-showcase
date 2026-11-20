/**
 * In-platform material-change notice for Terms / Privacy.
 *
 * Privacy §11 commits DormCheck to communicating material changes to the legal
 * documents in-platform or by email. This module is the in-platform half: the
 * single version string that decides whether a signed-in user still needs to be
 * told, plus the predicate that compares it against what they have acknowledged.
 *
 * HOW TO USE IT WHEN THE LEGAL COPY CHANGES:
 *   1. Ship the new Terms / Privacy copy.
 *   2. Bump LEGAL_NOTICE_VERSION here to the new "Last updated" date.
 *   3. That is the whole change. Every user's stored acknowledgement no longer
 *      matches, so the notice reappears for all of them exactly once.
 *
 * Do NOT reuse a retired version string, and do not bump this for a typo fix or
 * a formatting pass. A notice that fires for trivial edits trains people to
 * dismiss the one that matters.
 */

/**
 * The "Last updated" date of the currently published Terms / Privacy, as an
 * ISO date. Compared as an opaque string, never parsed or ordered, so the
 * format is free to change later without a migration.
 *
 * 2026-08-12: Terms and Privacy went multi-tenant (Pitt, CMU, Carlow named
 * rather than Pitt alone) and the minimum age moved from 13 to 18.
 *
 * 2026-08-18: subleases went on a map. A sublease listing now REQUIRES an
 * address, that address is sent to a third-party mapping provider to be turned
 * into coordinates, and the result is published as a pin visible to everyone who
 * can see the listing. A new outbound data flow plus a new public display of
 * user-entered data is the material-change case this module exists for, so the
 * version moves and every acknowledgement is invalidated once. The same pass
 * removed the class-schedule collection bullet, the schedule feature having been
 * retired in this release.
 */
export const LEGAL_NOTICE_VERSION = '2026-08-18';

/**
 * True when a signed-in user has not yet acknowledged the current legal notice.
 *
 * NULL / undefined (never acknowledged, including every row that predates the
 * column) and any older version both mean "still needs telling". Equality
 * rather than an ordering comparison is deliberate: it keeps the check correct
 * even if a version string is ever non-chronological, and it fails toward
 * showing the notice rather than silently suppressing it.
 */
export function needsLegalNotice(acknowledgedVersion: string | null | undefined): boolean {
  return acknowledgedVersion !== LEGAL_NOTICE_VERSION;
}
