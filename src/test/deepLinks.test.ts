import { describe, expect, it } from 'vitest';
import { universalLinkToPath } from '@/lib/deepLinks';

// universalLinkToPath turns an incoming Universal Link / App Link into the safe
// in-app path DeepLinkGate navigates to (or stashes as auth_redirect). It must
// accept our hosts, preserve the query (?conversation=…), and reject anything
// that isn't a same-origin dormcheck.com https link.
describe('universalLinkToPath', () => {
  it('accepts an apex invite link', () => {
    expect(universalLinkToPath('https://dormcheck.com/rankings/invite/abc123')).toBe(
      '/rankings/invite/abc123',
    );
  });

  it('accepts the www host', () => {
    expect(universalLinkToPath('https://www.dormcheck.com/roommates/invite/xyz')).toBe(
      '/roommates/invite/xyz',
    );
  });

  it('preserves the conversation query param', () => {
    expect(universalLinkToPath('https://dormcheck.com/messages?conversation=c-1')).toBe(
      '/messages?conversation=c-1',
    );
  });

  it('rejects a foreign host', () => {
    expect(universalLinkToPath('https://evil.com/rankings/invite/abc')).toBeNull();
  });

  it('rejects a lookalike host', () => {
    expect(universalLinkToPath('https://dormcheck.com.evil.com/messages')).toBeNull();
  });

  it('rejects non-https schemes', () => {
    expect(universalLinkToPath('http://dormcheck.com/messages')).toBeNull();
    expect(universalLinkToPath('com.dormcheck.ios://auth-callback?code=x')).toBeNull();
  });

  it('returns null for unparseable input', () => {
    expect(universalLinkToPath('not a url')).toBeNull();
  });
});
