// i18next-parser config — straggler catcher for the phased zh-CN program.
// Manual wiring (replacing literals with t()) is still the real work; running
// `npm run i18n:extract` harvests any t('ns:key') references that don't yet
// exist in the locale JSON so no string is silently missed each phase.
// See i18n-translation-program.md for conventions.
export default {
  input: ["src/**/*.{ts,tsx}"],
  output: "src/i18n/locales/$LOCALE/$NAMESPACE.json",
  locales: ["en", "zh"],
  defaultNamespace: "common",
  // Match the runtime separators used by i18next (see src/i18n/index.ts).
  namespaceSeparator: ":",
  keySeparator: ".",
  // Never clobber human/AI translations: keep existing values and keys the
  // parser can't statically see (dynamic keys), and don't reorder aggressively.
  keepRemoved: true,
  sort: true,
  // New EN keys land blank so they surface for filling; zh stays blank and
  // falls back to EN (returnEmptyString: false) until translated + reviewed.
  defaultValue: "",
  // Non-fatal: a phase can have keys awaiting translation.
  failOnWarnings: false,
  createOldCatalogs: false,
};
