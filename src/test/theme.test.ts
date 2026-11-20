import { describe, expect, it } from 'vitest';
import { isAlwaysLightPath, resolveEffectiveTheme } from '@/lib/theme';

/**
 * Pins the single theme resolver. The FOUC script in public/theme-init.js
 * hardcodes the same rules (it can't import) — if these cases change, update
 * the script in lockstep.
 */
describe('resolveEffectiveTheme', () => {
  it('forces light on pre-auth and always-light surfaces regardless of preference', () => {
    const paths = [
      '/',
      '/features',
      '/about',
      '/contact',
      '/waitlist',
      '/privacy',
      '/terms',
      '/auth',
      '/auth/v1/callback',
      '/select-school',
      '/onboarding/intro',
      '/admin',
      '/admin/dashboard',
    ];
    for (const p of paths) {
      expect(isAlwaysLightPath(p), p).toBe(true);
      expect(resolveEffectiveTheme(p, 'dark', 'dark'), p).toBe('light');
      expect(resolveEffectiveTheme(p, 'system', 'dark'), p).toBe('light');
    }
  });

  it('respects the explicit preference on app routes', () => {
    for (const p of ['/my-home', '/housing', '/marketplace', '/settings', '/profile', '/messages']) {
      expect(isAlwaysLightPath(p), p).toBe(false);
      expect(resolveEffectiveTheme(p, 'dark', 'light'), p).toBe('dark');
      expect(resolveEffectiveTheme(p, 'light', 'dark'), p).toBe('light');
    }
  });

  it('forces light for a signed-out visitor on any route (dark mode is signed-in only)', () => {
    for (const p of ['/marketplace', '/this-route-does-not-exist', '/my-home']) {
      expect(resolveEffectiveTheme(p, 'dark', 'dark', true), p).toBe('light');
      expect(resolveEffectiveTheme(p, 'system', 'dark', true), p).toBe('light');
      expect(resolveEffectiveTheme(p, 'dark', 'dark', false), p).toBe('dark');
    }
  });

  it("resolves 'system' from the OS theme on app routes", () => {
    expect(resolveEffectiveTheme('/my-home', 'system', 'dark')).toBe('dark');
    expect(resolveEffectiveTheme('/my-home', 'system', 'light')).toBe('light');
  });
});
