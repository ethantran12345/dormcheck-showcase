import { describe, expect, it } from 'vitest';
import { shouldWarmLazyRoutes } from '@/lib/idlePreload';

describe('shouldWarmLazyRoutes', () => {
  it('warms routes when the browser exposes no connection hints', () => {
    expect(shouldWarmLazyRoutes()).toBe(true);
  });

  it('honors data saver', () => {
    expect(shouldWarmLazyRoutes({ saveData: true, effectiveType: '4g' })).toBe(false);
  });

  it.each(['slow-2g', '2g'])('does not compete with a %s connection', (effectiveType) => {
    expect(shouldWarmLazyRoutes({ effectiveType })).toBe(false);
  });

  it.each(['3g', '4g'])('keeps navigation warm on %s', (effectiveType) => {
    expect(shouldWarmLazyRoutes({ effectiveType })).toBe(true);
  });
});
