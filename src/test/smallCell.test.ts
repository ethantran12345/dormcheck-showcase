import { describe, expect, it } from 'vitest';
import {
  SMALL_CELL_THRESHOLD,
  displayCount,
  countOrZero,
  displayExactOrSuppressed,
} from '@/lib/smallCell';

describe('small-cell suppression helpers (FERPA, P0.6)', () => {
  it('renders suppressed wire values as "<5" and passes numbers through', () => {
    expect(displayCount(null)).toBe(`<${SMALL_CELL_THRESHOLD}`);
    expect(displayCount(0)).toBe('0');
    expect(displayCount(42)).toBe('42');
  });

  it('countOrZero treats suppressed cells as 0 for layout math', () => {
    expect(countOrZero(null)).toBe(0);
    expect(countOrZero(7)).toBe(7);
  });

  it('displayExactOrSuppressed coarsens 1..4 only for university-facing viewers', () => {
    for (let n = 1; n < SMALL_CELL_THRESHOLD; n++) {
      expect(displayExactOrSuppressed(n, true)).toBe(`<${SMALL_CELL_THRESHOLD}`);
      expect(displayExactOrSuppressed(n, false)).toBe(String(n));
    }
    // Zero is not disclosive; at/above threshold is exact for everyone.
    expect(displayExactOrSuppressed(0, true)).toBe('0');
    expect(displayExactOrSuppressed(SMALL_CELL_THRESHOLD, true)).toBe(String(SMALL_CELL_THRESHOLD));
  });
});
