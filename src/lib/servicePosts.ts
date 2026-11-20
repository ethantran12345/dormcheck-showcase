import {
  SERVICE_CATEGORIES,
  SERVICE_POST_PRICE,
  type PostType,
  type ServiceCategory,
  type ServiceStatus,
  isServicePostType,
  serviceCategoryNeedsIntegrityTerms,
} from '@/lib/postTypes';

/**
 * Student services: the structured half of a `request_help` / `offer_help` post.
 *
 * NO PAYMENTS, and it is this file's job not to grow one. There is no rate, no
 * hourly figure, no deposit, no "amount owed" and no settle-up step anywhere in
 * this flow — a service post's `price` is pinned at 0 in the row and the field
 * is not rendered. Whatever two students agree between themselves is theirs;
 * DormCheck does not know about it, hold it, or track it. If a future ask here
 * starts with "just a small number for what it's worth", it belongs in the
 * post's free-text notes, not in a field this app can total.
 *
 * Everything else about a service post — moderation, reporting, tenant scope,
 * the guest view — is inherited from marketplace_listings and lives nowhere
 * special. See migration 20260910000000_marketplace_service_posts.sql.
 */

/** The draft shape the create page holds for the service block. */
export type ServiceDraft = {
  service_category?: ServiceCategory | null;
  service_date?: string | null;
  service_duration_minutes?: number | null;
  service_location?: string | null;
  service_notes?: string | null;
  /** Transient: the tutoring integrity acknowledgement, never a column. */
  service_integrity_ack?: boolean;
};

/** Mirrors `marketplace_listings_service_notes_check`. */
export const SERVICE_NOTES_MAX = 500;

/**
 * Offered durations, in minutes. A free-text box invites "a few hours ish",
 * which nobody can filter or plan around; the point of the structured field is
 * that a helper can tell at a glance whether it fits between classes.
 */
export const SERVICE_DURATION_OPTIONS = [30, 60, 120, 180, 240, 480] as const;

export function isServiceCategory(value: unknown): value is ServiceCategory {
  return typeof value === 'string' && (SERVICE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * The first unmet structured requirement, or null. Ordered to match the field
 * order down the form so the blocked-reason line points at the next thing to
 * touch — the same contract as `firstUnmetSubleaseTerm`.
 *
 * Only the category is genuinely required: the DB demands it, and a post with no
 * task type cannot be read at a glance. Date, duration and location are real
 * fields but an optional ask ("whenever, an hour-ish, my dorm") is a legitimate
 * post, and requiring them would turn a two-line favour into a form.
 */
export type UnmetServiceDetail =
  | 'category'
  | 'integrityAck'
  | 'notesLength'
  | 'pastDate'
  | null;

export function firstUnmetServiceDetail(draft: ServiceDraft): UnmetServiceDetail {
  if (!isServiceCategory(draft.service_category)) return 'category';
  // Immediately after the category, because the notice appears the moment the
  // category is picked and reading it is the point.
  if (serviceCategoryNeedsIntegrityTerms(draft.service_category) && !draft.service_integrity_ack) {
    return 'integrityAck';
  }
  if ((draft.service_notes?.length ?? 0) > SERVICE_NOTES_MAX) return 'notesLength';
  if (draft.service_date && draft.service_date < todayIso()) return 'pastDate';
  return null;
}

/** Local date as YYYY-MM-DD. `toISOString()` is UTC and rejects "today" for
 *  anyone west of Greenwich after 8pm, which reads as a broken date picker. */
export function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * The columns a service post contributes to the INSERT. Returns the empty
 * object for a non-service type, so the create path can spread it
 * unconditionally and a non-service row never carries a stray service column —
 * which `marketplace_listings_service_shape_check` would reject anyway.
 */
export function serviceInsertColumns(
  postType: PostType,
  draft: ServiceDraft,
): Record<string, unknown> {
  if (!isServicePostType(postType)) return {};
  return {
    price: SERVICE_POST_PRICE,
    service_category: draft.service_category ?? null,
    service_date: draft.service_date || null,
    service_duration_minutes: draft.service_duration_minutes ?? null,
    service_location: draft.service_location?.trim() || null,
    service_notes: draft.service_notes?.trim() || null,
  };
}

/** i18n key for a service status badge. */
export function serviceStatusLabelKey(status: ServiceStatus | string): string {
  return `marketplace:service.status.${status}`;
}

/** Can the signed-in student claim this post? Mirrors `claim_service_post()`;
 *  the RPC is the gate, this only decides whether to render the button. */
export function canClaimServicePost(
  listing: { user_id: string; status?: string | null; post_type?: string | null },
  viewerId: string | null | undefined,
): boolean {
  if (!viewerId) return false;
  if (listing.post_type !== 'request_help' && listing.post_type !== 'offer_help') return false;
  if (listing.status !== 'open') return false;
  return listing.user_id !== viewerId;
}

/** Can the signed-in student close a claimed post out? Either side was there. */
export function canCompleteServicePost(
  listing: { user_id: string; status?: string | null; claimed_by?: string | null },
  viewerId: string | null | undefined,
): boolean {
  if (!viewerId) return false;
  if (listing.status !== 'claimed') return false;
  return listing.user_id === viewerId || listing.claimed_by === viewerId;
}

/**
 * Is this ROW a service post? Reads the row's own discriminator rather than the
 * feed's selected chip, so a shared link, a deep link or a mixed list renders
 * correctly. Every surface that would otherwise print a price branches on this.
 */
export function isServiceListing(listing: { post_type?: string | null }): boolean {
  return listing.post_type === 'request_help' || listing.post_type === 'offer_help';
}
