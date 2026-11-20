import js from "@eslint/js";
import globals from "globals";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import unusedImports from "eslint-plugin-unused-imports";

// jsx-a11y rollout (WCAG 2.1 AA effort): everything in `recommended` runs at "warn" so
// lint stays green while the codebase is remediated batch by batch. Each finished batch
// promotes its rules into A11Y_ERROR_RULES below. Target end state: full recommended set
// at "error" - see docs/audits/accessibility.md.
const a11yWarnRules = Object.fromEntries(
  Object.entries(jsxA11y.flatConfigs.recommended.rules).map(([rule, conf]) => [
    rule,
    Array.isArray(conf) ? ["warn", ...conf.slice(1)] : "warn",
  ]),
);

const A11Y_ERROR_RULES = {
  // ARIA validity - cheap to satisfy, should never regress.
  "jsx-a11y/aria-props": "error",
  "jsx-a11y/aria-role": "error",
  "jsx-a11y/aria-unsupported-elements": "error",
  "jsx-a11y/role-has-required-aria-props": "error",
  "jsx-a11y/role-supports-aria-props": "error",
  // Batch A (alt text) done - content images carry meaningful alts, decorative ones alt="".
  "jsx-a11y/alt-text": "error",
  // Batch B (landmarks, skip link, forms) done.
  "jsx-a11y/label-has-associated-control": "error",
  "jsx-a11y/anchor-is-valid": "error",
  // Batch D (ARIA/keyboard/dialogs) done. click-events-have-key-events,
  // no-static-element-interactions and no-noninteractive-element-interactions stay at
  // warn: the remaining hits are clickable containers whose inner button already gives
  // keyboard/AT access - triage per site before ratcheting.
  "jsx-a11y/interactive-supports-focus": "error",
  // Deprecated predecessor of label-has-associated-control; its default demands BOTH
  // nesting and htmlFor, which fights the shadcn Label + Input pattern.
  "jsx-a11y/label-has-for": "off",
};

export default tseslint.config(
  // .design-sync/ds-bundle*: design-system sync inputs and compiled bundles (see CLAUDE.md), not app code.
  // android/**/build: gitignored Gradle output (Capacitor's copied native-bridge.js etc.), not source.
  // supabase/.temp/** is a gitignored scratch dir written by `supabase start` (it contains a
  // bundled, minified edge-runtime index.ts worth ~187 lint errors). It belongs to the local
  // stack, not to this repo, and CI never sees it — ignoring it keeps local `npm run lint`
  // output readable. Do NOT delete the directory; a running local stack owns it.
  // ios/DerivedData is Xcode build output (vendored Capacitor native-bridge.js);
  // linting it reported 4 phantom errors for a TS-only rule in a plain JS file.
  { ignores: ["dist", ".design-sync", "ds-bundle", "ds-bundle-verify", "android/**/build", "ios/DerivedData/**", "supabase/.temp/**"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "jsx-a11y": jsxA11y,
      "unused-imports": unusedImports,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Unused-code gate (mirrors CodeQL js/unused-local-variable; kept at "error" so
      // the GitHub "Security and quality" score can't silently regress - blocking in CI).
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "error",
        { args: "after-used", argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      ...a11yWarnRules,
      ...A11Y_ERROR_RULES,
    },
  },
  {
    // Client bundle only. A stray console.log here ships to every student's
    // browser/WKWebView console and can leak ids and payloads; server code
    // (api/**, supabase/functions/**) logs on purpose and is exempt.
    // warn/error stay allowed - those are real diagnostics, not chatter.
    // Deliberate dev-only tracing goes through `devLog` (src/lib/utils.ts) or
    // carries an eslint-disable line stating why it is gated.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
);
