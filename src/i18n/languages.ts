// Single source of truth for languages the app can display.
// `enabled: false` languages are demo/incomplete — they only appear in the
// picker when the I18N_LANGUAGE_PICKER feature flag is on, never to students.
export type AppLanguage = {
  code: string;
  label: string;
  nativeLabel: string;
  enabled: boolean;
};

export const LANGUAGES: readonly AppLanguage[] = [
  { code: "en", label: "English", nativeLabel: "English", enabled: true },
  // zh is fully translated (Phases 1-8); a few of the newest checklist strings
  // fall back to English until backfilled. Live in the Settings picker.
  { code: "zh", label: "Chinese (Simplified)", nativeLabel: "中文", enabled: true },
];

export const DEFAULT_LANGUAGE = "en";
