---
name: Dormcheck
description: Warm, quiet campus-life UI where one malachite green does all the pointing.
colors:
  malachite: "#03C03C"
  malachite-deep: "#0B702B"
  malachite-dark: "#078830"
  malachite-light: "#34A853"
  slate-brand: "#2B4E5F"
  stone-50: "#fbfaf9"
  stone-200: "#e8e6e3"
  stone-400: "#a7a095"
  stone-500: "#756c61"
  stone-600: "#575047"
  stone-900: "#1d1916"
  stone-950: "#0c0a09"
  surface: "#FFFFFF"
  page: "#F5FBF7"
  destructive: "#BA1C1C"
  heart: "#FF6B6B"
  star: "#B45309"
typography:
  display:
    fontFamily: "Jost, Nunito, system-ui, sans-serif"
    fontSize: "clamp(44px, 6vw, 80px)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  editorial:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(48px, 8vw, 104px)"
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Jost, Nunito, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Nunito, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Nunito, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "normal"
  wordmark:
    fontFamily: "Sora, Nunito, sans-serif"
    fontWeight: 700
    letterSpacing: "-0.03em"
  # The literal step ramp for Tailwind arbitrary sizes (text-[Npx]). Projected
  # from src/design/tokens.json -> typography.scale, which is CANONICAL: edit
  # there, mirror here in the same pass. Any text-[Npx] not on this ramp is
  # drift, ratcheted per file by RULE 7 in scripts/check-colors.mjs
  # (scripts/type-baseline.json, 47 sites of standing debt - shrink, never grow;
  # `node scripts/check-colors.mjs --report-type` lists them).
  # nano/micro = badges + tracking labels · caption = eyebrows · body-* = copy
  # · ui-lg = prominent inline UI · title-* = card, section, and band headings.
  scale:
    nano: "9px"
    micro: "10px"
    micro-lg: "11px"
    fine: "12px"
    caption: "13px"
    body-sm: "15px"
    body: "17px"
    body-lg: "19px"
    ui-lg: "20px"
    title-sm: "26px"
    title: "28px"
    title-lg: "30px"
    title-xl: "34px"
    title-2xl: "44px"
rounded:
  control: "12px"
  card: "16px"
  editorial: "24px"
  pill: "9999px"
spacing:
  "4": "4px"
  "8": "8px"
  "12": "12px"
  "16": "16px"
  "24": "24px"
  "32": "32px"
  "48": "48px"
components:
  button-primary:
    backgroundColor: "{colors.malachite-deep}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.malachite-dark}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.slate-brand}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "40px"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.stone-900}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "40px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.stone-900}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "40px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.stone-900}"
    rounded: "{rounded.card}"
    padding: "24px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.stone-900}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "40px"
  chip:
    backgroundColor: "{colors.stone-50}"
    textColor: "{colors.stone-600}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
---

# Design System: Dormcheck

## Overview

**Creative North Star: "The Quiet Dorm Room"**

Dormcheck looks like a room a student has actually settled into: warm, uncluttered, and
comfortable to sit inside for a while. The neutrals are stone, not slate. The shadows are warm,
not blue. Corners are generous but never novelty-round. Nothing competes for attention until
something is genuinely worth acting on, and then a single malachite green says so.

The system is deliberately subtractive. An earlier generation of this UI used brand green for
headers, icons, badges, borders, and buttons at once, which flattened the hierarchy into noise.
The current world holds roughly three green moments per screen: the primary action, the active
navigation state, and one accent. Everything else is carried by warm neutral surfaces and type
weight. Restraint here is the brand expression, not the absence of one.

Density is phone-first. Unprefixed sizing is the mobile and iOS baseline; desktop is a layered
case added with `md:`/`lg:`, never a re-tune of the base. Confirmed anti-references: cool slate
grays, pure-blue shadow tones, the generic pulsing-skeleton shimmer, and any second green.

**Key Characteristics:**

- Warm stone neutrals against true-white cards
- One accent green, spent sparingly and always on something actionable
- Four semantic corner tiers chosen by what an element *is*, not how big it is
- Exactly three elevation steps
- Nunito for reading, Jost for headings, Fraunces reserved for marketing headlines
- iOS-weighted motion easing across every surface

## Colors

