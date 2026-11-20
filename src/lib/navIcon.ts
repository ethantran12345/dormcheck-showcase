/**
 * Active-tab icon treatment: outline-only, weighted by stroke.
 *
 * Active nav glyphs stay pure outlines - no fill - and read as active through
 * color (brand green at the render site) plus a slightly heavier stroke.
 * This intentionally reverses the earlier translucent-fill treatment: the
 * filled swap made active icons read as solid green shapes, and the cleaner
 * SpotHero-style outline look won out.
 *
 * Uniform across every lucide glyph, and spread onto the `<Icon>` at each nav
 * render site (mobile `BottomNav` and the desktop sidebar / sub-tabs / rail)
 * so both surfaces get the same treatment. Color is handled separately at the
 * render sites (`text-malachite-600` active vs `text-muted-foreground`).
 */
export function activeIconProps(active: boolean) {
  return active
    ? { fill: 'none' as const, strokeWidth: 2 }
    : { fill: 'none' as const, strokeWidth: 1.75 };
}
