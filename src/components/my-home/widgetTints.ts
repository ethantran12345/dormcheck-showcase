/**
 * Unified accent system for the home dashboard tiles. Every widget shares ONE
 * clean look - a white card, a soft brand-green icon chip, neutral values, and
 * green reserved for progress / emphasis - so the home reads as a single sleek
 * family instead of a rainbow of mismatched tiles. The tint keys are kept so
 * existing callers keep compiling; they all resolve to the same brand styling.
 * Classes are full literals so Tailwind's scanner generates them.
 */
export type WidgetTint = 'green' | 'blue' | 'amber' | 'violet' | 'rose' | 'sky';

export interface WidgetTintStyle {
  /** Rounded icon chip in the card header. */
  chip: string;
  /** Fill for the whole tile (white card - unified with every other widget). */
  softBg: string;
  /** Emphasis color for the headline value / numbers. */
  value: string;
  /** Solid bar for progress / the hover accent hairline. */
  bar: string;
}

const UNIFIED: WidgetTintStyle = {
  chip: 'bg-primary/10 text-primary',
  softBg: 'bg-card',
  value: 'text-foreground',
  bar: 'bg-primary',
};

export const WIDGET_TINT: Record<WidgetTint, WidgetTintStyle> = {
  green: UNIFIED,
  blue: UNIFIED,
  amber: UNIFIED,
  violet: UNIFIED,
  rose: UNIFIED,
  sky: UNIFIED,
};
