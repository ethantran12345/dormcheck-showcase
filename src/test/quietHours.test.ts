import { describe, it, expect } from 'vitest';
import {
  parseHhMm,
  localMinutesInZone,
  isWithinQuietHours,
} from '../../supabase/functions/_shared/quietHours';

// Fixed UTC instants (Date.UTC is deterministic; Jan is standard time, no DST ambiguity).
const AT = (y: number, mo: number, d: number, h: number, mi: number) =>
  Date.UTC(y, mo - 1, d, h, mi, 0);

describe('parseHhMm', () => {
  it('parses valid HH:MM to minutes since midnight', () => {
    expect(parseHhMm('00:00')).toBe(0);
    expect(parseHhMm('08:00')).toBe(480);
    expect(parseHhMm('22:30')).toBe(1350);
    expect(parseHhMm('23:59')).toBe(1439);
  });
  it('returns null for malformed values', () => {
    for (const bad of ['9:00', '25:00', '22:60', '', 'abc', '2200', '12', null, undefined]) {
      expect(parseHhMm(bad as string)).toBeNull();
    }
  });
});

describe('localMinutesInZone', () => {
  it('computes local minutes for the same instant across zones', () => {
    const instant = AT(2026, 1, 15, 21, 30); // 21:30 UTC
    expect(localMinutesInZone(instant, 'UTC')).toBe(21 * 60 + 30);
    // EST = UTC-5 in January -> 16:30 local
    expect(localMinutesInZone(instant, 'America/New_York')).toBe(16 * 60 + 30);
  });
  it('returns null for an invalid timezone', () => {
    expect(localMinutesInZone(AT(2026, 1, 15, 12, 0), 'Not/AZone')).toBeNull();
  });
  it('falls back to UTC when timezone is blank/null', () => {
    const instant = AT(2026, 1, 15, 6, 15);
    expect(localMinutesInZone(instant, null)).toBe(6 * 60 + 15);
    expect(localMinutesInZone(instant, '')).toBe(6 * 60 + 15);
  });
});

describe('isWithinQuietHours - same-day window (09:00-17:00)', () => {
  const cfg = { enabled: true, start: '09:00', end: '17:00', timezone: 'UTC' };
  it('suppresses inside the window', () => {
    expect(isWithinQuietHours(cfg, AT(2026, 1, 15, 12, 0))).toBe(true);
  });
  it('is half-open: suppresses at start, sends at end', () => {
    expect(isWithinQuietHours(cfg, AT(2026, 1, 15, 9, 0))).toBe(true); // >= start
    expect(isWithinQuietHours(cfg, AT(2026, 1, 15, 17, 0))).toBe(false); // < end is false
  });
  it('sends outside the window', () => {
    expect(isWithinQuietHours(cfg, AT(2026, 1, 15, 8, 59))).toBe(false);
    expect(isWithinQuietHours(cfg, AT(2026, 1, 15, 20, 0))).toBe(false);
  });
});

describe('isWithinQuietHours - midnight-wrap window (22:00-08:00)', () => {
  const cfg = { enabled: true, start: '22:00', end: '08:00', timezone: 'UTC' };
  it('suppresses late at night (>= start)', () => {
    expect(isWithinQuietHours(cfg, AT(2026, 1, 15, 23, 0))).toBe(true);
    expect(isWithinQuietHours(cfg, AT(2026, 1, 15, 22, 0))).toBe(true); // at start
  });
  it('suppresses in the early morning (< end)', () => {
    expect(isWithinQuietHours(cfg, AT(2026, 1, 15, 3, 0))).toBe(true);
    expect(isWithinQuietHours(cfg, AT(2026, 1, 15, 7, 59))).toBe(true);
  });
  it('sends during the day and at the boundary', () => {
    expect(isWithinQuietHours(cfg, AT(2026, 1, 15, 8, 0))).toBe(false); // at end -> resumes
    expect(isWithinQuietHours(cfg, AT(2026, 1, 15, 12, 0))).toBe(false);
    expect(isWithinQuietHours(cfg, AT(2026, 1, 15, 21, 59))).toBe(false); // just before start
  });
});

describe('isWithinQuietHours - timezone awareness', () => {
  // Same instant + same window, but the answer flips on timezone.
  const cfg = (timezone: string) => ({ enabled: true, start: '09:00', end: '17:00', timezone });
  const instant = AT(2026, 1, 15, 21, 30); // 21:30 UTC == 16:30 EST
  it('sends in UTC (21:30, outside) but suppresses in New York (16:30, inside)', () => {
    expect(isWithinQuietHours(cfg('UTC'), instant)).toBe(false);
    expect(isWithinQuietHours(cfg('America/New_York'), instant)).toBe(true);
  });
});

describe('isWithinQuietHours - fails open', () => {
  const now = AT(2026, 1, 15, 3, 0); // inside a 22-08 window if it applied
  it('when disabled', () => {
    expect(isWithinQuietHours({ enabled: false, start: '22:00', end: '08:00', timezone: 'UTC' }, now)).toBe(false);
    expect(isWithinQuietHours(null, now)).toBe(false);
    expect(isWithinQuietHours(undefined, now)).toBe(false);
  });
  it('on malformed start/end', () => {
    expect(isWithinQuietHours({ enabled: true, start: 'bad', end: '08:00', timezone: 'UTC' }, now)).toBe(false);
    expect(isWithinQuietHours({ enabled: true, start: '22:00', end: null, timezone: 'UTC' }, now)).toBe(false);
  });
  it('on a zero-width window (start === end)', () => {
    expect(isWithinQuietHours({ enabled: true, start: '00:00', end: '00:00', timezone: 'UTC' }, now)).toBe(false);
  });
  it('on an invalid timezone', () => {
    expect(isWithinQuietHours({ enabled: true, start: '22:00', end: '08:00', timezone: 'Not/AZone' }, now)).toBe(false);
  });
});
