/**
 * Quarantine bookkeeping for rejected images (BA-07,
 * docs/audits/backend-audit-2026-09-06.md; vault "CSAM Compliance Scope 2026-08-06").
 *
 * THE RULE. 18 U.S.C. § 2258A(h), as amended by the REPORT Act (2024-05-07),
 * treats a CyberTipline report as a request to preserve the reported content for
 * ONE YEAR. Until 20261008000000 there was nowhere for flagged content to go: the
 * caller deleted the object it had just uploaded, so detection would have
 * destroyed the very material a report obliges DormCheck to keep. This module is
 * the pure part of the fix — where a rejected object goes, and how long it stays.
 *
 * The bucket is private (service role only), account deletion skips it
 * (storageBuckets.ts), and moderation_actions carries the path and the clock.
 * Hash matching and NCMEC reporting are still deliberately NOT built; the deploy
 * gate (scripts/edge-deploy-gate.mjs) refuses to deploy moderate-image until the
 * bucket and the deletion carve-out both exist in the target project.
 */
import { QUARANTINE_BUCKET } from "./storageBuckets.ts";

/** One year, in days. The statute says "1 year"; a leap day only lengthens it. */
export const PRESERVE_DAYS = 366;

export interface StorageObjectRef {
  bucket: string;
  path: string;
}

/**
 * Turn a public storage URL of THIS project into {bucket, path}, or null when it
 * is anything else. moderate-image already refuses URLs outside the project's
 * public prefix; this is the parse step that follows that check.
 */
export function parsePublicStorageUrl(url: string): StorageObjectRef | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const m = u.pathname.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const bucket = decodeURIComponent(m[1]);
  const path = decodeURIComponent(m[2]);
  if (!bucket || !path || path.includes("..")) return null;
  return { bucket, path };
}

/**
 * Where a rejected object lives inside the quarantine bucket. Deterministic and
 * collision-free per source object and moment: the source bucket and path are
 * kept so an auditor can see where it came from without any other row.
 */
export function quarantinePathFor(
  ref: StorageObjectRef,
  context: string,
  now: Date,
): string {
  const day = now.toISOString().slice(0, 10);
  const stamp = now.getTime();
  return `${day}/${context}/${ref.bucket}/${stamp}-${ref.path}`;
}

/**
 * The one category that makes an image possible child-safety evidence. Anything
 * flagged with it is PRESERVED, whatever the verdict — never deleted, even on a
 * hold (Ethan, 2026-10-12: "Never delete possible child-safety evidence").
 */
export const CHILD_SAFETY_CATEGORY = "sexual/minors";

export function mustPreserve(categories: readonly string[]): boolean {
  return categories.includes(CHILD_SAFETY_CATEGORY);
}

/**
 * What moderate-image does with the screened objects (A2, 20261013000000):
 *   approve → keep it where it is
 *   reject  → quarantine (moved to images-quarantine under the one-year clock)
 *   hold    → delete it from the public bucket server-side, UNLESS it carries
 *             the child-safety category, which quarantines it exactly like a reject.
 * Today sexual/minors is a SEVERE category, so a hold cannot carry it; the hold
 * branch still checks, so moving that category's bucket can never turn evidence
 * into a delete.
 */
export type ImageDisposition = "keep" | "quarantine" | "delete";

export function imageDisposition(
  decision: "approve" | "hold" | "reject",
  categories: readonly string[],
): ImageDisposition {
  if (decision === "approve") return "keep";
  if (decision === "reject") return "quarantine";
  return mustPreserve(categories) ? "quarantine" : "delete";
}

/** The moment before which a quarantined object must not be purged. */
export function preserveUntil(now: Date): Date {
  return new Date(now.getTime() + PRESERVE_DAYS * 24 * 60 * 60 * 1000);
}

export { QUARANTINE_BUCKET };
