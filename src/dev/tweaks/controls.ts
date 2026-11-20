import tokens from "@/design/tokens.json";

/**
 * The controllable set, DERIVED from the existing token layer.
 *
 * Every default here is read from `src/design/tokens.json` or restated from the
 * CSS custom properties promoted in `src/index.css` — there is deliberately no
 * second hand-authored list of design values to drift out of sync. When a token
 * moves, this moves with it (families, brand hue, border hue and the radius
 * tiers all come straight from tokens.json).
 *
 * DEV ONLY. Nothing in this directory is reachable from a production build.
 */

/** `"139 97% 38%"` → `{ h: 139, s: 97, l: 38 }`. */
function parseHsl(triplet: string): { h: number; s: number; l: number } {
  const m = triplet.match(/^\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*$/);
  if (!m) return { h: 0, s: 0, l: 0 };
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

const BRAND_HSL = parseHsl(tokens.color.brand.hsl);
const BORDER_HSL = parseHsl(tokens.color.border.hsl);

/** The brand hue. Anything else is off-brand and gets badged as such. */
export const BRAND_HUE = BRAND_HSL.h;
export const BRAND_HEX = tokens.color.brand.hex;

/**
 * The four type families the design system actually ships. Read from
 * tokens.json (`serifFamily` was added there for exactly this reason — the file
 * knew about Nunito/Jost/Sora but not the marketing serif).
 */
export const FAMILIES: { id: string; label: string; stack: string; role: string }[] = [
  { id: "serif", label: tokens.typography.serifFamily, stack: tokens.typography.serifFamily, role: "marketing headlines (current)" },
  { id: "display", label: tokens.typography.displayFamily, stack: tokens.typography.displayFamily, role: "app headings" },
  { id: "sans", label: tokens.typography.fontFamily, stack: tokens.typography.fontFamily, role: "body / UI" },
  { id: "wordmark", label: tokens.typography.wordmarkFamily, stack: tokens.typography.wordmarkFamily, role: "logo only" },
];

export type ControlKind = "range" | "select" | "hue";

export interface TweakControl {
  /** Storage + patch key. */
  id: string;
  label: string;
  /** The CSS custom property this writes on :root. */
  cssVar: string;
  kind: ControlKind;
  /** Where this value lives in the real token layer, for the copy-out patch. */
  source: string;
  /** tokens.json dotted path, when the value maps onto one. */
  tokenPath?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string; hint?: string }[];
  /** Default = today's shipped value. Reset restores exactly this. */
  def: number | string;
  /** Turn a control value into the CSS custom-property value. */
  toCss: (v: number | string) => string;
  /**
   * Optional explicit tokens.json patch. Needed whenever the control is a
   * MULTIPLIER rather than a value: the radius slider is `×0.5`, and writing
   * `"radius": 0.5` into tokens.json would destroy the tier object instead of
   * scaling it. This resolves to the real per-tier numbers so the emitted patch
   * can genuinely be applied.
   */
  toTokenPatch?: (v: number | string) => Record<string, unknown>;
  /**
   * Extra custom properties this control writes alongside `cssVar`. The accent
   * needs it: the brand green is spread across several themed tokens
   * (--primary, --ring, the sidebar pair, the light/dark brand stops) and
   * moving only one of them produces a page that is half-recoloured.
   */
  alsoVars?: (v: number | string) => Record<string, string>;
  hint?: string;
}

const pct = (v: number | string) => String(v);

