// Roommate compatibility option constants - single source of truth.
// Moved out of RoommateProfileForm.tsx so pure lib code (roommateMatch.ts)
// can import them without pulling in a component. The form re-exports these,
// so existing import sites keep working.

export const CLEANLINESS_OPTIONS = ['Very Clean', 'Organized', 'Messy'] as const;
export const SOCIAL_OPTIONS = ['Social', 'Balanced', 'Quiet'] as const;
export const STUDY_OPTIONS = ['In-Room', 'Study Lounges', 'Library'] as const;
export const CONFLICT_STYLE_OPTIONS = ['Direct/Open', 'Soft/Patient', 'Text Only'] as const;
export const GUESTS_OPTIONS = ['Often', 'Occasionally', 'Rarely'] as const;
export const SLEEP_OPTIONS = ['Late', 'Early'] as const;
export const SMOKING_OPTIONS = ['Non-smoker', 'Smoker', 'Vape'] as const;
export const TEMP_OPTIONS = ['Cold', 'Warm'] as const;

export const DEALBREAKER_OPTIONS = [
  'Quiet Hours After 10PM',
  'No Overnight Guests',
  'Text Before Bringing Guests',
  'No Heavy Partying',
  'Headphones After 10PM',
  'Dishes Washed Same Day',
  'No Food Left Out Overnight',
  'Replace What You Finish',
  'No Borrowing Without Asking',
  'Quiet During Exam Weeks',
  'No Smoking',
  'No Drugs',
  'No Alcohol',
  'No Frequent S.O. Sleepovers',
  'Trash Taken Out When Full',
  'No Pets',
] as const;

export const PRESET_DEALBREAKERS = [...DEALBREAKER_OPTIONS];
