import { describe, it, expect } from 'vitest';
import {
  isListingInReview,
  isListingLiveAfterModeration,
} from '@/lib/marketplaceModeration';

describe('isListingInReview', () => {
  it('holds a freshly inserted pending_review listing in review', () => {
    // The create path inserts pending_review; it must read as "In review" to the
    // owner until moderate-listing renders a verdict.
    expect(isListingInReview('pending_review', null)).toBe(true);
    expect(isListingInReview('pending_review', undefined)).toBe(true);
  });

  it('treats under_review + held/rejected as in review', () => {
    expect(isListingInReview('under_review', 'held')).toBe(true);
    expect(isListingInReview('under_review', 'rejected')).toBe(true);
  });

  it('keeps admin report-hides (under_review, no decision) opaque to the owner', () => {
    // Pre-existing behavior: a report-hidden listing shows as active, not "In
    // review", so the owner is not tipped off during moderation.
    expect(isListingInReview('under_review', null)).toBe(false);
    expect(isListingInReview('under_review', undefined)).toBe(false);
    expect(isListingInReview('under_review', 'approved')).toBe(false);
  });

  it('is false for normal live/terminal states', () => {
    expect(isListingInReview('available', 'approved')).toBe(false);
    expect(isListingInReview('available', null)).toBe(false);
    expect(isListingInReview('pending', null)).toBe(false);
    expect(isListingInReview('sold', null)).toBe(false);
    expect(isListingInReview('expired', 'rejected')).toBe(false);
    expect(isListingInReview(undefined, null)).toBe(false);
  });
});

describe('isListingLiveAfterModeration', () => {
  it('only a clean approve means the post is live now', () => {
    expect(isListingLiveAfterModeration('approve')).toBe(true);
  });

  it('held, rejected, or no-verdict all read as still in review (never a failure)', () => {
    expect(isListingLiveAfterModeration('hold')).toBe(false);
    expect(isListingLiveAfterModeration('reject')).toBe(false);
    expect(isListingLiveAfterModeration('pending')).toBe(false);
  });
});
