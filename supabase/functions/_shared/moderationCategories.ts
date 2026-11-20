/**
 * OpenAI omni-moderation category buckets + the severity mapping.
 *
 * Moved here from `moderate-listing/categories.ts` (2026-08-06) so the image
 * screen can be shared by every upload path instead of living inside the
 * listing function. Pure data + one pure function: no Deno globals, no network,
 * so vitest can cover it directly.
 *
 * `moderate-listing/categories.ts` is now a re-export shim pointing at this
 * file — the existing test imports that path and must keep passing untouched.
 */

// Severe -> auto-reject. Moderate -> hold for a human moderator.
//
// PRODUCT DECISION 2026-07-26 (Ethan): `harassment/threatening` is SEVERE.
// Marketplace listings end with two students meeting in person to trade cash, so
// a direct violent threat must never sit in a review queue behind human latency.
// Deliberately NOT promoted alongside it:
//   - `harassment`      - rude/insulting but not threatening; a human should judge.
//   - `violence`        - legitimate listings trip this (violent video games,
//                         films, sports/martial-arts gear). Auto-rejecting it
//                         would kill real listings.
export const SEVERE_CATEGORIES = new Set([
  "sexual/minors",
  "sexual",
  "violence/graphic",
  "illicit/violent",
  "self-harm/instructions",
  "self-harm/intent",
  "hate/threatening",
  "harassment/threatening",
]);

export const MODERATE_CATEGORIES = new Set([
  "hate",
  "harassment",
  "illicit",
  "violence",
  "self-harm",
]);

export type Severity = "severe" | "moderate" | "clean";

/** Map the set of flagged omni-moderation categories to a severity bucket. */
export function classifySeverity(categories: string[]): Severity {
  if (categories.some((c) => SEVERE_CATEGORIES.has(c))) return "severe";
  if (categories.some((c) => MODERATE_CATEGORIES.has(c))) return "moderate";
  return "clean";
}
