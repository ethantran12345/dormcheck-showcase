import type { Config } from "tailwindcss";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcssAnimate from "tailwindcss-animate";
import typography from "@tailwindcss/typography";

/**
 * Design tokens - single source of truth.
 *
 * `src/design/tokens.json` is canonical (see its $meta). Tailwind CONSUMES it here so a
 * value changed there flows into the web/iOS build automatically. Tailwind is run from the
 * repo root, so resolving against process.cwd() is reliable across the jiti config loader.
 *
 * Themed colors keep their `hsl(var(--token))` form (the runtime light/dark projection lives
 * in src/index.css); literal brand colors, the font stack, and the wide radii are taken
 * straight from tokens.json. Output must stay byte-identical - see the build/visual diff.
 */
interface TokenColor { hex: string; hsl: string; cssVar: string | null; figma: string; description: string }
interface Tokens {
  color: Record<string, TokenColor>;
  radius: Record<string, number | string>;
  spacing: Record<string, number | string>;
  typography: { fontFamily: string; fallback: string[]; weights: Record<string, number> };
}
const tokens = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/design/tokens.json"), "utf8"),
) as Tokens;

/** px (token scale) -> rem string, matching Tailwind's existing rem-based radii. */
const rem = (px: number) => `${px / 16}rem`;
/** Themed color -> the CSS custom property Tailwind already references. */
const hslVar = (cssVar: string) => `hsl(var(${cssVar}))`;

