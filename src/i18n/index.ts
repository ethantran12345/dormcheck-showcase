import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { DEFAULT_LANGUAGE } from "./languages";

// Namespaced locale files live at ./locales/<lang>/<namespace>.json. New
// namespace files are picked up automatically — no edit to this file needed.
// See i18n-translation-program.md for the namespace roster and conventions.
const modules = import.meta.glob("./locales/*/*.json", { eager: true });

const resources: Record<string, Record<string, unknown>> = {};
const namespaces = new Set<string>();

for (const [path, mod] of Object.entries(modules)) {
  const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!match) continue;
  const [, lang, ns] = match;
  namespaces.add(ns);
  const data = (mod as { default?: unknown }).default ?? mod;
  (resources[lang] ??= {})[ns] = data;
}

const isTest = import.meta.env.MODE === "test";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    ns: [...namespaces],
    // Generic shared strings live here, so bare keys (`t("actions.save")`)
    // resolve without a namespace prefix; feature strings use `t("settings:…")`.
    defaultNS: "common",
    fallbackLng: DEFAULT_LANGUAGE,
    // Empty strings mean "not translated yet" — fall back to English rather
    // than render a blank. Critical during the phased rollout.
    returnEmptyString: false,
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "dc_lang",
      caches: ["localStorage"],
    },
    // Surface un-migrated strings in dev so each phase can spot stragglers;
    // silent in tests and production.
    saveMissing: import.meta.env.DEV && !isTest,
    missingKeyHandler: (lngs, ns, key) => {
      if (import.meta.env.DEV && !isTest) {
        console.warn(`[i18n] missing key ${ns}:${key} (${lngs.join(", ")})`);
      }
    },
  });

export default i18n;
