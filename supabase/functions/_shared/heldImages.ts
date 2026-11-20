/**
 * Held marketplace photos (A2, 20261013000000). Pure helpers only: no Deno
 * globals, no network, so src/test/heldListingImages.test.ts covers them directly.
 *
 * THE GAP. moderate-listing gated FEED visibility only. A held or rejected listing's
 * photos stayed at public marketplace-images URLs for as long as it sat in the
 * queue (docs/audits/storage-buckets.md gap 1). Now, on a hold or reject, each
 * photo MOVES into the private images-held bucket at `<listing id>/<source path>`
 * and the listing's image_urls are left as they were. An admin approve moves every
 * object back to the exact same path, so the stored URLs work again unchanged; an
 * admin reject deletes them. No client-writable column records what was moved:
 * the `<listing id>/` prefix in a service-role-only bucket is the only record, so
 * an owner cannot point a release at objects that are not theirs.
 */
import { parsePublicStorageUrl } from "./quarantine.ts";
import { HELD_BUCKET } from "./storageBuckets.ts";

export const LISTING_IMAGES_BUCKET = "marketplace-images";

/** Signed URLs an admin sees are short-lived on purpose. */
export const HELD_SIGNED_URL_TTL_SECONDS = 300;

/**
 * The image_urls entries that are the OWNER'S objects in this project's
 * marketplace bucket. image_urls is owner-written, so without the folder check a
 * listing that pointed at someone else's photo could get THAT photo moved out of
 * the public bucket by its own hold. Uploads are `<owner id>/<file>`.
 */
export function listingObjectPaths(imageUrls: readonly string[], ownerId: string): string[] {
  const out: string[] = [];
  for (const url of imageUrls) {
    const ref = parsePublicStorageUrl(url);
    if (
      ref &&
      ref.bucket === LISTING_IMAGES_BUCKET &&
      ownerId &&
      ref.path.startsWith(`${ownerId}/`) &&
      !out.includes(ref.path)
    ) {
      out.push(ref.path);
    }
  }
  return out;
}

export function heldPathFor(listingId: string, sourcePath: string): string {
  return `${listingId}/${sourcePath}`;
}

/** The marketplace-images path a held object returns to, or null if it is not this listing's. */
export function sourcePathFromHeld(listingId: string, heldPath: string): string | null {
  const prefix = `${listingId}/`;
  if (!heldPath.startsWith(prefix)) return null;
  const rest = heldPath.slice(prefix.length);
  if (!rest || rest.includes("..")) return null;
  return rest;
}

export { HELD_BUCKET };
