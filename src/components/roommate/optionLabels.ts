// Display-label lookup for roommate compatibility options.
//
// The values in `@/lib/roommateOptions` (e.g. 'Very Clean', 'Social',
// 'No Smoking') are the PERSISTED database values and the keys the pure
// matching logic in `@/lib/roommateMatch` compares against. They must never be
// translated in place. Instead, translate only at render time via this lookup,
// keyed by the exact English value. Any value NOT in the map (a user-typed
// custom boundary chip) falls through to its raw text, keeping user-generated
// content in the language the user wrote it.

import type { TFunction } from 'i18next';

/** English option value -> fully-qualified i18n key under the roommates ns. */
const VALUE_TO_KEY: Record<string, string> = {
  // Cleanliness
  'Very Clean': 'roommates:options.cleanliness.veryClean',
  Organized: 'roommates:options.cleanliness.organized',
  Messy: 'roommates:options.cleanliness.messy',
  // Social level
  Social: 'roommates:options.social.social',
  Balanced: 'roommates:options.social.balanced',
  Quiet: 'roommates:options.social.quiet',
  // Study style
  'In-Room': 'roommates:options.study.inRoom',
  'Study Lounges': 'roommates:options.study.studyLounges',
  Library: 'roommates:options.study.library',
  // Conflict style
  'Direct/Open': 'roommates:options.conflict.directOpen',
  'Soft/Patient': 'roommates:options.conflict.softPatient',
  'Text Only': 'roommates:options.conflict.textOnly',
  // Guests
  Often: 'roommates:options.guests.often',
  Occasionally: 'roommates:options.guests.occasionally',
  Rarely: 'roommates:options.guests.rarely',
  // Sleep
  Late: 'roommates:options.sleep.late',
  Early: 'roommates:options.sleep.early',
  // Smoking
  'Non-smoker': 'roommates:options.smoking.nonSmoker',
  Smoker: 'roommates:options.smoking.smoker',
  Vape: 'roommates:options.smoking.vape',
  // Temperature
  Cold: 'roommates:options.temp.cold',
  Warm: 'roommates:options.temp.warm',
  // Preset dealbreakers / boundary chips
  'Quiet Hours After 10PM': 'roommates:options.dealbreakers.quietHoursAfter10pm',
  'No Overnight Guests': 'roommates:options.dealbreakers.noOvernightGuests',
  'Text Before Bringing Guests': 'roommates:options.dealbreakers.textBeforeGuests',
  'No Heavy Partying': 'roommates:options.dealbreakers.noHeavyPartying',
  'Headphones After 10PM': 'roommates:options.dealbreakers.headphonesAfter10pm',
  'Dishes Washed Same Day': 'roommates:options.dealbreakers.dishesSameDay',
  'No Food Left Out Overnight': 'roommates:options.dealbreakers.noFoodOvernight',
  'Replace What You Finish': 'roommates:options.dealbreakers.replaceWhatYouFinish',
  'No Borrowing Without Asking': 'roommates:options.dealbreakers.noBorrowingWithoutAsking',
  'Quiet During Exam Weeks': 'roommates:options.dealbreakers.quietDuringExams',
  'No Smoking': 'roommates:options.dealbreakers.noSmoking',
  'No Drugs': 'roommates:options.dealbreakers.noDrugs',
  'No Alcohol': 'roommates:options.dealbreakers.noAlcohol',
  'No Frequent S.O. Sleepovers': 'roommates:options.dealbreakers.noFrequentSoSleepovers',
  'Trash Taken Out When Full': 'roommates:options.dealbreakers.trashWhenFull',
  'No Pets': 'roommates:options.dealbreakers.noPets',
};

/**
 * Translate a stored roommate option value for display. Preset (app-defined)
 * values get their localized label; anything else (a user's custom boundary
 * chip) returns unchanged. `t` may come from any namespace — keys are fully
 * qualified.
 */
export function roommateOptionLabel(
  t: TFunction,
  value: string | null | undefined,
): string {
  if (!value) return '';
  const key = VALUE_TO_KEY[value];
  return key ? t(key, { defaultValue: value }) : value;
}
