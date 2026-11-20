#!/usr/bin/env node
/**
 * Color hygiene gate (Warm Neutral Redesign 2026-07-20). Wired into `npm run lint`.
 *
 * Enforces two rules across src/ (*.ts, *.tsx, *.css), scanning CODE ONLY
 * (comments are stripped first, so provenance notes like "was slate-900" and
 * hex in prose don't trip it):
 *
 *   RULE 1 — no cool-neutral Tailwind classes. `slate-|zinc-|gray-|neutral-<shade>`
 *            are BANNED with zero tolerance. Use the warm `stone-*` scale. This is
 *            the rule that keeps the ~460-site warm-neutral migration from silently
 *            regressing. The DormCheck brand token `dormcheck-slate` / `--dormcheck-slate`
 *            has no numeric shade and is not matched.
 *
 *   RULE 2 — no NEW raw hex colors. Hardcoded hex bypasses the token layer
 *            (src/design/tokens.json). Pre-existing hex is grandfathered via
 *            scripts/color-baseline.json so this rule can ship without a giant
 *            refactor (and without touching files another agent is mid-edit);
 *            any hex NOT in the baseline fails. Genuinely color-data files
 *            (mapbox/transit styling, dorm pins, theme-color meta, generated,
 *            Vite boilerplate) are fully exempt by glob. The baseline is DEBT, not
 *            a blessing — shrink it, never grow it.
 *
 *   RULE 3 — no NEW dark-blind green surfaces (Phase 1.5 dark-mode redesign).
 *            A SOLID green class (`bg-|from-|via-|to-malachite-<shade>`, i.e. NO
 *            `/opacity` — those are already translucent accents) on a line that
 *            carries no `dark:` variant paints full-strength green over the warm
 *            neutral dark canvas in BOTH themes. That is the ~600-site debt the
 *            redesign is unwinding. A regex CANNOT reliably tell a legitimate
 *            solid-green primary BUTTON (keep) from a card/tile/hero SURFACE
 *            (convert) — element type isn't visible to a line scanner — so rather
 *            than cry wolf this rule is a RATCHET, not a classifier: it counts the
 *            solid-green-without-`dark:` occurrences per file, grandfathers today's
 *            count in scripts/color-dark-baseline.json, and fails only when a file's
 *            count GROWS. New dark-blind green surfaces are blocked; the standing
 *            debt is tracked and meant to shrink (lower a file's number whenever you
 *            convert a surface, then re-run --write-baseline). It is DEBT, not a
 *            blessing.
 *
 *   RULE 4 — no bare Tailwind elevation classes (Phase 1.8). `shadow-sm|md|lg|xl`
 *            bypass the three-tier system (flat / raised / overlay). Same ratchet as
 *            RULE 3: per-file count grandfathered in scripts/shape-baseline.json, fails
 *            only on GROWTH. The ~460-slate-class lesson: tokens existed and lost to
 *            Tailwind defaults because nothing enforced them. Migrate to a tier.
 *
 *   RULE 5 — no arbitrary radius values (Phase 1.8). `rounded-[13px]` etc. bypass the
 *            semantic radius tiers (control / card / editorial / pill). Same per-file
 *            ratchet in scripts/shape-baseline.json (radius). Use a tier.
 *
 *   RULE 6 — no color literals in inline `style={{ }}` objects (2026-08-02 design audit).
 *            RULES 1/3/4/5 are CLASS-STRING scanners: they read Tailwind utilities off a
 *            line and cannot see a color applied as a JS property. So
 *            `style={{ backgroundColor: '#03C03C' }}` paints a full-strength solid green
 *            surface that RULE 3's dark-blind ratchet never counts, and RULE 2 waves
 *            through because that same hex is already grandfathered in the file's
 *            color-baseline entry (RULE 2 tracks a hex VALUE per file, not the fact that
 *            it is being used as a surface color). That is the real hole — not, as first
 *            reported, that inline styles evade the hex scan entirely; they don't.
 *
 *            This rule closes it by scanning the balanced `style={{ … }}` block itself
 *            and flagging color literals inside, INCLUDING module-level `const NAME =
 *            '#hex'` identifiers referenced from the block (which is how
 *            ChecklistLanding reached #03C03C via BRAND_ACCENT — a literal-only scan
 *            misses it). Token-based values are explicitly fine and never flagged:
 *            `hsl(var(--muted-foreground))`, `rgb(var(--x))` etc. Per-file ratchet in
 *            scripts/inline-color-baseline.json, same shape and same DEBT semantics as
 *            RULES 3-5 — shrink it, never grow it. Like those rules the ratchet counts
 *            per file rather than per site, so it blocks growth rather than pinning
 *            which line is grandfathered.
 *
 *   RULE 7 — no OFF-RAMP literal font sizes (2026-08-04). `text-[14.5px]` and friends
 *            bypass the documented step ramp in src/design/tokens.json
 *            (`typography.scale`). This rule exists because the impeccable design hook
 *            was flagging every bracketed size in the marketing files as "outside
 *            DESIGN.md" — and it was RIGHT that nothing documented them, but WRONG that
 *            they were all arbitrary: 13px eyebrows and 15px rows are the established
 *            idiom of the whole marketing directory. The fix was to write the ramp down
 *            (tokens.json + DESIGN.md) rather than to suppress the finding, so an
 *            ON-ramp value is legitimate everywhere and only genuine drift is debt.
 *            Same per-file ratchet as RULES 3-6, baseline in scripts/type-baseline.json.
 *            The ramp is sourced FROM tokens.json at runtime, so adding a step is a
 *            single-file design-system change — but mirror it into DESIGN.md's
 *            typography block in the same pass or the hook keeps flagging it.
 *
 *   RULE 8 — no resting-state colour pair below WCAG AA (2026-08-06). Rules 1-7 are all
 *            PRESENCE scanners: they ask whether a class appears, never what it looks like
 *            against the class beside it. RULE 3 declines the question on purpose — a regex
 *            cannot tell a green button from a green hero, so it counts solid green
 *            SHADE-AGNOSTICALLY, and malachite-600 and malachite-800 are the same to it.
 *            That left `bg-malachite-600 text-white` — 2.44:1, a flat AA failure — invisible
 *            to the entire gate. RULE 8 owns exactly that: pair a resting background class
 *            with the resting text class on the same element, resolve both to hex through
 *            src/design/tokens.json, and compute the WCAG 2.1 relative-luminance ratio.
 *            Fails below 4.5:1 (3:1 for large text: >=24px, or >=18.66px bold).
 *
 *            THIS RULE HAS NO BASELINE. Its floor is zero. Rules 3-7 are growth ratchets
 *            that are indifferent to standing debt, and their per-FILE counts let a fix and
 *            a fresh violation in one file net out and pass. Contrast is not debt to track —
 *            it is a bug, and there are none, so zero is both achievable and the only
 *            honest floor.
 *
 *            Scoping choices that keep it at 2 findings instead of 20 false positives:
 *            only RESTING pairs (hover/focus/active/group-/peer-/data- variants dropped,
 *            as are ring-/border-/gradient classes — none of them is the surface a label
 *            sits on); `dark:` pairs evaluated as their own layer (ServicePostActions passed
 *            in light and failed in dark); and one string literal = one element, so a
 *            `cn()` branch's fill is never paired with another branch's text.
 *
 *            It FAILS CLOSED BY IGNORING: a pair it cannot resolve to two hexes is not a
 *            violation. That blind spot is reported rather than hidden — the pass line
 *            prints how many pairs went unchecked and why, and `--report-contrast` names
 *            the specific colour classes, worst first. Semantic tokens (bg-card, bg-primary)
 *            are the bulk of it: tokens.json carries their LIGHT value only, so they resolve
 *            in the light layer and are skipped in dark rather than scored against a
 *            fabricated hex. Adding a token to tokens.json widens coverage for free.
 *
 * Regenerate ALL baselines after a legitimate change:  node scripts/check-colors.mjs --write-baseline
 * Read RULE 8's findings and its blind spot:           node scripts/check-colors.mjs --report-contrast
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './lib/strip-comments.mjs';
import { featureFilesOnly } from './lib/is-feature-file.mjs';

// fileURLToPath, not .pathname: on Windows a file: URL's pathname is "/D:/repo/", and
// resolve() reads the leading slash as root-relative, yielding "D:\D:\repo" — a path that
// does not exist. Every consumer then breaks somewhere far from here; the execSync below
// inherits it as cwd and fails with a spawnSync ENOENT naming cmd.exe, which looks like a
// missing shell rather than a bad directory.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASELINE_PATH = resolve(ROOT, 'scripts/color-baseline.json');
const DARK_BASELINE_PATH = resolve(ROOT, 'scripts/color-dark-baseline.json');
const SHAPE_BASELINE_PATH = resolve(ROOT, 'scripts/shape-baseline.json');
const INLINE_BASELINE_PATH = resolve(ROOT, 'scripts/inline-color-baseline.json');
const TYPE_BASELINE_PATH = resolve(ROOT, 'scripts/type-baseline.json');

// The canonical token file, read once — RULE 7 takes its type ramp from it and RULE 8
// resolves colour classes to hex through it, so neither gate can disagree with the
// design system it enforces.
const TOKENS = JSON.parse(readFileSync(resolve(ROOT, 'src/design/tokens.json'), 'utf8'));

// RULE 7: the documented literal-font-size ramp.
const TYPE_SCALE_PX = new Set(Object.values(TOKENS.typography.scale).map((s) => String(s.px)));
// Matches after any variant prefix (md:text-[34px], group-hover:text-[13px], …).
const TEXT_ARB_PX = /\btext-\[([\d.]+)px\]/g;

// Files fully exempt from RULE 2 (hex is legitimate data / non-CSS API input).
const HEX_EXEMPT = [
  /^src\/design\/tokens\.json$/,            // the token source itself
  /^src\/lib\/transit.*\.ts$/,              // mapbox route/layer colors
  /^src\/lib\/dormPins\.ts$/,               // map pin styling
  /^src\/lib\/theme\.ts$/,                  // <meta theme-color> hex constants
  /^src\/components\/marketplace\/PaymentLogos\.tsx$/, // payment-provider brand hexes (Venmo/Cash App/Zelle) — brand data, not themeable
  /^src\/components\/marketing\/landing\/StoreBadges\.tsx$/, // Google Play's four brand hexes in the inline Play mark — brand data, not themeable
  /\.generated\.ts$/,                       // generated data
  /^src\/App\.css$/,                        // Vite starter boilerplate
];

const COOL_NEUTRAL = /\b(slate|zinc|gray|neutral)-(50|100|200|300|400|500|600|700|800|900|950)\b/g;
const HEX = /#[0-9a-fA-F]{3,4}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{8}\b/g;
// RULE 3: a SOLID green surface class — bg/from/via/to-malachite-<shade> with NO
// `/opacity` suffix. The trailing (?!\/) keeps `bg-malachite-600/10` (a translucent
// accent, already dark-safe) from matching.
const SOLID_GREEN = /\b(?:bg|from|via|to)-malachite-\d+\b(?!\/)/g;
// RULE 4 (Phase 1.8): bare Tailwind elevation classes. shadow-sm|md|lg|xl bypass the
// three-tier elevation system (flat / raised / overlay) — the same "tokens exist,
// defaults win" failure as the 460 slate classes. Matched with any variant prefix
// (hover:/group-hover:/md:…). Does NOT match shadow-2xl, shadow-none, shadow-inner,
// or the tier/token names (raised/overlay/flat/card/elevated/soft/brand). The
// (?<![\w-]) lookbehind excludes the `drop-shadow-*` filter utility (preceded by `-`).
const SHADOW_BARE = /(?<![\w-])shadow-(?:sm|md|lg|xl)\b/g;
// RULE 5 (Phase 1.8): arbitrary radius values (rounded-[13px], rounded-[22px]…) bypass
// the semantic radius tiers (control/card/editorial/pill). Matches every logical-corner
// variant (rounded-tl-[..], rounded-s-[..], …).
const RADIUS_ARB = /\brounded(?:-(?:t|b|l|r|s|e|tl|tr|bl|br|ss|se|es|ee))?-\[[^\]]+\]/g;
// RULE 6: color literals inside an inline style object. A hex anywhere, or an
// rgb()/hsl() whose arguments are NOT a CSS custom property — `hsl(var(--muted-foreground))`
// is the token-correct way to write an inline color and must never be flagged.
const INLINE_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\((?!\s*var\()/g;
// A module-level `const NAME = '#hex'`. Collected across src/ so an inline style that
// references the constant (BRAND_ACCENT) is caught the same as one that inlines the hex.
const HEX_CONST_DECL = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?=\s*['"`](#[0-9a-fA-F]{3,8})['"`]/g;

/* ── RULE 8 — resting-state contrast ratio ───────────────────────────────────
 * Every rule above is a PRESENCE scanner: it asks whether a class appears, never
 * what it looks like next to the class beside it. RULE 3 deliberately refuses the
 * question (its header says a regex can't tell a green button from a green hero,
 * so it counts shade-agnostically) — which left `bg-malachite-600 text-white`,
 * a 2.44:1 AA failure, invisible to all seven. RULE 8 owns exactly that question:
 * pair a resting background class with the resting text class on the same element,
 * resolve both to hex, and compute the WCAG 2.1 relative-luminance ratio.
 */

