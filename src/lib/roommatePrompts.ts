// Curated roommate profile prompts - single source of truth (Phase 1 of the
// Profile & Onboarding lean spec). Authored now; Phase 2 wires selection +
// display into the profile edit form, an optional onboarding step, and the
// profile card (needs a `profile_prompts` schema migration first).
//
// Tone rule: wholesome + roommate-relevant, NOT dating-app. Each prompt should
// surface how someone actually lives in a shared space - never protected-class
// or romantic framing (see the logged lifestyle-only-matching decision).
//
// English-canonical constants, mirroring the src/lib/roommateOptions.ts pattern.
// The stored value (in profiles.prompts jsonb) IS the English prompt sentence;
// display goes through roommatePromptLabel() -> i18n so nothing renders blank if
// a translation is missing (Phase 2 wiring).

import type { TFunction } from 'i18next';

export const ROOMMATE_PROMPT_OPTIONS = [
  'My ideal Friday night is...',
  'My go-to study spot on campus is...',
  'On weekends you will usually find me...',
  'The way I keep my space is best described as...',
  'A shared-space ground rule I care about is...',
  'My favorite way to unwind after class is...',
  'Something I always keep stocked in the room is...',
  'My morning routine looks like...',
  'The kind of roommate I click with best is...',
  'One thing that makes a place feel like home to me is...',
  'My comfort meal during finals week is...',
  'A club, team, or hobby I want to get into this year is...',
] as const;

export type RoommatePrompt = (typeof ROOMMATE_PROMPT_OPTIONS)[number];

/** Max prompts a student can answer on their profile. */
export const MAX_PROMPTS = 3;

/** A single answered prompt, as stored in profiles.prompts jsonb. */
export interface ProfilePrompt {
  prompt: string;
  answer: string;
}

// English prompt sentence -> i18n key (roommates:prompts.p0 .. p11), keyed by
// index because the sentences are too long to slugify cleanly.
export const PROMPT_VALUE_TO_KEY: Record<string, string> = Object.fromEntries(
  ROOMMATE_PROMPT_OPTIONS.map((prompt, i) => [prompt, `roommates:prompts.p${i}`]),
);

/**
 * Translate a prompt sentence for display. Falls back to the stored English
 * sentence if the key is missing so a prompt never renders blank.
 */
export function roommatePromptLabel(t: TFunction, prompt: string): string {
  if (!prompt) return '';
  const key = PROMPT_VALUE_TO_KEY[prompt];
  return key ? t(key, { defaultValue: prompt }) : prompt;
}
