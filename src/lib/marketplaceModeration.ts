/**
 * Client-side helpers for the pre-publish auto-moderation gate.
 *
 * A new listing is inserted as status='pending_review' (hidden from the feed)
 * and the `moderate-listing` edge function runs the hybrid pipeline, then flips
 * it to 'available' (approved) or 'under_review' (held/rejected). These pure
 * helpers keep the create-path toast copy and the owner "In review" UI in sync
 * with that server contract. Backend + rationale: the migration header in
 * supabase/migrations/20260719150000_marketplace_pre_moderation.sql.
 */

/** Verdict the edge function returns; 'pending' is our local stand-in for a
 *  timeout/error where the listing was submitted but has no verdict yet. */
export type ModerationDecision = 'approve' | 'hold' | 'reject' | 'pending';

/** Column value persisted by the edge function on the listing row. */
export type ModerationDecisionColumn = 'approved' | 'held' | 'rejected' | null;

/**
 * True when a listing is still gated by the auto-moderator from the owner's
 * point of view: freshly submitted (pending_review) or held/rejected by the
 * scan (under_review + a held/rejected decision). A plain 'under_review' with
 * no moderation decision is an admin report-hide and intentionally stays opaque
 * to the owner (shown as active), matching the pre-existing behavior.
 */
export function isListingInReview(
  status: string | null | undefined,
  moderationDecision?: ModerationDecisionColumn,
): boolean {
  if (status === 'pending_review') return true;
  if (
    status === 'under_review' &&
    (moderationDecision === 'held' || moderationDecision === 'rejected')
  ) {
    return true;
  }
  return false;
}

/**
 * Map the create-path verdict to how the submit should read. Only a clean
 * 'approve' means the post is live now; everything else (held, rejected, or a
 * timeout/error we treat as still-submitted) reads as "in review" so we never
 * imply the post failed.
 */
export function isListingLiveAfterModeration(decision: ModerationDecision): boolean {
  return decision === 'approve';
}