// Variant prefixes that make a class a NON-resting state. Pairing a hover fill with a
// resting text colour is what turns 2 real findings into 20 false positives, so any
// class carrying one of these is dropped before pairing. `dark:` and the responsive /
// structural variants (sm:, md:, first:, motion-safe:) are NOT here — those are resting.
// Pseudo-ELEMENT variants are excluded too, for a different reason: `placeholder:text-…`
// is not this element's text colour, and letting it win the "last text-* wins" race
// misattributes the pair (it hid a real `text-white` behind a placeholder grey during
// development). Their contrast is a real question, just not one this element-level
// pairing can answer — see the limitations note in docs/security/ci-gate-matrix.md.
const NON_RESTING_VARIANT = new Set([
  'hover', 'focus', 'focus-visible', 'focus-within', 'active', 'visited', 'target',
  'disabled', 'enabled', 'checked', 'indeterminate', 'placeholder-shown', 'autofill', 'open',
  'placeholder', 'before', 'after', 'first-letter', 'first-line', 'selection', 'marker',
  'file', 'backdrop',
]);
const NON_RESTING_PREFIX = /^(?:group|peer|aria|data|has|in|not|supports)[-[]/;
const isNonResting = (v) => NON_RESTING_VARIANT.has(v) || NON_RESTING_PREFIX.test(v);
// `text-*` utilities that are not colours at all (size, alignment, wrapping, overflow).
// These are ignored outright rather than counted as unresolvable — they are not a
// blind spot, they simply aren't colour.
const TEXT_NON_COLOR = new Set([
  'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl',
  'left', 'center', 'right', 'justify', 'start', 'end',
  'wrap', 'nowrap', 'balance', 'pretty', 'ellipsis', 'clip',
  // inherit-the-parent values: a contrast check against them is meaningless, not blind.
  'current', 'inherit', 'transparent',
]);
// Tailwind's px sizes for the ramp classes, so `text-lg font-bold` can be scored as
// WCAG "large text" (3:1) rather than normal text (4.5:1).
const TW_TEXT_PX = {
  xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30, '4xl': 36,
  '5xl': 48, '6xl': 60, '7xl': 72, '8xl': 96, '9xl': 128,
};
const BOLD_CLASS = /\bfont-(?:semibold|bold|extrabold|black)\b/;

// Colour lookup. tokens.json is the resolver, per the design-system contract.
const TOKEN_HEX = new Map(
  Object.entries(TOKENS.color)
    .filter(([, v]) => typeof v?.hex === 'string')
    .map(([k, v]) => [k, v.hex]),
);
// Tokens whose value is IDENTICAL in `:root` and `.dark` (src/index.css): the literal
// palette ramps and the brand constants. Everything else in tokens.json is a SEMANTIC
// token carrying its LIGHT value only — resolving `bg-muted` to #F3F7F5 inside a `dark:`
// pair would be a fabricated ratio, so those pairs are skipped in the dark layer instead.
const isThemeIndependent = (name) =>
  /^(?:malachite|stone)-\d+$/.test(name) ||
  /^(?:brand|brand-light|brand-dark|slate|slate-light)$/.test(name);
const LITERAL_HEX = { white: '#ffffff', black: '#000000' };

/** Expand #abc → #aabbcc. Returns null for 4/8-digit (alpha) hex — see resolveColor. */
function normalizeHex(hex) {
  const h = hex.replace('#', '').toLowerCase();
  if (h.length === 3) return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  if (h.length === 6) return `#${h}`;
  return null; // alpha: the composite depends on what is underneath, which we can't know
}

/**
 * Resolve a Tailwind colour name (`malachite-600`, `white`, `[#03C03C]`, `muted`) to hex
 * for the given theme, or null if it cannot be resolved. Null is NOT a violation — RULE 8
 * fails closed by ignoring what it cannot resolve, and reports the skipped count so the
 * blind spot is visible rather than silent.
 */
function resolveColor(name, theme) {
  if (name in LITERAL_HEX) return LITERAL_HEX[name];
  const arb = /^\[(#[0-9a-fA-F]{3,8})\]$/.exec(name);
  if (arb) return normalizeHex(arb[1]);
  if (name.includes('/')) return null; // `bg-malachite-600/10` — translucent, needs the layer below
  const hex = TOKEN_HEX.get(name);
  if (!hex) return null;
  if (theme === 'dark' && !isThemeIndependent(name)) return null;
  return normalizeHex(hex);
}

const srgb = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : (((c / 255) + 0.055) / 1.055) ** 2.4);
const luminance = (hex) =>
  0.2126 * srgb(parseInt(hex.slice(1, 3), 16)) +
  0.7152 * srgb(parseInt(hex.slice(3, 5), 16)) +
  0.0722 * srgb(parseInt(hex.slice(5, 7), 16));
/** WCAG 2.1 contrast ratio, 1–21. */
function contrastRatio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)];
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Split one class-list string into the resting colour pairs it declares.
 *
 * Scope: ONE string literal = ONE element. A `cn()` call's separate branches are separate
 * literals, so a fill from the active branch is never paired with text from the inactive
 * one. The cost is that a background in one literal and its text colour in another are
 * never paired at all (a miss, not a false positive) — the deliberate trade, since a gate
 * that cries wolf gets bypassed.
 *
 * Layers: the base pair (no variant) and, when the string carries any `dark:` colour, the
 * dark pair — `dark:` classes override, unprefixed ones fall through. ServicePostActions
 * is exactly why: `bg-malachite-800 text-white dark:bg-malachite-700` passes in light and
 * fails in dark, and a base-only reader sees nothing.
 */