A warm neutral field with one high-chroma green, plus a muted brand slate that appears only in
secondary roles.

### Primary

- **Malachite** (`#03C03C`): the brand green. Correct for accent marks, active states, focus
  rings, illustrative fills, and gradient endpoints. It is the identity color, not the default
  button color.
- **Deep Malachite** (`#0B702B`): the green that carries text on top of it. Every solid green
  fill on a light background uses this, because the brand tone does not hold AA contrast against
  white. This is what `bg-primary` actually resolves to.
- **Dark Malachite** (`#078830`): hover and pressed states beneath a solid green fill, plus the
  midpoint of the brand gradient.
- **Light Malachite** (`#0CDB4A`, = `malachite-500`): gradient and badge lightening only. Never a
  standalone accent, or the screen ends up with two greens. Retargeted 2026-08-02 from `#34A853`,
  which was byte-identical to Google's brand green while `Auth.tsx` renders that same value in the
  Sign-in-with-Google mark. It is now derived one step up the malachite ramp from the brand.

### Secondary

- **Brand Slate** (`#2B4E5F`): a deep desaturated teal-navy used for secondary buttons and a few
  header treatments. It exists to give a second action a voice without spending green on it.

### Neutral

- **Paper Stone** (`#fbfaf9`): the lightest warm neutral; subtle fills and hover washes.
- **Hairline Stone** (`#e8e6e3`): the default card and input border. Replaced the old cool
  `slate-200` outright.
- **Placeholder Stone** (`#a7a095`): decorative and placeholder use only. It measures 2.6:1 and
  is below AA, so it must never carry meaning.
- **Muted Stone** (`#756c61`): secondary and supporting text. Deliberately darkened off stock
  stone to clear AA on both white cards and the tinted page.
- **Body Stone** (`#575047`): running body copy.
- **Ink Stone** (`#1d1916`): headings and near-black text.
- **Anchor Stone** (`#0c0a09`): the dark end of the brand gradient and the hue that the shadow
  color is derived from.
- **Card White** (`#FFFFFF`): cards, popovers, sheets, and the app background.
- **Page Tint** (`#F5FBF7`): a barely-green off-white used for the marketing and page canvas so
  white cards read as lifted against it.

### Tertiary

- **Alarm Red** (`#BA1C1C`): destructive actions and error states only. Darkened off the stock
  `#EF4444` so white text on a solid destructive fill clears AA. Dark mode lightens it to
  `hsl(0 72% 51%)`.
- **Heart Coral** (`#FF6B6B`): the saved/favorite fill. It is a state color, not a palette entry
  available for general use.
- **Star Amber** (`#B45309`): rating stars only.

### Named Rules

**The Three Greens Rule.** A screen gets about three green moments: the primary action, the
active nav state, and one accent. If you are adding a fourth, something else must give one up.

**The AA Fill Rule.** Solid green fills on light backgrounds use Deep Malachite (`#0B702B`),
never the brand tone. `#03C03C` is for accents, marks, and focus rings, where it never has to
carry text.

**The Warm Neutral Rule.** Every gray in this system is warm stone. Cool slate grays and blue
shadow hues are an anti-reference, not a fallback.

## Typography

**Display Font:** Jost (falls back to Nunito, then system-ui)
**Body Font:** Nunito (falls back to system-ui)
**Editorial Font:** Fraunces (marketing headlines only)
**Wordmark Font:** Sora (the logotype only, never body or UI)

**Character:** Nunito's rounded terminals keep long checklists and message threads friendly and
easy on the eye at small sizes; Jost's geometric structure gives headings authority without
switching the voice. Fraunces appears only where the product is selling rather than working, so
serifs read as an event.

### Hierarchy

- **Display** (700, `clamp(44px, 6vw, 80px)`, 1.05, -0.02em): marketing hero headlines.
- **Editorial** (600, `clamp(48px, 8vw, 104px)`, 1.02): the single statement headline on a
  landing surface. Fraunces. At most one per page.
- **Headline** (600, 1.5rem, 1, -0.01em): card titles and section headers. Jost.
- **Body** (400, 1rem, 1.5): running copy, list items, message bodies. Nunito. Cap prose at
  roughly 65-75ch.
