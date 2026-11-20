/**
 * Marketing-site motion + type tokens (design-system consolidation 2026-07-12).
 * Single source of truth for the easing curve, the duration scale, and the
 * four heading sizes. Import from here — never redeclare EASE or hand-roll a
 * heading clamp in a marketing file.
 */

/** The one marketing easing curve (framer-motion tuple). */
export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Same curve as a CSS string, for CSS-driven transitions (Reveal).
 *  Reads through `--ease` (src/index.css, default = the tuple above) so the
 *  dev Tweaks panel can change it at runtime. CSS consumers only — framer
 *  needs the numeric tuple in EASE. */
export const EASE_CSS = "var(--ease, cubic-bezier(0.22,1,0.36,1))";

/** Duration scale in seconds. fast = micro-interactions, base = reveals/most
 * scripted beats, slow = big bars/heroes. Reveal's CSS uses ~base + a little.
 * framer-motion takes numbers, so this stays numeric — see DUR_CSS below for
 * the CSS-variable-backed form. */
export const DUR = { fast: 0.35, base: 0.7, slow: 1.0 } as const;

/** DUR as CSS strings that resolve through `--dur-*` (src/index.css, defaults
 *  equal to DUR). Use this anywhere a duration is handed to CSS, so the value
 *  stays tweakable at runtime; framer-motion transitions keep using DUR. */
export const DUR_CSS = {
  fast: "var(--dur-fast, 0.35s)",
  base: "var(--dur-base, 0.7s)",
  slow: "var(--dur-slow, 1s)",
} as const;

/**
 * The four heading sizes, as complete Tailwind classes (kept as literal class
 * strings so the JIT scanner picks them up from this file).
 * display — page heroes; h2 — section headings; h3 — card/sub headings;
 * statement — the landing's single big-type scroll moment (and About).
 */
// Each size resolves through a `--type-*` custom property (src/index.css) whose
// default is the exact clamp it replaced, multiplied by `--type-scale` (default
// 1). That indirection is what lets the dev Tweaks panel move the whole scale
// live; the JIT still sees complete literal class strings here.
export const TYPE = {
  display: "text-[length:var(--type-display)]",
  h2: "text-[length:var(--type-h2)]",
  h3: "text-[length:var(--type-h3)]",
  statement: "text-[length:var(--type-statement)]",
} as const;