function contrastPairs(classString) {
  // Split on quotes and angle brackets as well as whitespace: a few class lists live
  // inside HTML strings (`'<div class="bg-white …">'`), and a plain \s+ split leaves the
  // closing quote glued to the last class name.
  const tokens = classString.split(/[\s"'`<>]+/).filter(Boolean);
  const layer = { light: { bg: null, text: null }, dark: { bg: null, text: null } };
  let sawDarkColor = false;
  let px = null;

  for (const raw of tokens) {
    const parts = raw.replace(/^!/, '').split(':');
    const base = parts.pop();
    const variants = parts;
    if (variants.some(isNonResting)) continue;
    const isDark = variants.includes('dark');

    const m = /^(bg|text)-(.+)$/.exec(base);
    if (!m) continue;
    const [, prop, name] = m;
    if (prop === 'text') {
      if (TEXT_NON_COLOR.has(name)) {
        if (!isDark && TW_TEXT_PX[name] !== undefined) px = TW_TEXT_PX[name];
        continue;
      }
      const arbPx = /^\[([\d.]+)px\]$/.exec(name);
      if (arbPx) { if (!isDark) px = Number(arbPx[1]); continue; }
      if (/^\[[\d.]+(?:rem|em|%)\]$/.test(name) || name.startsWith('opacity-')) continue;
    }
    if (isDark) sawDarkColor = true;
    (isDark ? layer.dark : layer.light)[prop] = name;
  }

  const bold = BOLD_CLASS.test(classString);
  const threshold = px !== null && (px >= 24 || (px >= 18.66 && bold)) ? 3 : 4.5;

  const out = [];
  const emit = (theme, bgName, textName) => {
    if (!bgName || !textName) return; // no surface or no text on this element — nothing to compare
    // A see-through / inherited surface is the PARENT's colour, which an element-scoped
    // scanner cannot know. Not a blind spot to report, just not a pair.
    if (['transparent', 'current', 'inherit', 'none'].includes(bgName)) return;
    const bg = resolveColor(bgName, theme);
    const fg = resolveColor(textName, theme);
    if (!bg || !fg) {
      // Name WHY a pair could not be resolved, so `--report-contrast` shows the shape of
      // the blind spot rather than one opaque number.
      const why = (n, hex) =>
        hex ? null
          : n.includes('/') ? 'translucent'
          : TOKEN_HEX.has(n) ? 'semantic-token-in-dark'
          : 'unresolved-class';
      const culprit = bg ? textName : bgName;
      out.push({ skipped: why(bgName, bg) ?? why(textName, fg), culprit });
      return;
    }
    out.push({
      theme, threshold, bg: `${bgName} ${bg}`, fg: `${textName} ${fg}`,
      ratio: contrastRatio(bg, fg),
    });
  };
  emit('light', layer.light.bg, layer.light.text);
  if (sawDarkColor) {
    emit('dark', layer.dark.bg ?? layer.light.bg, layer.dark.text ?? layer.light.text);
  }
  return out;
}

/**
 * RULE 8 waivers — the ONLY way a contrast failure is allowed to survive, and deliberately
 * not a baseline. CLAUDE.md's trunk rule already anticipates this case: a red gate is fixed
 * or reverted now, "unless another live lane owns the fix, which takes a named, expiring
 * waiver". This is that, for colour.
 *
 * A waiver is not a suppression. It is louder than the violation it covers: it prints on
 * every run with its reason and expiry, and it fails the gate in TWO directions —
 *
 *   · EXPIRED  → the gate goes red on the waiver itself, whether or not the pair is still
 *                failing. A waiver that outlives its reason is how a ratchet is reinvented.
 *   · UNUSED   → the gate goes red asking you to delete it. A waiver that no longer matches
 *                anything is a lie about the gate's coverage.
 *
 * Match on file + both colour names + theme, never on a line number (lines drift).
 */
const CONTRAST_WAIVERS = [];

// A quoted string literal (including multi-line template literals). Class lists live in
// `className="…"`, `cn('…', cond && '…')` and `cva` variant maps alike, so scanning every
// literal that looks like a class list covers all three without parsing JSX.
// Quoted literals must NOT span a newline: a lone apostrophe in JSX prose ("you're") would
// otherwise open a phantom string that runs to the next apostrophe pages away, blending the
// classes of unrelated elements into one bogus pair. Only template literals may be
// multi-line, and those are delimited unambiguously.
const STRING_LITERAL = /'([^'\\\n]*(?:\\.[^'\\\n]*)*)'|"([^"\\\n]*(?:\\.[^"\\\n]*)*)"|`([^`\\]*(?:\\.[^`\\]*)*)`/g;
const LOOKS_LIKE_CLASSES = /(?:^|\s)(?:[\w-]+:)*(?:bg|text)-[\w[\]#./-]+/;
// …and is a class list rather than a chunk of source. A stray unbalanced quote earlier in
// a file makes the scan above pair a delimiter with the wrong one and swallow whole regions
// of JSX, which then reads as a fill and a text colour from two unrelated elements. No real
// Tailwind class list contains a statement terminator, a tag opener, or the word className.
const NOT_A_CLASS_LIST = /[<;]|className/;

/** Feature surfaces only — see scripts/lib/is-feature-file.mjs. */
function listFiles() {
  return featureFilesOnly(
    execSync(
      "git ls-files 'src/*.ts' 'src/*.tsx' 'src/*.css' 'src/**/*.ts' 'src/**/*.tsx' 'src/**/*.css'",
      { cwd: ROOT, encoding: 'utf8' }
    ).trim().split('\n').filter(Boolean)
  );
}

const isHexExempt = (f) => HEX_EXEMPT.some((re) => re.test(f));

/**
 * RULE 6 helper. Walk every `style={{ … }}` attribute in a file by brace matching
 * (a regex cannot balance braces, and these blocks routinely contain nested objects
 * and template literals) and return the color literals found inside each one.
 *
 * `hexConsts` maps a module-level constant name to its hex, so a block that writes
 * `backgroundColor: BRAND_ACCENT` is reported with the value it resolves to. The map
 * is built across all of src/, so this does not follow import graphs — a name defined
 * in two files with different hexes resolves to whichever was collected first. That is
 * accepted imprecision: the finding is "an inline style sets a hardcoded color here",
 * and the exact shade only sharpens the message.
 */
function inlineColorHits(code, hexConsts) {
  const hits = [];
  let i = 0;
  while ((i = code.indexOf('style={{', i)) !== -1) {
    let depth = 0;
    let end = -1;
    for (let j = i + 'style='.length; j < code.length; j++) {
      const c = code[j];
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { end = j; break; }
    }
    if (end === -1) break; // unbalanced (truncated file) — stop rather than guess
    const block = code.slice(i, end + 1);
    const found = new Set(block.match(INLINE_COLOR) ?? []);
    for (const [name, hex] of hexConsts) {
      if (new RegExp(`\\b${name}\\b`).test(block)) found.add(`${name} (${hex})`);
    }
    if (found.size) {
      hits.push({ line: code.slice(0, i).split('\n').length, values: [...found].join(', ') });
    }
    i = end + 1;
  }
  return hits;
}

/**
 * RULE 8 driver for one file: walk its class-list string literals and return the pairs
 * that fail AA, plus how many pairs were skipped as unresolvable.
 */
function contrastHits(code) {
  const fails = [];
  const skipped = {};
  const skippedNames = {};
  let evaluated = 0;
  for (const m of code.matchAll(STRING_LITERAL)) {
    const body = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' ');
    if (!LOOKS_LIKE_CLASSES.test(body) || NOT_A_CLASS_LIST.test(body)) continue;
    let line = null;
    for (const pair of contrastPairs(body)) {
      if (pair.skipped) {
        skipped[pair.skipped] = (skipped[pair.skipped] ?? 0) + 1;
        skippedNames[pair.culprit] = (skippedNames[pair.culprit] ?? 0) + 1;
        continue;
      }
      evaluated++;
      if (pair.ratio >= pair.threshold) continue;
      line ??= code.slice(0, m.index).split('\n').length;
      fails.push({ line, ...pair });
    }
  }
  return { fails, skipped, skippedNames, evaluated };
}

function scan() {
  const files = listFiles();
  const coolHits = [];        // {file, line, text}
  const hexByFile = {};       // file -> Set(hex)
  const darkDebtByFile = {};  // file -> count of solid-green tokens on dark-blind lines
  const shadowByFile = {};    // RULE 4: file -> count of bare shadow-sm|md|lg|xl
  const radiusByFile = {};    // RULE 5: file -> count of arbitrary rounded-[..]
  const inlineByFile = {};    // RULE 6: file -> count of inline-style color sites
  const inlineHits = [];      // RULE 6: {file, line, values} for the report
  const typeByFile = {};      // RULE 7: file -> count of off-ramp text-[Npx]
  const typeHits = [];        // RULE 7: {file, line, px} for the report
  const contrastFails = [];   // RULE 8: {file, line, theme, bg, fg, ratio, threshold}
  const contrastStats = { skipped: {}, names: {}, evaluated: 0 }; // RULE 8: blind-spot size, by reason

  // RULE 6 pre-pass: collect module-level hex constants across src/ before scanning
  // style blocks, so a constant declared in one file and used in another still resolves.
  const codeByFile = new Map();
  const hexConsts = new Map();
  for (const f of files) {
    if (f === 'src/design/tokens.json' || f.endsWith('.css')) continue;
    const code = stripComments(readFileSync(resolve(ROOT, f), 'utf8'));
    codeByFile.set(f, code);
    for (const m of code.matchAll(HEX_CONST_DECL)) {
      if (!hexConsts.has(m[1])) hexConsts.set(m[1], m[2]);
    }
  }

  for (const f of files) {
    if (f === 'src/design/tokens.json') continue;
    const raw = readFileSync(resolve(ROOT, f), 'utf8');
    const code = stripComments(raw);
    // RULE 1 — report with line numbers (scan the stripped code line by line)
    code.split('\n').forEach((ln, i) => {
      const m = ln.match(COOL_NEUTRAL);
      if (m) coolHits.push({ file: f, line: i + 1, text: [...new Set(m)].join(', ') });
      // RULE 3 — a solid green class on a line with no `dark:` variant is a
      // dark-blind surface. Count per file (ratchet, not per-line report).
      if (!ln.includes('dark:')) {
        const greens = ln.match(SOLID_GREEN);
        if (greens) darkDebtByFile[f] = (darkDebtByFile[f] ?? 0) + greens.length;
      }
    });
    // RULE 2 — collect hex per file (skip exempt)
    if (!isHexExempt(f)) {
      const hexes = code.match(HEX);
      if (hexes) hexByFile[f] = new Set(hexes.map((h) => h.toLowerCase()));
    }
    // RULE 4 / RULE 5 — count shape violations per file (ratchet, like RULE 3).
    const shadows = code.match(SHADOW_BARE);
    if (shadows) shadowByFile[f] = shadows.length;
    const radii = code.match(RADIUS_ARB);
    if (radii) radiusByFile[f] = radii.length;
    // RULE 7 — literal font sizes OFF the documented ramp. On-ramp values are
    // legitimate everywhere and are never counted; only drift is debt.
    code.split('\n').forEach((ln, i) => {
      for (const m of ln.matchAll(TEXT_ARB_PX)) {
        if (TYPE_SCALE_PX.has(m[1])) continue;
        typeByFile[f] = (typeByFile[f] ?? 0) + 1;
        typeHits.push({ file: f, line: i + 1, px: m[1] });
      }
    });
    // RULE 6 — inline style color literals (see inlineColorHits above).
    if (!f.endsWith('.css')) {
      const hits = inlineColorHits(code, hexConsts);
      if (hits.length) {
        inlineByFile[f] = hits.length;
        for (const h of hits) inlineHits.push({ file: f, ...h });
      }
    }
    // RULE 8 — resting-state contrast ratio (see contrastPairs above).
    if (!f.endsWith('.css')) {
      const { fails, skipped, skippedNames, evaluated } = contrastHits(code);
      for (const h of fails) contrastFails.push({ file: f, ...h });
      for (const [why, n] of Object.entries(skipped)) {
        contrastStats.skipped[why] = (contrastStats.skipped[why] ?? 0) + n;
      }
      for (const [name, n] of Object.entries(skippedNames)) {
        contrastStats.names[name] = (contrastStats.names[name] ?? 0) + n;
      }
      contrastStats.evaluated += evaluated;
    }
  }
  return { coolHits, hexByFile, darkDebtByFile, shadowByFile, radiusByFile, inlineByFile, inlineHits, typeByFile, typeHits, contrastFails, contrastStats };
}

const { coolHits, hexByFile, darkDebtByFile, shadowByFile, radiusByFile, inlineByFile, inlineHits, typeByFile, typeHits, contrastFails, contrastStats } = scan();

// `--report-contrast` prints every RULE 8 failure plus the size of the rule's blind spot
// (pairs it could not resolve to two hexes). Read this before trusting a green run.
const contrastSkipped = Object.values(contrastStats.skipped).reduce((n, c) => n + c, 0);
const contrastSkipBreakdown = Object.entries(contrastStats.skipped)
  .sort(([, a], [, b]) => b - a)
  .map(([why, n]) => `${n} ${why}`)
  .join(', ');

if (process.argv.includes('--report-contrast')) {
  console.log(`RULE 8 — resting-state contrast: ${contrastFails.length} failing pair(s); ${contrastStats.evaluated} pair(s) evaluated, ${contrastSkipped} skipped as unresolvable (${contrastSkipBreakdown || 'none'})\n`);
  for (const h of contrastFails) {
    console.log(`   ${h.file}:${h.line}  [${h.theme}]  ${h.bg} on ${h.fg}  ${h.ratio.toFixed(2)}:1 < ${h.threshold}:1`);
  }
  console.log(`\n   Blind spot — the colour names that could not be resolved to a hex, most common first.`);
  console.log(`   Adding one of these to src/design/tokens.json widens RULE 8's coverage by that many pairs.`);
  for (const [name, n] of Object.entries(contrastStats.names).sort(([, a], [, b]) => b - a).slice(0, 20)) {
    console.log(`      ${String(n).padStart(4)}  ${name}`);
  }
  process.exit(0);
}

// `--report-type` prints every RULE 7 site regardless of baseline — the standing
// type drift you are meant to migrate onto a documented step.
if (process.argv.includes('--report-type')) {
  console.log(`RULE 7 — off-ramp literal font sizes: ${typeHits.length} site(s) in ${Object.keys(typeByFile).length} file(s)`);
  console.log(`   documented ramp (src/design/tokens.json typography.scale): ${[...TYPE_SCALE_PX].sort((a, b) => a - b).join('px, ')}px\n`);
  const byPx = {};
  for (const h of typeHits) (byPx[h.px] ??= []).push(h);
  for (const px of Object.keys(byPx).sort((a, b) => a - b)) {
    console.log(`   ${px}px — ${byPx[px].length} site(s)`);
    for (const h of byPx[px]) console.log(`      ${h.file}:${h.line}`);
  }
  process.exit(0);
}

// `--report-inline` prints every RULE 6 site regardless of baseline. The ratchet only
// blocks growth, so this is how you read the standing debt you are meant to shrink.
if (process.argv.includes('--report-inline')) {
  console.log(`RULE 6 — inline style color literals: ${inlineHits.length} site(s) in ${Object.keys(inlineByFile).length} file(s)\n`);
  for (const h of inlineHits) console.log(`   ${h.file}:${h.line}  ${h.values}`);
  process.exit(0);
}

if (process.argv.includes('--write-baseline')) {
  const out = {};
  for (const [f, set] of Object.entries(hexByFile)) out[f] = [...set].sort();
  writeFileSync(BASELINE_PATH, JSON.stringify(out, null, 2) + '\n');
  const darkOut = Object.fromEntries(
    Object.entries(darkDebtByFile).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(DARK_BASELINE_PATH, JSON.stringify(darkOut, null, 2) + '\n');
  const darkTotal = Object.values(darkOut).reduce((n, c) => n + c, 0);
  console.log(`✍️  wrote hex baseline: ${Object.keys(out).length} files, ${Object.values(out).reduce((n, a) => n + a.length, 0)} grandfathered hex values`);
  console.log(`✍️  wrote dark-debt baseline: ${Object.keys(darkOut).length} files, ${darkTotal} solid-green-without-dark occurrences (RULE 3 — shrink, don't grow)`);
  const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  const shapeOut = { shadow: sortObj(shadowByFile), radius: sortObj(radiusByFile) };
  writeFileSync(SHAPE_BASELINE_PATH, JSON.stringify(shapeOut, null, 2) + '\n');
  const shadowTotal = Object.values(shadowByFile).reduce((n, c) => n + c, 0);
  const radiusTotal = Object.values(radiusByFile).reduce((n, c) => n + c, 0);
  console.log(`✍️  wrote shape baseline: ${shadowTotal} bare shadow-sm|md|lg|xl (RULE 4), ${radiusTotal} arbitrary rounded-[..] (RULE 5) — both DEBT, shrink don't grow.`);
  const inlineOut = sortObj(inlineByFile);
  writeFileSync(INLINE_BASELINE_PATH, JSON.stringify(inlineOut, null, 2) + '\n');
  const inlineTotal = Object.values(inlineOut).reduce((n, c) => n + c, 0);
  console.log(`✍️  wrote inline-color baseline: ${inlineTotal} inline style color site(s) in ${Object.keys(inlineOut).length} file(s) (RULE 6 — DEBT; \`--report-inline\` lists them).`);
  const typeOut = sortObj(typeByFile);
  writeFileSync(TYPE_BASELINE_PATH, JSON.stringify(typeOut, null, 2) + '\n');
  const typeTotal = Object.values(typeOut).reduce((n, c) => n + c, 0);
  console.log(`✍️  wrote type-scale baseline: ${typeTotal} off-ramp text-[Npx] site(s) in ${Object.keys(typeOut).length} file(s) (RULE 7 — DEBT; \`--report-type\` lists them).`);
  process.exit(0);
}

const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : {};

// RULE 2 violations = hex present now but not in the baseline for that file.
const hexViolations = [];
for (const [f, set] of Object.entries(hexByFile)) {
  const allowed = new Set(baseline[f] || []);
  for (const h of set) if (!allowed.has(h)) hexViolations.push({ file: f, hex: h });
}

// RULE 3 violations = a file's solid-green-without-dark count EXCEEDS its
// baseline (new dark-blind green surface added). Converting surfaces only ever
// lowers a count, so a legit change never trips this — it only catches growth.
const darkBaseline = existsSync(DARK_BASELINE_PATH)
  ? JSON.parse(readFileSync(DARK_BASELINE_PATH, 'utf8'))
  : {};
const darkViolations = [];
for (const [f, count] of Object.entries(darkDebtByFile)) {
  const allowed = darkBaseline[f] ?? 0;
  if (count > allowed) darkViolations.push({ file: f, count, allowed });
}

// RULE 4 / RULE 5 violations = a file's bare-shadow / arbitrary-radius count EXCEEDS
// its baseline. The codemod only ever LOWERS a count, so a legit migration never trips
// this; it catches growth — a newly added shadow-md or rounded-[13px].
const shapeBaseline = existsSync(SHAPE_BASELINE_PATH)
  ? JSON.parse(readFileSync(SHAPE_BASELINE_PATH, 'utf8'))
  : { shadow: {}, radius: {} };
const ratchet = (byFile, base) => {
  const out = [];
  for (const [f, count] of Object.entries(byFile)) {
    const allowed = base?.[f] ?? 0;
    if (count > allowed) out.push({ file: f, count, allowed });
  }
  return out;
};
const typeBaseline = existsSync(TYPE_BASELINE_PATH)
  ? JSON.parse(readFileSync(TYPE_BASELINE_PATH, 'utf8'))
  : {};
const shadowViolations = ratchet(shadowByFile, shapeBaseline.shadow);
const radiusViolations = ratchet(radiusByFile, shapeBaseline.radius);
const typeViolations = ratchet(typeByFile, typeBaseline);

// RULE 6 violations = a file's inline-style color-site count EXCEEDS its baseline.
const inlineBaseline = existsSync(INLINE_BASELINE_PATH)
  ? JSON.parse(readFileSync(INLINE_BASELINE_PATH, 'utf8'))
  : {};
const inlineViolations = ratchet(inlineByFile, inlineBaseline);

let failed = false;
if (coolHits.length) {
  failed = true;
  console.error(`\n❌ RULE 1 — cool-neutral Tailwind classes are banned (use the warm stone-* scale). ${coolHits.length} violation(s):`);
  for (const h of coolHits.slice(0, 50)) console.error(`   ${h.file}:${h.line}  ${h.text}`);
  if (coolHits.length > 50) console.error(`   …and ${coolHits.length - 50} more`);
}
if (hexViolations.length) {
  failed = true;
  console.error(`\n❌ RULE 2 — new raw hex color(s) not in scripts/color-baseline.json. ${hexViolations.length} violation(s):`);
  for (const v of hexViolations.slice(0, 50)) console.error(`   ${v.file}  ${v.hex}   (use a token from src/design/tokens.json; if genuinely legitimate, add to the exempt globs)`);
  if (hexViolations.length > 50) console.error(`   …and ${hexViolations.length - 50} more`);
}
if (darkViolations.length) {
  failed = true;
  console.error(`\n❌ RULE 3 — new dark-blind green surface(s): a file's solid \`bg-/from-/to-malachite-*\` (no \`/opacity\`) count grew past scripts/color-dark-baseline.json. ${darkViolations.length} file(s):`);
  for (const v of darkViolations.slice(0, 50)) console.error(`   ${v.file}  ${v.count} > ${v.allowed} allowed   (give the green a \`dark:\` variant, or make the surface neutral with a green accent — see .claude/rules/design-system.md)`);
  if (darkViolations.length > 50) console.error(`   …and ${darkViolations.length - 50} more`);
}

if (shadowViolations.length) {
  failed = true;
  console.error(`\n❌ RULE 4 — new bare Tailwind elevation class(es): a file's \`shadow-sm|md|lg|xl\` count grew past scripts/shape-baseline.json. ${shadowViolations.length} file(s):`);
  for (const v of shadowViolations.slice(0, 50)) console.error(`   ${v.file}  ${v.count} > ${v.allowed} allowed   (use an elevation tier: shadow-flat / shadow-raised / shadow-overlay — see .claude/rules/design-system.md)`);
  if (shadowViolations.length > 50) console.error(`   …and ${shadowViolations.length - 50} more`);
}
if (radiusViolations.length) {
  failed = true;
  console.error(`\n❌ RULE 5 — new arbitrary radius value(s): a file's \`rounded-[..]\` count grew past scripts/shape-baseline.json. ${radiusViolations.length} file(s):`);
  for (const v of radiusViolations.slice(0, 50)) console.error(`   ${v.file}  ${v.count} > ${v.allowed} allowed   (use a semantic radius tier: rounded-control / rounded-card / rounded-editorial / rounded-pill — see src/design/tokens.json)`);
  if (radiusViolations.length > 50) console.error(`   …and ${radiusViolations.length - 50} more`);
}

if (inlineViolations.length) {
  failed = true;
  console.error(`\n❌ RULE 6 — new inline style color literal(s): a file's \`style={{ … }}\` color-site count grew past scripts/inline-color-baseline.json. ${inlineViolations.length} file(s):`);
  for (const v of inlineViolations.slice(0, 50)) console.error(`   ${v.file}  ${v.count} > ${v.allowed} allowed   (a class-string scanner cannot see an inline color, so RULE 3's dark-mode ratchet never counts it — use a Tailwind token class, or \`hsl(var(--token))\` if the value must be computed)`);
  if (inlineViolations.length > 50) console.error(`   …and ${inlineViolations.length - 50} more`);
  console.error(`   Run \`node scripts/check-colors.mjs --report-inline\` to list every site.`);
}

if (typeViolations.length) {
  failed = true;
  console.error(`\n❌ RULE 7 — new off-ramp font size(s): a file's non-ramp \`text-[Npx]\` count grew past scripts/type-baseline.json. ${typeViolations.length} file(s):`);
  for (const v of typeViolations.slice(0, 50)) console.error(`   ${v.file}  ${v.count} > ${v.allowed} allowed   (use a documented step from src/design/tokens.json typography.scale: ${[...TYPE_SCALE_PX].sort((a, b) => a - b).join('px, ')}px)`);
  if (typeViolations.length > 50) console.error(`   …and ${typeViolations.length - 50} more`);
  console.error(`   Run \`node scripts/check-colors.mjs --report-type\` to list every site.`);
}

// RULE 8 violations = any resting pair below its WCAG threshold. NO baseline, NO ratchet:
// the floor is zero. Rules 3-7 are growth ratchets that are indifferent to standing debt,
// and a per-file COUNT baseline lets a fix and a fresh violation in the same file net out
// to zero and pass. Contrast is not debt to be tracked — it is a bug, and there are none
// left, so zero is both achievable and the only honest floor.
// Apply the waivers BEFORE reporting, and hold each one to account (see CONTRAST_WAIVERS).
const TODAY = new Date().toISOString().slice(0, 10);
const waived = [];
const liveContrastFails = contrastFails.filter((v) => {
  const w = CONTRAST_WAIVERS.find(
    (x) => x.file === v.file && v.bg.startsWith(`${x.bg} `) && v.fg.startsWith(`${x.fg} `) && x.theme === v.theme,
  );
  if (!w || w.expires < TODAY) return true; // unwaived, or the waiver has run out
  w.used = true;
  waived.push({ ...v, reason: w.reason, expires: w.expires });
  return false;
});

if (waived.length) {
  console.warn(`\n⚠️  RULE 8 — ${waived.length} contrast failure(s) under a NAMED, EXPIRING waiver:`);
  for (const v of waived) {
    console.warn(`   ${v.file}:${v.line}  [${v.theme}]  ${v.bg} + ${v.fg}  ${v.ratio.toFixed(2)}:1  — expires ${v.expires}`);
    console.warn(`      ${v.reason}`);
  }
}
const staleWaivers = CONTRAST_WAIVERS.filter((w) => !w.used && w.expires >= TODAY);
if (staleWaivers.length) {
  failed = true;
  console.error(`\n❌ RULE 8 — ${staleWaivers.length} contrast waiver(s) no longer match anything. Delete them:`);
  for (const w of staleWaivers) console.error(`   ${w.file}  ${w.bg} + ${w.fg} [${w.theme}]   (the violation is gone; a waiver that matches nothing overstates the gate's coverage)`);
}
const expiredWaivers = CONTRAST_WAIVERS.filter((w) => w.expires < TODAY);
if (expiredWaivers.length) {
  failed = true;
  console.error(`\n❌ RULE 8 — ${expiredWaivers.length} contrast waiver(s) EXPIRED. Fix the site or re-justify with a new date:`);
  for (const w of expiredWaivers) console.error(`   ${w.file}  ${w.bg} + ${w.fg} [${w.theme}]   expired ${w.expires}   ${w.reason}`);
}

if (liveContrastFails.length) {
  failed = true;
  console.error(`\n❌ RULE 8 — resting-state contrast below WCAG AA. ${liveContrastFails.length} pair(s):`);
  for (const v of liveContrastFails.slice(0, 50)) {
    console.error(`   ${v.file}:${v.line}  [${v.theme}]  bg ${v.bg} + text ${v.fg}  =  ${v.ratio.toFixed(2)}:1  (needs ${v.threshold}:1)   (darken the fill — malachite-800 is the AA-safe brand green on white — or lighten the text)`);
  }
  if (contrastFails.length > 50) console.error(`   …and ${contrastFails.length - 50} more`);
  console.error(`   Run \`node scripts/check-colors.mjs --report-contrast\` for every pair, and the size of the rule's blind spot.`);
}

if (failed) {
  console.error('\nColor hygiene gate FAILED. See .claude/rules/design-system.md.\n');
  process.exit(1);
}
const darkDebtTotal = Object.values(darkDebtByFile).reduce((n, c) => n + c, 0);
const shadowDebtTotal = Object.values(shadowByFile).reduce((n, c) => n + c, 0);
const radiusDebtTotal = Object.values(radiusByFile).reduce((n, c) => n + c, 0);
const inlineDebtTotal = Object.values(inlineByFile).reduce((n, c) => n + c, 0);
const typeDebtTotal = Object.values(typeByFile).reduce((n, c) => n + c, 0);
console.log(`✅ color hygiene gate passed: 0 cool-neutral classes, 0 new raw hex, 0 new dark-blind green surfaces (RULE 3 debt: ${darkDebtTotal}), 0 new bare shadows (RULE 4 debt: ${shadowDebtTotal}), 0 new arbitrary radii (RULE 5 debt: ${radiusDebtTotal}), 0 new inline style colors (RULE 6 debt: ${inlineDebtTotal}), 0 new off-ramp font sizes (RULE 7 debt: ${typeDebtTotal}) — all tracked, shrinking.`);
console.log(`   RULE 8 contrast: 0 failing pairs of ${contrastStats.evaluated} evaluated (zero floor, no baseline)${waived.length ? `, ${waived.length} under a dated waiver (above)` : ''}; ${contrastSkipped} pair(s) unresolvable and therefore unchecked — ${contrastSkipBreakdown || 'none'}.`);
