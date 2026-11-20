/**
 * ONE comment stripper, shared by every source-scanning gate:
 * check-colors.mjs, check-glyphs.mjs, check-page-width.mjs, check-primitives.mjs.
 *
 * WHY IT IS SHARED. This function was copy-pasted into four gates. Three of
 * them ran the offset-DESTROYING version below (`legacyStripComments`) long
 * after the fourth was fixed — the same shape as the porcelain-trim bug, which
 * reached four instances because each call site was patched and the helper
 * never was. A scanner defect in a blocking gate is worse than a missing gate:
 * its green is read as "clean". So there is exactly one implementation now, and
 * the broken one survives only inside a test that proves it was broken.
 *
 * WHAT WAS WRONG. The legacy version DELETED comments (`→ ' '`). Deleting is
 * not neutral for a scanner:
 *   1. A multi-line `/* … *\/` collapsed to a single space, so every line after
 *      it in the file was reported at the wrong line number — the gate points a
 *      human at the wrong code. Worse, when such a comment opens MID-LINE
 *      (routine inside a JSX prop block) the code before it and the code after
 *      it weld into ONE line. Any per-line rule — check-colors RULE 1 and
 *      RULE 3 both scan line by line — then reads a `dark:` from one line as
 *      covering a green from another and the violation goes uncounted.
 *   2. It destroyed byte offsets, which the quote- and brace-aware JSX tag
 *      walkers in check-glyphs / check-page-width use to map a hit back to a
 *      line.
 * Blanking instead of deleting keeps every newline, every offset, and every
 * line's identity, while still removing the comment TEXT — which matters
 * because an apostrophe in `// the container's width…` would otherwise open a
 * string literal the tag walker never closes, hiding every tag after it.
 *
 * `//` preceded by `:` is deliberately left alone so `https://` inside a class
 * string or URL is not mistaken for a line comment.
 */

const blank = (m) => m.replace(/[^\n]/g, ' ');

/** Blank out comments, preserving newlines and byte offsets. */
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])(\/\/[^\n]*)/g, (_, pre, c) => pre + blank(c));
}

/**
 * The pre-fix implementation. NOT used by any gate — it exists so
 * src/test/stripComments.test.ts can replay the fixtures against it and watch
 * them go red. Deleting it would make the regression test unfalsifiable.
 */
export function legacyStripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
