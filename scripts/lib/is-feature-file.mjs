/**
 * ONE definition of "is this file a feature surface?", shared by every
 * source-scanning gate: check-colors.mjs, check-glyphs.mjs,
 * check-page-width.mjs, check-primitives.mjs.
 *
 * WHY THESE GATES ARE FEATURE-ONLY. Every one of them polices a RENDERED
 * SURFACE. check-colors asks whether a green surface goes dark-blind;
 * check-glyphs whether an icon diverges from the cascade; check-page-width
 * whether a page hand-rolls its container; check-primitives whether a control
 * bypasses the primitive that owns its behaviour. All four questions are only
 * meaningful about code that renders. check-primitives' own header has said
 * "Feature code only" since it was written, and its isPrimitive() already
 * exempts src/components/ui/ on exactly this reasoning — the primitives are
 * where the raw element legitimately lives.
 *
 * WHY TEST FILES ARE NOT FEATURE SURFACES. A test fixture is an INPUT to an
 * assertion, not a surface a user sees. Two live examples, both of which turned
 * a blocking gate red without a real defect underneath:
 *
 *   1. src/test/stripComments.test.ts feeds the string 'bg-malachite-800' to
 *      the comment stripper to prove the stripper handles it. check-colors
 *      RULE 3 counted that string literal as a new dark-blind green surface.
 *      Nothing renders. The scanner was misreading its own subject.
 *
 *   2. src/test/formCraft.test.tsx renders <button type="submit">Go</button>
 *      because the thing under test — fieldErrorProps merging aria-describedby
 *      — must be proven to work on an ARBITRARY element. check-primitives
 *      RULE A counted it as a control bypassing <Button>. Swapping it for
 *      <Button> would weaken exactly what the test proves.
 *
 * In both cases the correct fix is to the rule's DEFINITION, not to a count.
 * Raising a baseline number would bless the violation and leave the next test
 * fixture to trip the same wire; excluding non-surfaces states what the gate
 * was always asking. No baseline is loosened by this file.
 *
 * WHAT IS DELIBERATELY ABSENT. e2e/ is not listed. Every caller globs
 * `src/*.ts{,x}` / `src/**\/*.ts{,x}` (check-colors adds .css), so e2e/ is
 * already outside the scanned set and an exclusion for it would be dead code —
 * a rule that appears to be doing work while matching nothing is how a gate
 * starts lying about its own coverage.
 */

/**
 * Test-only paths. Kept as anchored patterns rather than a loose /test/
 * substring so a feature file that merely has "test" in its name (a
 * TestimonialCard, an ab-test surface) is still scanned.
 */
const TEST_ONLY = [
  /^src\/test\//,
  /\.test\.tsx?$/,
  /\.spec\.tsx?$/,
];

/** True when `file` is a feature surface a gate should police. */
export function isFeatureFile(file) {
  return !TEST_ONLY.some((re) => re.test(file));
}

/** Drop test-only paths from a `git ls-files` result. */
export function featureFilesOnly(files) {
  return files.filter(isFeatureFile);
}
