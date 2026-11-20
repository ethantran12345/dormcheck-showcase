import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RouteSkeleton } from '@/components/skeletons/RouteSkeleton';

/**
 * The skeleton's only logic is picking a shape from the path, and the failure
 * mode is silent: a wrong branch still renders *something*, so nothing breaks —
 * the page just flashes the wrong layout and the jump-on-load it exists to
 * prevent comes back. These assertions pin the shape, not the styling.
 */
const shapeOf = (pathname: string) => {
  const { container } = render(<RouteSkeleton pathname={pathname} />);
  // Skeleton blocks carry `animate-skeleton` (identity pass 2026-10-11), not the stock pulse.
  const pulses = container.querySelectorAll('.animate-skeleton');
  return {
    count: pulses.length,
    // The canvas shape is the only one that fills its box edge-to-edge.
    hasFullBleed: !!container.querySelector('.absolute.inset-0'),
    hasGrid: !!container.querySelector('.grid'),
    hasFullViewport: !!container.querySelector('.h-\\[100dvh\\]'),
  };
};

describe('RouteSkeleton', () => {
  it('renders the full-bleed canvas shape for map-like routes', () => {
    expect(shapeOf('/map').hasFullBleed).toBe(true);
    expect(shapeOf('/campus').hasFullBleed).toBe(true);
    // Nested paths take the same shape as their parent — no entry per route.
    expect(shapeOf('/campus/litchfield-tower-a').hasFullBleed).toBe(true);
  });

  it('holds a full viewport for onboarding instead of painting a short page-flow panel', () => {
    const onboarding = shapeOf('/onboarding/intro');
    expect(onboarding.hasFullViewport).toBe(true);
    expect(onboarding.count).toBe(0);
  });

  it('renders the grid feed shape for browse-a-grid routes', () => {
    expect(shapeOf('/marketplace').hasGrid).toBe(true);
    expect(shapeOf('/roommates').hasGrid).toBe(true);
  });

  it('renders a row list for conversation routes, not a grid', () => {
    const messages = shapeOf('/messages');
    expect(messages.hasGrid).toBe(false);
    expect(messages.hasFullBleed).toBe(false);
    expect(shapeOf('/messages/abc-123').hasGrid).toBe(false);
  });

  it('falls back to the stacked-panel shape for anything unrecognised', () => {
    const fallback = shapeOf('/some/unmapped/route');
    expect(fallback.hasGrid).toBe(false);
    expect(fallback.hasFullBleed).toBe(false);
    expect(fallback.count).toBeGreaterThan(0);
  });
});
