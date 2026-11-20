import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { FunnelChart, type FunnelStep } from '@/components/admin/FunnelChart';
import { ReturningRateGauge } from '@/components/admin/ReturningRateGauge';
import { SignupsAreaChart } from '@/components/admin/SignupsAreaChart';
import { TopHallsBars } from '@/components/admin/TopHallsBars';

/**
 * Privacy is the load-bearing invariant for the admin dashboard visuals: a
 * small-cell-suppressed count (null) must render as "<5"/"—" and contribute 0
 * geometry — never a number, and never a pixel-encoded value. These tests pin
 * that surface deterministically (text + drawn/undrawn elements), independent
 * of animation timing.
 */

const STEPS: FunnelStep[] = [
  { key: 'signedUp', label: 'Signed up', helper: 'Everyone' },
  { key: 'activated', label: 'Activated', helper: 'Did one thing' },
  { key: 'activeThisWeek', label: 'Active this week', helper: 'Last 7 days' },
  { key: 'returning', label: 'Returning', helper: 'Came back' },
];

afterEach(cleanup);

describe('FunnelChart', () => {
  it('renders a suppressed step as "<5" with a suppressed percentage, never a number', () => {
    render(
      <TooltipProvider>
        <FunnelChart
          funnel={{ signedUp: 70, activated: null, activeThisWeek: 12, returning: null }}
          steps={STEPS}
        />
      </TooltipProvider>,
    );
    // Suppressed cells surface as "<5" (two of them: activated + returning).
    expect(screen.getAllByText('<5').length).toBe(2);
    // The base count is not suppressed and renders as a real number.
    expect(screen.getByText('70')).toBeTruthy();
    // A suppressed step's percentage is the dashed placeholder, not a computed %.
    expect(screen.getAllByText('-').length).toBeGreaterThan(0);
  });
});

describe('ReturningRateGauge', () => {
  it('draws no value arc and shows "—" when either side is suppressed', () => {
    const { container } = render(<ReturningRateGauge returning={null} signedUp={70} />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('Not enough data yet')).toBeTruthy();
    // No brand-colored value arc is ever drawn from a suppressed input.
    expect(container.querySelector('.stroke-malachite-600')).toBeNull();
    // The track (slate) is still there.
    expect(container.querySelector('.stroke-stone-200')).not.toBeNull();
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('not enough data');
  });

  it('computes the percentage and draws the arc for real data', () => {
    const { container } = render(<ReturningRateGauge returning={34} signedUp={68} />);
    // 34 / 68 = 50%. CountUpNumber exposes the final value to assistive tech.
    expect(screen.getByText('50')).toBeTruthy();
    expect(container.querySelector('.stroke-malachite-600')).not.toBeNull();
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('50%');
  });
});

describe('SignupsAreaChart', () => {
  it('treats a suppressed week as 0 in the total but labels it "<5"', () => {
    render(
      <SignupsAreaChart
        series={[
          { weekStart: '2026-06-01', count: 10 },
          { weekStart: '2026-06-08', count: null },
          { weekStart: '2026-06-15', count: 20 },
        ]}
      />,
    );
    // Total = 10 + 0 (suppressed) + 20 = 30, exposed via the count-up's sr value.
    expect(screen.getByText('30')).toBeTruthy();
    // The suppressed point's tooltip label reads "<5", not a number.
    const img = screen.getByRole('img');
    expect(within(img).getByText(/Week of .*: <5 signups/)).toBeTruthy();
  });
});

describe('TopHallsBars', () => {
  it('renders a suppressed hall count as "<5"', () => {
    render(
      <TopHallsBars
        dorms={[
          { dorm: 'North Hall', users: 40, actionsThisWeek: 30 },
          { dorm: 'East Hall', users: 3, actionsThisWeek: null },
        ]}
      />,
    );
    expect(screen.getByText('North Hall')).toBeTruthy();
    expect(screen.getByText('East Hall')).toBeTruthy();
    expect(screen.getByText('30')).toBeTruthy();
    expect(screen.getByText('<5')).toBeTruthy();
  });
});