export const CONTROLS: TweakControl[] = [
  {
    id: "fontHeading",
    label: "Heading font family",
    cssVar: "--font-heading",
    kind: "select",
    source: "tailwind.config.ts fontFamily.serif",
    tokenPath: "typography.serifFamily",
    options: FAMILIES.map((f) => ({ value: f.stack, label: f.label, hint: f.role })),
    def: tokens.typography.serifFamily,
    toCss: (v) => String(v),
    hint: "Only the four families the design system already ships.",
  },
  {
    id: "typeScale",
    label: "Type scale",
    cssVar: "--type-scale",
    kind: "range",
    source: "marketing/landing/tokens.ts TYPE (display / h2 / h3 / statement)",
    min: 0.75,
    max: 1.4,
    step: 0.01,
    unit: "×",
    def: 1,
    toCss: pct,
    hint: "Multiplies all four heading clamps at once.",
  },
  {
    id: "density",
    label: "Spacing density",
    cssVar: "--density",
    kind: "range",
    source: "root font size (Tailwind's rem spacing scale resolves against it)",
    min: 0.85,
    max: 1.2,
    step: 0.01,
    unit: "×",
    def: 1,
    toCss: pct,
    hint: "Tailwind spacing compiles to literal rem, so the root font size is the only hook.",
  },
  {
    id: "radiusScale",
    label: "Radius tier",
    cssVar: "--radius-scale",
    kind: "range",
    source: "tokens.json radius.{control,card,editorial}",
    tokenPath: "radius",
    min: 0,
    max: 2,
    step: 0.05,
    unit: "×",
    def: 1,
    toCss: pct,
    // Resolve the multiplier back to the three real tier values in px, which is
    // what tokens.json actually stores.
    toTokenPatch: (v) => ({
      "radius.control": Math.round((tokens.radius.control as number) * Number(v)),
      "radius.card": Math.round((tokens.radius.card as number) * Number(v)),
      "radius.editorial": Math.round((tokens.radius.editorial as number) * Number(v)),
    }),
    hint: `Scales control ${tokens.radius.control}px / card ${tokens.radius.card}px / editorial ${tokens.radius.editorial}px together.`,
  },
  {
    id: "borderHue",
    label: "Border warmth",
    cssVar: "--border",
    kind: "hue",
    source: "tokens.json color.border",
    tokenPath: "color.border",
    min: 0,
    max: 360,
    step: 1,
    unit: "°",
    def: BORDER_HSL.h,
    toCss: (v) => `${v} ${BORDER_HSL.s}% ${BORDER_HSL.l}%`,
    hint: "Warm is ~40°. Cool/blue (~215°) is the known --border re-anchor bug, not a style.",
  },
  {
    id: "accentHue",
    label: "Accent hue",
    cssVar: "--dormcheck-brand",
    kind: "hue",
    // No literal hex here on purpose — the brand value is READ from tokens.json
    // (BRAND_HEX above) and interpolated, so this file can never drift from the
    // token and `npm run lint:colors` RULE 2 stays clean.
    source: "tokens.json color.brand (malachite-600)",
    tokenPath: "color.brand",
    min: 0,
    max: 360,
    step: 1,
    unit: "°",
    def: BRAND_HUE,
    toCss: (v) => `${v} ${BRAND_HSL.s}% ${BRAND_HSL.l}%`,
    // Every themed green token, rotated by the SAME delta so the relationships
    // between them survive (--ring sits 1° off --primary by design, etc).
    alsoVars: (v) => {
      const d = Number(v) - BRAND_HUE;
      const rot = (h: number) => (((h + d) % 360) + 360) % 360;
      return {
        "--dormcheck-brand-light": `${rot(139)} 90% 45%`,
        "--dormcheck-brand-dark": `${rot(139)} 90% 28%`,
        "--primary": `${rot(139)} 82% 24%`,
        "--ring": `${rot(138)} 92% 29%`,
        "--sidebar-primary": `${rot(139)} 82% 24%`,
        "--sidebar-ring": `${rot(138)} 92% 29%`,
      };
    },
    hint: `Brand is ${BRAND_HUE}° (${BRAND_HEX}). Moves every themed green token. The malachite-* utility scale is compiled from tokens.json at build time and cannot follow — those surfaces stay green.`,
  },
  {
    id: "durBase",
    label: "Motion duration",
    cssVar: "--dur-base",
    kind: "range",
    source: "marketing/landing/tokens.ts DUR.base",
    min: 0,
    max: 2,
    step: 0.05,
    unit: "s",
    def: 0.7,
    toCss: (v) => `${v}s`,
    hint: "Reduce Motion still wins — index.css neutralises durations with !important.",
  },
  {
    id: "durSlow",
    label: "Reveal duration",
    cssVar: "--dur-slow",
    kind: "range",
    source: "marketing/landing/tokens.ts DUR.slow (Reveal)",
    min: 0,
    max: 3,
    step: 0.05,
    unit: "s",
    def: 1,
    toCss: (v) => `${v}s`,
  },
  {
    id: "ease",
    label: "Easing",
    cssVar: "--ease",
    kind: "select",
    source: "marketing/landing/tokens.ts EASE_CSS",
    options: [
      { value: "cubic-bezier(0.22,1,0.36,1)", label: "Brand (out-expo)", hint: "the shipped curve" },
      { value: "cubic-bezier(0.4,0,0.2,1)", label: "Standard", hint: "material-ish" },
      { value: "cubic-bezier(0.32,0.72,0,1)", label: "iOS sheet" },
      { value: "linear", label: "Linear", hint: "for diagnosing, not shipping" },
    ],
    def: "cubic-bezier(0.22,1,0.36,1)",
    toCss: (v) => String(v),
  },
  {
    id: "revealDistance",
    label: "Reveal distance",
    cssVar: "--reveal-distance",
    kind: "range",
    source: "Reveal.tsx (was translate-y-6 = 1.5rem)",
    min: 0,
    max: 4,
    step: 0.125,
    unit: "rem",
    def: 1.5,
    toCss: (v) => `${v}rem`,
  },
];

export const CONTROLS_BY_ID: Record<string, TweakControl> = Object.fromEntries(
  CONTROLS.map((c) => [c.id, c]),
);

export type TweakState = Record<string, number | string>;

/** Only the values that actually differ from the shipped token defaults. */
export function deltas(state: TweakState): { control: TweakControl; value: number | string }[] {
  return CONTROLS.filter((c) => state[c.id] !== undefined && state[c.id] !== c.def).map((c) => ({
    control: c,
    value: state[c.id],
  }));
}

/** Is the accent currently off-brand? Drives the badge the panel must show. */
export function accentIsOffBrand(state: TweakState): boolean {
  const v = state.accentHue;
  return v !== undefined && Number(v) !== BRAND_HUE;
}
