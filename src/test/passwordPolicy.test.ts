import { describe, it, expect } from 'vitest';
import {
  evaluatePassword,
  isPasswordValid,
  mapPasswordPolicyServerError,
  PASSWORD_POLICY_MESSAGE,
  PASSWORD_MIN_LENGTH,
} from '@/lib/passwordPolicy';

const met = (pw: string, id: string) =>
  evaluatePassword(pw).find((r) => r.id === id)?.met ?? false;

describe('evaluatePassword', () => {
  it('returns all five rules in display order', () => {
    const ids = evaluatePassword('').map((r) => r.id);
    expect(ids).toEqual(['length', 'lowercase', 'uppercase', 'number', 'symbol']);
  });

  it('marks every rule unmet for an empty password', () => {
    expect(evaluatePassword('').every((r) => !r.met)).toBe(true);
  });

  it('toggles the length rule at the minimum', () => {
    expect(met('a'.repeat(PASSWORD_MIN_LENGTH - 1), 'length')).toBe(false);
    expect(met('a'.repeat(PASSWORD_MIN_LENGTH), 'length')).toBe(true);
  });

  it('detects each character class independently', () => {
    expect(met('abcdef', 'lowercase')).toBe(true);
    expect(met('ABCDEF', 'lowercase')).toBe(false);
    expect(met('ABCDEF', 'uppercase')).toBe(true);
    expect(met('abcdef', 'number')).toBe(false);
    expect(met('abcde1', 'number')).toBe(true);
    expect(met('abcde1', 'symbol')).toBe(false);
    expect(met('abcde@', 'symbol')).toBe(true);
  });
});

describe('isPasswordValid', () => {
  it('accepts a password that meets the full policy', () => {
    expect(isPasswordValid('Ehrahtaen102@')).toBe(true);
    expect(isPasswordValid('Abc123!')).toBe(true);
  });

  it('rejects a password missing exactly one class', () => {
    expect(isPasswordValid('abc123!')).toBe(false); // no uppercase
    expect(isPasswordValid('ABC123!')).toBe(false); // no lowercase
    expect(isPasswordValid('Abcdef!')).toBe(false); // no number
    expect(isPasswordValid('Abcde12')).toBe(false); // no symbol
    expect(isPasswordValid('Ab1!')).toBe(false); // too short
  });
});

describe('mapPasswordPolicyServerError', () => {
  it('maps a GoTrue weak_password code to friendly copy', () => {
    expect(mapPasswordPolicyServerError({ code: 'weak_password', message: 'x' })).toBe(
      PASSWORD_POLICY_MESSAGE,
    );
  });

  it('maps the raw character-class dump to friendly copy', () => {
    const raw =
      'Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789.';
    expect(mapPasswordPolicyServerError({ message: raw })).toBe(PASSWORD_POLICY_MESSAGE);
  });

  it('returns null for a non-policy (transport) error', () => {
    expect(mapPasswordPolicyServerError({ message: 'Failed to fetch', status: 0 })).toBeNull();
    expect(mapPasswordPolicyServerError(null)).toBeNull();
  });
});