- **Label** (500, 0.875rem): buttons, chips, form labels, metadata. Nunito.
- **Micro** (500-600, 0.75rem / `text-xs`): the smallest legal step. Dense secondary metadata
  only — timestamps, badge text, row captions. Never running copy.

### Named Rules

**The Four Families Rule.** There are exactly four type families: Nunito, Jost, Fraunces, Sora.
Fraunces is marketing-only and Sora is wordmark-only, which means product UI has two.

**The No Em Dash Rule.** User-facing copy uses no em dashes. Rewrite the sentence instead.

**The 12px Floor.** `text-xs` (12px) is the smallest size in the system. Anything below it —
`text-[11px]`, `text-[10px]`, `text-[8px]` — is off the ramp and below the legibility floor on a
phone, which is the baseline surface. This rule was added 2026-08-02 after an audit found 170
sub-12px literals across 82 files; that debt is real and is being paid down surface by surface,
so the rule governs new code and any file being touched for another reason. Arbitrary sizes at or
above 12px (`text-[13px]`, `text-[15px]`) are a separate, milder drift: they are legible but
unsystematic, and the marketing surfaces intentionally run their own composed scale.

## Layout

The spacing scale is a fixed seven-step ramp keyed by pixel value: 4, 8, 12, 16, 24, 32, 48.
Card interiors default to 24px. Containers are centered with 1rem of padding and cap at 1400px
at the `2xl` breakpoint.

Layout is mobile-first without exception. Unprefixed Tailwind classes describe the phone and the
iOS app; desktop behavior is added with `md:` (768px) and `lg:` only. Fixing a desktop problem by
editing an unprefixed class is a regression on two of the three surfaces.

The runtime, not the build, decides the shell: `Capacitor.isNativePlatform()` selects the native
top bar and bottom navigation, and `useIsMobile()` at 768px selects responsive web behavior. One
`src/` produces all of it, so a layout decision must be defensible on a phone, in a WKWebView,
and on a desktop viewport at once.

A `--density` custom property exists and scales the rhythm globally; treat it as a system knob
rather than something to adjust per component.

## Elevation & Depth

Depth is structural and warm. Shadows are anchored on a stone hue (~26deg) rather than the cool
slate hue the system used previously, so a lifted card looks like paper on wood rather than glass
on steel. The scale is a closed set of three; the older Tailwind-style aliases (`shadow-sm`,
`shadow-md`, `shadow-lg`, `shadow-xl`, `shadow-card`, `shadow-elevated`, `shadow-soft`) still
resolve, but only for back-compatibility, and new work should not reach for them.

### Shadow Vocabulary

- **Raised** (`0 1px 3px hsl(var(--shadow-color) / 0.06), 0 6px 16px -4px hsl(var(--shadow-color) / 0.10)`):
  the resting card. This is the default and the most common.
- **Overlay** (`0 4px 12px -2px hsl(var(--shadow-color) / 0.10), 0 18px 36px -10px hsl(var(--shadow-color) / 0.16)`):
  anything floating over content. Dialogs, popovers, sheets, floating menus.
- **Brand** (`0 4px 14px -3px hsl(139 97% 38% / 0.25)`): a green-tinted glow reserved for the
  primary call to action. It is a spotlight, so at most one per view.

### Named Rules

**The Three-Step Rule.** Elevation has exactly three answers: `shadow-raised` for a resting card,
`shadow-overlay` for something floating over content, `shadow-brand` for the green CTA. There is
no fourth.

## Shapes

Corners are chosen semantically, by what the element *is*, never by how big it is. Four tiers:

- **Control** (12px): buttons, inputs, selects, and anything you press or type into.
- **Card** (16px): the default container corner.
- **Editorial** (24px): large, page-like surfaces such as marketing panels and full-bleed
  sections.
- **Pill** (9999px): badges, chips, avatars, and toggles.

The raw `sm`/`md`/`lg`/`xl`/`2xl`/`3xl` scale is monotonic and still available, but reaching for
it re-opens a bug the semantic tiers exist to prevent: a button that changed size used to
silently change its corner too. Size variants must never restate a radius.

Borders are hairlines in warm stone, one pixel, used to define an edge rather than to decorate
one. The system is not outline-heavy; surface color and elevation do most of the separating.

## Components

