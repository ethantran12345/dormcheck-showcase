// Interest taxonomy - Phase 2 profile enrichment (Profile & Onboarding lean spec).
//
// A capped, category-grouped picker of personality/lifestyle interests. This is
// color that makes a profile feel human - it is NOT a matching-algorithm input
// and NOT protected-class data (hobbies only; see the 2026-07-14
// lifestyle-only-matching decision).
//
// Canonical English SLUGS are stored in profiles.interests text[]. This is a
// SEPARATE dimension from profiles.tags (free-text habit chips) and the internal
// `onboarding_interest:`-prefixed signal tags - never reuse or collide with
// either. Display goes through interestLabel() -> i18n, mirroring the
// src/lib/roommateOptions.ts + src/components/roommate/optionLabels.ts pattern.
//
// Keep the list TIGHT (a handful per category) and enforce MAX_INTERESTS
// client-side. The competitor's 200-tag marathon is the anti-pattern.

import type { TFunction } from 'i18next';

/** Global cap on selected interests (enforced in the edit UI). */
export const MAX_INTERESTS = 10;

export interface InterestCategory {
  /** Category slug (stable id). */
  slug: string;
  /** i18n key for the category heading. */
  labelKey: string;
  /** Interest slugs in this category. */
  options: string[];
}

export const INTEREST_CATEGORIES: InterestCategory[] = [
  {
    slug: 'sports',
    labelKey: 'roommates:interests.categories.sports',
    options: ['basketball', 'soccer', 'gym_fitness', 'running', 'hiking', 'intramurals'],
  },
  {
    slug: 'music',
    labelKey: 'roommates:interests.categories.music',
    options: ['hip_hop', 'pop', 'rock', 'edm', 'country', 'live_concerts'],
  },
  {
    slug: 'food',
    labelKey: 'roommates:interests.categories.food',
    options: ['coffee', 'cooking', 'baking', 'restaurants', 'boba', 'late_night_snacks'],
  },
  {
    slug: 'entertainment',
    labelKey: 'roommates:interests.categories.entertainment',
    options: ['movies_tv', 'anime', 'video_games', 'reading', 'art_design', 'photography'],
  },
];

/** All valid interest slugs, in taxonomy order. */
export const ALL_INTEREST_SLUGS: string[] = INTEREST_CATEGORIES.flatMap((c) => c.options);

/** Interest slug -> i18n key (roommates namespace). */
export const INTEREST_VALUE_TO_KEY: Record<string, string> = Object.fromEntries(
  ALL_INTEREST_SLUGS.map((slug) => [slug, `roommates:interests.options.${slug}`]),
);

/**
 * Translate an interest slug for display. Falls back to the slug itself if it is
 * unknown (e.g. a legacy value) so nothing renders blank.
 */
export function interestLabel(t: TFunction, slug: string): string {
  if (!slug) return '';
  const key = INTEREST_VALUE_TO_KEY[slug];
  return key ? t(key, { defaultValue: slug }) : slug;
}
