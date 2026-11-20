import { describe, expect, it } from 'vitest';
import { buildSignupEmailRedirectTo, parseSafeRedirectParam } from '@/lib/authRedirects';

// buildSignupEmailRedirectTo carries the post-confirmation destination INSIDE
// the confirmation URL so it survives the email round-trip (a new user confirms
// in a fresh browser context with no sessionStorage). AuthCallback reads the
// `redirect` query param back out and sanitizes it again.
describe('buildSignupEmailRedirectTo', () => {
  it('appends a sanitized redirect as a query param', () => {
    const url = buildSignupEmailRedirectTo('/rankings/invite/abc123');
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/auth/v1/callback');
    expect(parsed.searchParams.get('redirect')).toBe('/rankings/invite/abc123');
  });

  it('omits the query param when there is no redirect', () => {
    const url = buildSignupEmailRedirectTo(null);
    expect(url.endsWith('/auth/v1/callback')).toBe(true);
    expect(url).not.toContain('redirect=');
  });

  it('drops an unsafe (open-redirect) destination', () => {
    const url = buildSignupEmailRedirectTo('https://evil.com/phish');
    expect(url.endsWith('/auth/v1/callback')).toBe(true);
    expect(url).not.toContain('redirect=');
  });

  // End-to-end: Supabase appends its own auth tokens to emailRedirectTo, then
  // AuthCallback must still recover the invite path from window.location.search.
  it('round-trips a safe path even when Supabase appends its own tokens', () => {
    const url = buildSignupEmailRedirectTo('/roommates/invite/xyz');
    const withTokens = `${url}&code=pkce_abc#access_token=fake`;
    const search = new URL(withTokens).search;
    const recovered = parseSafeRedirectParam(new URLSearchParams(search).get('redirect'));
    expect(recovered).toBe('/roommates/invite/xyz');
  });
});