### Buttons

- **Shape:** the control tier (12px), constant across every size variant.
- **Primary:** Deep Malachite fill with white text, 40px tall, 16px horizontal padding. Icons
  inherit the button's text color at 16px.
- **Hover / Focus:** background lifts toward Dark Malachite; pressing scales to 0.98 with an
  iOS-weighted curve. Focus is a 2px malachite ring offset 2px from the control. Both transforms
  and transitions are suppressed under `prefers-reduced-motion`.
- **Secondary:** Brand Slate fill with white text, for a second real action that should not spend
  green.
- **Outline:** white surface, warm hairline border, ink text; hovers to a muted stone wash.
- **Ghost:** no chrome at rest, muted stone wash on hover. The default for icon-only controls,
  which always carry an accessible name.
- **Destructive:** Alarm Red fill with white text. Never used for a merely irreversible-looking
  action, only a genuinely destructive one.

### Cards / Containers

- **Corner Style:** the card tier (16px).
- **Background:** true white on the tinted page, so the lift is legible without a heavy shadow.
- **Shadow Strategy:** `shadow-raised` at rest. Cards do not escalate to `overlay` on hover; they
  shift to the warm `card-hover` tint instead.
- **Border:** one-pixel warm hairline.
- **Internal Padding:** 24px, with the title block and body separated by the 8/12 step.

### Inputs / Fields

- **Style:** white surface, warm hairline border, control-tier corner, 40px tall, body type.
- **Focus:** the border yields to a 2px malachite focus ring offset from the field. The ring is
  the only place the full-chroma brand green touches a form.
- **Error:** Alarm Red border and message text, with the message placed under the field rather
  than in a toast.
- **Disabled:** 50% opacity with pointer events removed.

### Chips

- **Style:** pill corner, paper-stone fill, muted-stone label, no border.
- **State:** a selected filter chip takes a Deep Malachite fill with white text. Selection is the
  only chip state that earns green.

### Navigation

Two shells, one identity. On the native app and mobile web, a bottom navigation bar carries the
primary destinations with a native top bar above; on desktop web, a global top navigation replaces
both. In either shell the active item is the one green moment: malachite icon and label against
muted stone for the rest. Inactive items never use a second color to signal availability.

### Signature: the Sneak-Peek Blur Wall

A gated-content surface that renders real content behind a progressive blur with an unlock
affordance over it, rather than an empty-state placeholder. It is how the product shows value
before an account exists. The blur must always sit over genuine content; faking it with a
gradient over lorem defeats the point.

## Do's and Don'ts

### Do:

- **Do** pick a corner from the four semantic tiers by what the element is: control (12px) for
  pressables and fields, card (16px) for containers, editorial (24px) for page-scale surfaces,
  pill for badges and avatars.
- **Do** use Deep Malachite (`#0B702B`) for any solid green fill on a light background, per The
  AA Fill Rule.
- **Do** keep to about three green moments per screen, per The Three Greens Rule.
- **Do** reach for `shadow-raised`, `shadow-overlay`, or `shadow-brand` and nothing between them.
- **Do** write unprefixed Tailwind for the phone and iOS baseline, then add `md:`/`lg:` for
  desktop.
- **Do** give every icon-only control an accessible name; `jsx-a11y` and axe are blocking gates.
- **Do** use semantic color tokens (`bg-background`, `text-foreground`, `bg-card`,
  `text-muted-foreground`) so dark mode works without extra work.

### Don't:

- **Don't** hard-code a green hex. Use the nearest `malachite-*` step. There is exactly one brand
  green (`#03C03C`) and it is never described as teal.
- **Don't** introduce a cool slate gray or a blue-hued shadow. Every neutral is warm stone.
- **Don't** put Placeholder Stone (`#a7a095`) on anything meaningful; it fails AA at 2.6:1.
- **Don't** change an unprefixed class to fix a desktop layout. That breaks mobile web and the
  iOS app to fix one surface.
- **Don't** restate a radius inside a size variant. Size must not re-decide shape.
- **Don't** use Fraunces outside marketing headlines or Sora outside the wordmark.
- **Don't** use em dashes in user-facing copy.
- **Don't** design a student-facing price, paywall, subscription, or upsell. Monetization does not
  touch the student.
