/**
 * Small-cell suppression for university-facing aggregates.
 *
 * Wire format (admin-metrics edge function): a suppressible count is
 * `number | null` - `null` means the true value is between 1 and
 * SMALL_CELL_THRESHOLD - 1 and was suppressed server-side for a
 * university_admin viewer. Zero is not disclosive and passes through.
 * Superadmins always receive raw numbers.
 */
export const SMALL_CELL_THRESHOLD = 5;

export type SuppressibleCount = number | null;

/** Render a suppressible count: null → "<5", numbers unchanged. */
export function displayCount(value: SuppressibleCount): string {
  return value === null ? `<${SMALL_CELL_THRESHOLD}` : String(value);
}

/** Numeric fallback for math/layout (bar heights, sorts); suppressed cells count as 0. */
export function countOrZero(value: SuppressibleCount): number {
  return value ?? 0;
}

/**
 * Client-side suppression for raw counts that never went through the
 * admin-metrics wire format (e.g. the broadcast recipient preview): when
 * `apply` is true (university-facing viewer), 1..4 renders as "<5".
 */
export function displayExactOrSuppressed(n: number, apply: boolean): string {
  return apply && n > 0 && n < SMALL_CELL_THRESHOLD ? `<${SMALL_CELL_THRESHOLD}` : String(n);
}
