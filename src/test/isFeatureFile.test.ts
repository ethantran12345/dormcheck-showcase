import { describe, expect, it } from 'vitest';
// The gates' shared scope predicate — plain .mjs, imported directly so the test
// exercises the exact code CI runs.
import { isFeatureFile, featureFilesOnly } from '../../scripts/lib/is-feature-file.mjs';

/**
 * The scope predicate behind FOUR blocking gates (lint:colors, lint:glyphs,
 * lint:primitives, lint:widths).
 *
 * The risk this test exists to catch is ASYMMETRIC. An exclusion that is too
 * NARROW is loud — a gate goes red on a test fixture and someone investigates.
 * An exclusion that is too BROAD is silent: the gate keeps reporting green
 * while scanning less and less, which is the exact failure mode this repo has
 * now hit five times. So the "still scanned" half below matters more than the
 * "excluded" half, and both halves are asserted explicitly.
 */

describe('isFeatureFile', () => {
  it('excludes test-only paths', () => {
    for (const f of [
      'src/test/stripComments.test.ts',
      'src/test/formCraft.test.tsx',
      'src/test/setup.ts',
      'src/components/checklist/ChecklistExploreTab.test.tsx',
      'src/hooks/useFoo.spec.ts',
      'src/pages/app/RoommatePage.spec.tsx',
    ]) {
      expect(isFeatureFile(f), f).toBe(false);
    }
  });

  it('still scans every feature surface', () => {
    for (const f of [
      'src/components/ComingSoon.tsx',
      'src/components/ui/button.tsx',
      'src/pages/app/RoommatePage.tsx',
      'src/index.css',
      'src/lib/utils.ts',
    ]) {
      expect(isFeatureFile(f), f).toBe(true);
    }
  });

  /**
   * A loose /test/ or /spec/ substring would swallow real surfaces. These names
   * are the ones that would go quietly unscanned if the patterns stopped being
   * anchored.
   */
  it('does not swallow feature files whose names merely contain test/spec', () => {
    for (const f of [
      'src/components/marketing/TestimonialCard.tsx',
      'src/components/admin/AbTestPanel.tsx',
      'src/components/dorm-portal/SpecSheet.tsx',
      'src/pages/app/ProtestPage.tsx',
    ]) {
      expect(isFeatureFile(f), f).toBe(true);
    }
  });

  it('featureFilesOnly filters a git ls-files list in place', () => {
    expect(
      featureFilesOnly([
        'src/components/ComingSoon.tsx',
        'src/test/formCraft.test.tsx',
        'src/pages/app/RoommatePage.tsx',
      ])
    ).toEqual(['src/components/ComingSoon.tsx', 'src/pages/app/RoommatePage.tsx']);
  });
});
