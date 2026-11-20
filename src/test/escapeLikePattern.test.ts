import { describe, it, expect } from 'vitest';
import { escapeLikePattern } from '@/lib/sanitize';

/**
 * Guard for design-audit A-10. The My Home dorm band moved from scanning the
 * newest 50 listings client-side to a server-side `.ilike('%needle%')`, which
 * means the needle is now part of a LIKE pattern and its metacharacters matter.
 * A broken escape does not throw — it silently returns plausible-looking rows —
 * so it needs an explicit test rather than eyeballing the band.
 */
describe('escapeLikePattern', () => {
  it('leaves an ordinary dorm name untouched', () => {
    expect(escapeLikePattern('Sutherland East')).toBe('Sutherland East');
  });

  it('escapes _, which would otherwise match any single character', () => {
    expect(escapeLikePattern('Sutherland_East')).toBe('Sutherland\\_East');
  });

  it('escapes %, which would otherwise match any run of characters', () => {
    expect(escapeLikePattern('100% Full')).toBe('100\\% Full');
  });

  it('escapes the backslash first, so escaping cannot re-introduce a live one', () => {
    // Naively replacing % before \ would turn "\%" into "\\%" -> an escaped
    // backslash followed by a LIVE wildcard.
    expect(escapeLikePattern('a\\%b')).toBe('a\\\\\\%b');
  });

  it('handles a needle that is only metacharacters', () => {
    expect(escapeLikePattern('%_%')).toBe('\\%\\_\\%');
  });

  it('is a no-op on the empty string', () => {
    expect(escapeLikePattern('')).toBe('');
  });
});
