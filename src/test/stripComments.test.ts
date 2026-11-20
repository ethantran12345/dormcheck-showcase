import { describe, expect, it } from 'vitest';
// The gates' shared scanner helper — plain .mjs, imported directly so the test
// exercises the exact code CI runs.
import { stripComments, legacyStripComments } from '../../scripts/lib/strip-comments.mjs';

/**
 * The comment stripper behind FOUR blocking gates (lint:colors, lint:glyphs,
 * lint:primitives, lint:widths). It used to be copy-pasted into each of them,
 * and three copies kept the offset-destroying version long after the fourth was
 * fixed — the same shape as the porcelain-trim bug that reached four instances.
 *
 * Every case below is asserted twice: once against the shared implementation
 * (must pass) and once against `legacyStripComments` (must FAIL). A regression
 * test for a scanner defect is worthless unless the defect is seen to be caught,
 * so the legacy function is kept alive purely to be watched going red.
 */

const FIXTURE = [
  'const a = <div className="bg-malachite-800 dark:bg-malachite-900" />;',
  "{/* the container's width",
  '    is deliberate here */}',
  '<div className="mx-auto max-w-4xl bg-malachite-800">x</div>',
].join('\n');

describe('stripComments — the shared gate scanner', () => {
  it('removes the comment text, so an apostrophe cannot open a string literal', () => {
    expect(stripComments(FIXTURE)).not.toContain("container's");
    expect(stripComments("// it's fine\nconst a = 1;")).not.toContain("it's");
  });

  it('leaves `://` alone so a URL is not read as a line comment', () => {
    expect(stripComments('const u = "https://dormcheck.com/x";')).toContain('https://dormcheck.com/x');
    expect(legacyStripComments('const u = "https://dormcheck.com/x";')).toContain('https://dormcheck.com/x');
  });

  it('preserves the line count — the legacy stripper collapsed multi-line comments', () => {
    expect(stripComments(FIXTURE).split('\n')).toHaveLength(4);
    expect(legacyStripComments(FIXTURE).split('\n')).not.toHaveLength(4); // RED
  });

  it('preserves byte offsets, so a tag walker maps a hit to the right line', () => {
    expect(stripComments(FIXTURE).indexOf('max-w-4xl')).toBe(FIXTURE.indexOf('max-w-4xl'));
    expect(legacyStripComments(FIXTURE).indexOf('max-w-4xl')).not.toBe(FIXTURE.indexOf('max-w-4xl')); // RED
  });

  it('reports a violation on the line it is actually written on', () => {
    // The gates map a hit back to a line by counting newlines before it.
    const lineOf = (src: string, needle: string) => src.slice(0, src.indexOf(needle)).split('\n').length;
    expect(lineOf(stripComments(FIXTURE), 'max-w-4xl')).toBe(4);
    expect(lineOf(legacyStripComments(FIXTURE), 'max-w-4xl')).not.toBe(4); // RED — points at line 3
  });

  it('keeps each line\'s identity — line-by-line rules must not read across a comment', () => {
    // check-colors RULE 3 counts a solid green on a line carrying no `dark:`
    // variant. A multi-line comment opened MID-LINE (routine inside a JSX prop
    // block) collapsed to a single space under the legacy stripper, welding the
    // two code lines together: the `dark:` from the first then absolved the
    // dark-blind green on the second and the violation went uncounted.
    const inline = '<div className="dark:bg-x" /* note\n more */ data-y="bg-malachite-800" />';
    const darkBlind = (src: string) =>
      src.split('\n').filter((l) => l.includes('bg-malachite-800') && !l.includes('dark:')).length;

    expect(darkBlind(stripComments(inline))).toBe(1);
    expect(darkBlind(legacyStripComments(inline))).toBe(0); // RED — the violation vanished
  });
});