export default {
  darkMode: "class",
  // `src/dev/**` is dev-only tooling (the Tweaks panel). Its React graph is
  // already dropped from a production bundle by the `import.meta.env.DEV`
  // dead-branch in App.tsx — but Tailwind scans SOURCE, not the bundle, so its
  // utilities were still being compiled into the production stylesheet
  // (measured: `accent-malachite-800`, used nowhere else, shipped in dist CSS).
  // Excluding the directory in production closes that last footprint; the glob
  // stays intact in dev, or the panel would render unstyled.
  content:
    process.env.NODE_ENV === "production"
      ? ["./src/**/*.{ts,tsx}", "!./src/dev/**"]
      : ["./src/**/*.{ts,tsx}"],
  prefix: "",
  // `hover:` only applies on devices that actually support hover (not touch), so a tap
  // on iOS no longer leaves a "stuck" hover state lingering (e.g. the red heart outline).
  future: {
    hoverOnlyWhenSupported: true,
  },
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        dormcheck: {
          brand: tokens.color.brand.hex,
          "brand-light": tokens.color["brand-light"].hex,
          "brand-dark": hslVar(tokens.color["brand-dark"].cssVar!),
          slate: hslVar(tokens.color.slate.cssVar!),
          "slate-light": hslVar(tokens.color["slate-light"].cssVar!),
        },
        // Marketing "paper" neutrals (landing elevation 2026-07): malachite-tinted
        // whites instead of Granola cream, so the marketing canvas reads as
        // DormCheck's own palette. Near-neutral only - real greens stay on the
        // malachite scale.
        tint: {
          50: "#F6FAF7",
          100: "#EBF4EE",
        },
        malachite: {
          50:  tokens.color["malachite-50"].hex,
          100: tokens.color["malachite-100"].hex,
          200: tokens.color["malachite-200"].hex,
          300: tokens.color["malachite-300"].hex,
          400: tokens.color["malachite-400"].hex,
          500: tokens.color["malachite-500"].hex,
          600: tokens.color["malachite-600"].hex,
          700: tokens.color["malachite-700"].hex,
          800: tokens.color["malachite-800"].hex,
          900: tokens.color["malachite-900"].hex,
          950: tokens.color["malachite-950"].hex,
        },
        // Warm-neutral scale (Warm Neutral Redesign 2026-07-20): the text/border
        // neutral, replacing Tailwind's built-in cool `slate`. OVERRIDES Tailwind's
        // built-in `stone` with DormCheck's derived warm gray (see tokens.json). The
        // codemod migrated every `slate-*`/`zinc-*` call site to `stone-*`; the
        // no-cool-neutral lint rule keeps them from returning.
        stone: {
          50:  tokens.color["stone-50"].hex,
          100: tokens.color["stone-100"].hex,
          200: tokens.color["stone-200"].hex,
          300: tokens.color["stone-300"].hex,
          400: tokens.color["stone-400"].hex,
          500: tokens.color["stone-500"].hex,
          600: tokens.color["stone-600"].hex,
          700: tokens.color["stone-700"].hex,
          800: tokens.color["stone-800"].hex,
          900: tokens.color["stone-900"].hex,
          950: tokens.color["stone-950"].hex,
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
          hover: "hsl(var(--card-hover))",
        },
        // Dashboard canvas (green-tinted near-white / deep cool navy) — see
        // --page in index.css. Cards float on this, not on pure white.
        page: "hsl(var(--page))",
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      fontFamily: {
        sans: [tokens.typography.fontFamily, ...tokens.typography.fallback],
        // Display headings use Jost (see typography.displayFamily); falls back to
        // Nunito then system. Body/UI stays on `sans` (Nunito) for legibility.
        display: [tokens.typography.displayFamily, tokens.typography.fontFamily, ...tokens.typography.fallback],
        // Editorial serif for marketing headlines only (landing redesign 2026-07).
        // Reads through --font-heading (src/index.css) so the heading family can
        // be swapped at runtime by the dev Tweaks panel. The fallback IS the
        // original stack, so nothing changes if the variable is absent.
        serif: ["var(--font-heading, Fraunces)", "Georgia", "serif"],
        // Wordmark standard (2026-07-12): Sora (OFL webfont) - a squarish, structured face,
        // decoupled from the display/heading token (Jost) which read too round/body-like
        // on the mark. Falls back to Nunito. See typography.wordmarkFamily.
        wordmark: [tokens.typography.wordmarkFamily, tokens.typography.fontFamily, "sans-serif"],
      },
      transitionTimingFunction: {
        ios: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      borderRadius: {
        // Raw scale — now MONOTONIC (Phase 1.8). xl was Tailwind's untouched 12px
        // default, SMALLER than lg (var(--radius) = 16px), so reaching for a rounder
        // corner silently flattened it. xl is now 18px → sm<md<lg<xl<2xl<3xl.
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: rem(tokens.radius["xl"] as number),
        "2xl": rem(tokens.radius["2xl"] as number),
        "3xl": rem(tokens.radius["3xl"] as number),
        // Semantic radius tiers (Phase 1.8) — pick a corner by what the element IS,
        // not by size. See src/design/tokens.json radius.$comment.
        // Read through CSS variables (src/index.css) whose defaults are exactly
        // these token values, so the tier can be scaled at runtime by the dev
        // Tweaks panel. tokens.json stays canonical — the fallback is the token.
        control: `var(--radius-control, ${rem(tokens.radius.control as number)})`,     // 12 — buttons, inputs, selects
        card: `var(--radius-card, ${rem(tokens.radius.card as number)})`,              // 16 — default container
        editorial: `var(--radius-editorial, ${rem(tokens.radius.editorial as number)})`, // 24 — large, page-like surfaces
        pill: "9999px",                                    // badges, chips, avatars, toggles
      },
      backgroundImage: {
        "gradient-brand": "var(--gradient-brand)",
        "gradient-brand-cta": "var(--gradient-brand-cta)",
      },
      boxShadow: {
        // Elevation tiers (Phase 1.8) — a THREE-STEP system. Pick by role:
        //   flat    — no shadow; the element reads via a hairline border (most cards).
        //   raised  — the default lifted card (was shadow-card / most shadow-sm|md).
        //   overlay — dialogs, popovers, floating menus (was shadow-elevated / shadow-lg|xl).
        // Colour is warm now (var(--shadow-card|elevated) re-anchored on stone in
        // src/index.css) — no raw slate triples remain here.
        'flat': 'none',
        'raised': 'var(--shadow-card)',
        'overlay': 'var(--shadow-elevated)',
        // Brand glow — an accent, NOT an elevation tier.
        'brand': 'var(--shadow-brand)',
        // Legacy token aliases kept so any un-migrated / baselined site still renders warm.
        'card': 'var(--shadow-card)',
        'elevated': 'var(--shadow-elevated)',
        'soft': 'var(--shadow-soft)',
        // Bare Tailwind sizes kept as WARM aliases (routed through the tier vars) so a
        // grandfathered call site never falls back to Tailwind's COOL default shadow.
        // The lint gate (scripts/check-colors.mjs) bans NEW usage — migrate to
        // flat / raised / overlay.
        'sm': 'var(--shadow-soft)',
        'DEFAULT': 'var(--shadow-card)',
        'md': 'var(--shadow-card)',
        'lg': 'var(--shadow-elevated)',
        'xl': 'var(--shadow-elevated)',
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(100%)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        "slide-out-left": {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-100%)" },
        },
        "slide-in-left": {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" },
        },
        "slide-out-right": {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(100%)" },
        },
        // Loading shimmer (P7). Tailwind's stock `pulse` — a symmetric 1 → .5 opacity
        // flash on a 2s ease-in-out — is one of the most recognizable generic-modern-app
        // tells in the product (Product Identity Spec § P7 item 4). Overridden here, at
        // the utility, so all ~20 raw `animate-pulse` call sites move together with zero
        // call-site churn. Two deliberate differences: a SHALLOWER trough (.62, not .5 —
        // reads as breathing, not blinking) and an ASYMMETRIC curve (settles quickly,
        // recovers slowly) that matches the ease-ios feel used everywhere else.
        // Opacity-only on purpose — no size/layout property animates, so a skeleton box
        // stays exactly the size of the content it stands in for (no CLS).
        pulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.62" },
        },
        // Identity pass tell 4 (2026-10-11): the content-shaped skeleton's own motion,
        // used by ui/skeleton. Two beats instead of an endless blink: `skeleton-in`
        // fades the placeholder up AFTER a short delay (Primer's delay-before-render,
        // so a fast response never flashes a loader), then `skeleton-breathe` dips
        // opacity once per long cycle. Opacity-only, so no CLS.
        "skeleton-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "skeleton-breathe": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
        // Marquee (marketing landing only — Magic UI-derived, MIT). Loop distance
        // includes one gap so the seam is invisible across repeated children.
        marquee: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(calc(-100% - var(--marquee-gap, 1.5rem)))" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.4s ease-out",
        "slide-up": "slide-up 0.3s ease-out",
        "scale-in": "scale-in 0.2s ease-out",
        "slide-in-right": "slide-in-right 300ms ease-in-out both",
        "slide-out-left": "slide-out-left 300ms ease-in-out both",
        "slide-in-left": "slide-in-left 300ms ease-in-out both",
        "slide-out-right": "slide-out-right 300ms ease-in-out both",
        marquee: "marquee var(--marquee-duration, 40s) linear infinite",
        // See the `pulse` keyframe note above. Slower than stock (2.4s vs 2s) and on the
        // ios easing curve. Globally neutralized for Reduce Motion users by the
        // prefers-reduced-motion block in src/index.css — no per-site guard needed.
        pulse: "pulse 2.4s cubic-bezier(0.32, 0.72, 0, 1) infinite",
        // Durations and easing read the DUR/EASE tokens (src/index.css --dur-* /
        // --ease). 300ms is Primer's `short` delay-before-render threshold, not a
        // style choice. The breathe LOOP is ease-in-out on purpose: --ease is an
        // expo out-curve, and on a loop it parks at the trough then snaps back
        // (measured 2026-10-11), a flicker. The one-shot fade-in keeps --ease.
        // Reduce Motion: ui/skeleton adds motion-reduce:animate-none,
        // so the placeholder is static and visible immediately.
        skeleton:
          "skeleton-in var(--dur-base) var(--ease) 300ms both, skeleton-breathe calc(var(--dur-slow) * 3) ease-in-out calc(300ms + var(--dur-base)) infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate, typography],
} satisfies Config;
