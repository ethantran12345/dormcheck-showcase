import { describe, expect, it } from 'vitest';
import { getRouteEntrance, getRouteTransition, routeOwnsViewport } from '@/components/motion/PageTransition';
import { NATIVE_ROUTE_SETTLE_SPRING, PREMIUM_EASE, ROUTE_ENTRANCE_SECONDS } from '@/lib/motion';

describe('route entrance motion', () => {
  it('settles ordinary pages from a small, bounded offset and blur', () => {
    expect(getRouteEntrance('/marketplace', false)).toEqual({
      opacity: 0.72,
      y: 6,
      filter: 'blur(2px)',
    });
  });

  it('keeps the fixed messages viewport spatially anchored', () => {
    expect(getRouteEntrance('/messages/thread-1', false)).toMatchObject({
      y: 0,
      filter: 'blur(0px)',
    });
  });

  it('removes travel and blur when reduced motion is requested', () => {
    expect(getRouteEntrance('/marketplace', true)).toMatchObject({
      y: 0,
      filter: 'blur(0px)',
    });
  });

  it('uses a damped spring only for native route content', () => {
    expect(getRouteTransition(false, true)).toEqual(NATIVE_ROUTE_SETTLE_SPRING);
    expect(getRouteTransition(false, false)).toEqual({
      duration: ROUTE_ENTRANCE_SECONDS,
      ease: PREMIUM_EASE,
    });
  });

  it('keeps the reduced-motion route change as a short fade', () => {
    expect(getRouteTransition(true, true)).toEqual({
      duration: ROUTE_ENTRANCE_SECONDS,
      ease: PREMIUM_EASE,
    });
  });

  it('keeps onboarding outside the transformed route wrapper', () => {
    expect(routeOwnsViewport('/onboarding/intro')).toBe(true);
    expect(routeOwnsViewport('/marketplace')).toBe(false);
  });
});
