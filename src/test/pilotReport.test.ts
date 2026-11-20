import { describe, expect, it } from 'vitest';
import {
  buildReportCsv,
  funnelNarrative,
  signupsNarrative,
  dormsNarrative,
} from '@/pages/admin/PilotReportPage';
import type { AdminMetricsResponse } from '@/lib/adminMetrics';

const base = {
  metrics: { totalUsers: 120, activeLast7Days: null, activeListings: 14 },
  deltas: {} as AdminMetricsResponse['deltas'],
  funnel: { signedUp: 120, activated: 60, activeThisWeek: 30, returning: null },
  dorms: [
    { dorm: 'Tower B', users: 40, actionsThisWeek: 12 },
    { dorm: 'Holland Hall', users: null, actionsThisWeek: null },
    { dorm: 'No dorm set', users: 80, actionsThisWeek: 5 },
  ],
  signupsByWeek: [
    { weekStart: '2026-06-29', count: 10 },
    { weekStart: '2026-07-06', count: 12 },
  ],
  needsAttention: { openReports: 2, stuckUsers: { count: null, sample: [] } },
  recentSignups: [],
  suppression: { threshold: 5, applied: true },
} as unknown as AdminMetricsResponse;

describe('term report CSV + narratives (P1.8c)', () => {
  it('exports suppressed cells as "<5", never a raw value', () => {
    const csv = buildReportCsv(base, 'University of Pittsburgh');
    expect(csv).toContain('active_last_7_days,<5');
    expect(csv).toContain('students_signed_up,120');
    expect(csv).toContain('activity_by_hall,Holland Hall,<5');
    expect(csv).not.toContain('No dorm set');
    expect(csv.startsWith('# DormCheck scorecard')).toBe(true);
  });

  it('narratives speak only over real numbers', () => {
    expect(funnelNarrative(base.funnel)).toBe(
      '50% of signed-up students have taken a core action in the app.',
    );
    expect(signupsNarrative(base.signupsByWeek)).toBe(
      'Weekly signups grew 20% versus the prior week.',
    );
    expect(dormsNarrative(base.dorms)).toBe('Adoption is led by Tower B.');
  });

  it('narratives go silent when inputs are suppressed', () => {
    expect(funnelNarrative({ ...base.funnel, activated: null })).toBeNull();
    expect(
      signupsNarrative([
        { weekStart: 'a', count: null },
        { weekStart: 'b', count: 9 },
      ]),
    ).toBeNull();
    expect(dormsNarrative([{ dorm: 'Tower B', users: null }])).toBeNull();
  });
});
