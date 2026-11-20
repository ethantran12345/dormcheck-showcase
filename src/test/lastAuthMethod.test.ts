import { afterEach, describe, expect, it } from 'vitest';
import { PITT, type AuthMethod } from '@/config/universities';
import {
  getLastAuthMethod,
  setLastAuthMethod,
  clearLastAuthMethod,
  toAuthMethod,
  lastMethodLabel,
  isOAuthMethod,
  type LastAuthMethod,
} from '@/lib/lastAuthMethod';

afterEach(() => {
  clearLastAuthMethod();
});

describe('lastAuthMethod storage', () => {
  it('round-trips a stored method', () => {
    setLastAuthMethod('google');
    expect(getLastAuthMethod()).toBe('google');
    setLastAuthMethod('password');
    expect(getLastAuthMethod()).toBe('password');
  });

  it('returns null when nothing is stored', () => {
    expect(getLastAuthMethod()).toBeNull();
  });

  it('clears the stored method', () => {
    setLastAuthMethod('microsoft');
    clearLastAuthMethod();
    expect(getLastAuthMethod()).toBeNull();
  });

  it('ignores a garbage/legacy value in storage', () => {
    localStorage.setItem('dc_last_auth_method', 'azure'); // Supabase vocab, not ours
    expect(getLastAuthMethod()).toBeNull();
  });
});

describe('mapping helpers', () => {
  it('maps to the per-school authMethods vocabulary', () => {
    expect(toAuthMethod('google')).toBe('google');
    expect(toAuthMethod('microsoft')).toBe('microsoft');
    expect(toAuthMethod('password')).toBe('email');
  });

  it('labels each method without em dashes', () => {
    const labels = ['google', 'microsoft', 'password'].map((m) =>
      lastMethodLabel(m as LastAuthMethod),
    );
    expect(labels).toEqual(['Google', 'Microsoft', 'email & password']);
    labels.forEach((l) => expect(l).not.toContain('—'));
  });

  it('flags OAuth providers (the silent-fail case)', () => {
    expect(isOAuthMethod('google')).toBe(true);
    expect(isOAuthMethod('microsoft')).toBe(true);
    expect(isOAuthMethod('password')).toBe(false);
  });
});

describe('school-aware gating (the hint only shows for offered methods)', () => {
  const isOffered = (m: LastAuthMethod, methods: AuthMethod[]) =>
    methods.includes(toAuthMethod(m));

  it('gates against the school authMethods array', () => {
    // Pitt = ['google', 'email']: Microsoft is not offered today.
    expect(isOffered('google', PITT.authMethods)).toBe(true);
    expect(isOffered('password', PITT.authMethods)).toBe(true);
    expect(isOffered('microsoft', PITT.authMethods)).toBe(false);
  });

  it('offers Microsoft for a Microsoft-enabled school', () => {
    const methods: AuthMethod[] = ['microsoft', 'email'];
    expect(isOffered('microsoft', methods)).toBe(true);
    expect(isOffered('google', methods)).toBe(false);
  });
});
