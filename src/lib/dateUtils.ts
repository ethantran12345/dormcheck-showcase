import { differenceInCalendarDays } from 'date-fns';

export const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a `YYYY-MM-DD` Postgres date string as a LOCAL-midnight `Date` so that
 * countdowns and display strings don't drift by a day across timezones.
 *
 * Returns `null` for empty input, malformed input, or invalid dates.
 */
export function parseIsoDateLocal(s: string | null | undefined): Date | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!ISO_DATE_REGEX.test(trimmed)) return null;
  const [y, m, d] = trimmed.split('-').map(Number);
  const local = new Date(y, m - 1, d);
  return Number.isNaN(local.getTime()) ? null : local;
}

/**
 * Human-friendly countdown to (or from) a target date.
 * `Today!`, `Tomorrow`, `N days to go`, `1 day ago`, `N days ago`.
 */
export function countdownLabel(date: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = differenceInCalendarDays(date, today);
  if (days === 0) return 'Today!';
  if (days === 1) return 'Tomorrow';
  if (days > 1) return `${days} days to go`;
  if (days === -1) return '1 day ago';
  return `${Math.abs(days)} days ago`;
}
