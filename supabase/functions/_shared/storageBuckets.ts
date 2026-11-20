/**
 * The storage buckets account deletion may purge, and the ones it must never touch.
 *
 * WHY THIS IS A SHARED FILE. delete-user-account walked a bucket list that lived
 * inside its own index.ts, and nothing outside that file could assert what was on
 * it. The quarantine bucket (20261008000000, BA-07) holds content the REPORT Act
 * (18 U.S.C. § 2258A(h)) requires DormCheck to preserve for ONE YEAR after a
 * report — including when the uploader deletes their account. So the preserved
 * set is declared here, the purge list is derived from it, and
 * src/test/quarantine.test.ts pins that the two can never overlap.
 */

/** Buckets whose `<user id>/…` folder is purged when that user deletes their account. */
export const USER_FOLDER_BUCKETS = [
  "avatars",
  "setup-photos",
  "academic-planners",
  "business-banners",
  "business-logos",
  "marketplace-images",
  "roommate-post-photos",
  "dm-photos",
] as const;

/**
 * Buckets NOT laid out by user folder, purged by OWNER instead (A2, 2026-10-12).
 * `dorm-photos` objects live at `<dorm id>/…` and are uploaded by admins onto
 * public dorm pages, so account deletion removes only the ones this user uploaded
 * that no row still references (public.storage_unreferenced_objects with p_owner).
 * A photo still shown on a dorm page is institutional content and stays.
 */
export const OWNER_SCOPED_BUCKETS = ["dorm-photos"] as const;

/** Private bucket that automated moderation moves rejected images into. */
export const QUARANTINE_BUCKET = "images-quarantine";

/**
 * Private bucket holding held/rejected marketplace photos until a moderator rules
 * (20261013000000). Keyed by listing id, not user folder; released or discarded
 * only by the held-listing-images function.
 */
export const HELD_BUCKET = "images-held";

/**
 * Buckets that account deletion must NEVER purge. Objects here are held under a
 * statutory preservation clock (moderation_actions.preserve_until), not under the
 * uploader's ownership, and are readable by the service role only.
 */
export const PRESERVED_BUCKETS = [QUARANTINE_BUCKET, HELD_BUCKET] as const;

/**
 * The eight public upload buckets the orphan sweeper may delete from. Mirrors the
 * allowlist inside public.storage_unreferenced_objects (20261013000000); a test
 * pins that the two agree and that neither preserved bucket is on it.
 */
export const SWEEPABLE_BUCKETS = [
  "avatars",
  "business-banners",
  "business-logos",
  "dm-photos",
  "dorm-photos",
  "marketplace-images",
  "roommate-post-photos",
  "setup-photos",
] as const;

export function isPreservedBucket(bucket: string): boolean {
  return (PRESERVED_BUCKETS as readonly string[]).includes(bucket);
}

/** The purge list delete-user-account actually walks: never a preserved bucket. */
export function purgeableUserBuckets(): string[] {
  return USER_FOLDER_BUCKETS.filter((b) => !isPreservedBucket(b));
}

/** Owner-scoped buckets account deletion purges (unreferenced objects only). */
export function purgeableOwnerBuckets(): string[] {
  return OWNER_SCOPED_BUCKETS.filter((b) => !isPreservedBucket(b));
}

/** Buckets the sweeper may touch: never a preserved bucket. */
export function sweepableBuckets(): string[] {
  return SWEEPABLE_BUCKETS.filter((b) => !isPreservedBucket(b));
}
