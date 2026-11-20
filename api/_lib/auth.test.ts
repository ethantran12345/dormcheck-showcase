/**
 * Unit tests for the server-side auth gate (api/_lib/auth.ts).
 *
 * These assert BEHAVIOR, in both directions (the vault's standing rule: a
 * guard must be proven to fire and to pass):
 *  - the domain allowlist rejects lookalike/suffix attacks and accepts tenants;
 *  - getAuthedUser fails closed on a missing/invalid token, a disallowed
 *    domain, and (when REQUIRE_ADMIN_AAL2=1) an aal1 JWT on an admin surface;
 *  - areUsersBlocked fails CLOSED (treat as blocked) on non-UUID input, since
 *    its ids feed a string-built PostgREST .or() filter.
 *
 * The Supabase client module is mocked; nothing here talks to a database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest } from '@vercel/node';

const mocks = vi.hoisted(() => {
  const getUser = vi.fn();
  const limit = vi.fn();
  const or = vi.fn(() => ({ limit }));
  const select = vi.fn(() => ({ or }));
  const maybeSingle = vi.fn();
  const eq = vi.fn(() => ({ maybeSingle }));
  const profileSelect = vi.fn(() => ({ eq }));
  const from = vi.fn((table: string) =>
    table === 'profiles' ? { select: profileSelect } : { select },
  );
  return { getUser, limit, or, select, from, maybeSingle };
});

vi.mock('./supabase.js', () => ({
  supabase: { auth: { getUser: mocks.getUser }, from: mocks.from },
}));

import { areUsersBlocked, getAuthedUser, getCallerName, isAllowedEmailDomain } from './auth.js';

const req = (authorization?: string) => ({ headers: { authorization } }) as VercelRequest;

/** Unsigned JWT with the given payload — readJwtAal never verifies, it only decodes. */
const jwt = (payload: Record<string, unknown>) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.unstubAllEnvs();
  mocks.getUser.mockReset();
  mocks.limit.mockReset().mockResolvedValue({ data: [] });
  mocks.maybeSingle.mockReset().mockResolvedValue({ data: null });
});

describe('isAllowedEmailDomain', () => {
  it('accepts every active tenant domain, case-insensitively', () => {
    expect(isAllowedEmailDomain('student@pitt.edu')).toBe(true);
    expect(isAllowedEmailDomain('Student@PITT.EDU')).toBe(true);
    expect(isAllowedEmailDomain('a@andrew.cmu.edu')).toBe(true);
    expect(isAllowedEmailDomain('a@cmu.edu')).toBe(true);
    expect(isAllowedEmailDomain('  padded@pitt.edu  ')).toBe(true);
  });

  it('rejects outsiders, suffix lookalikes, and empty input', () => {
    expect(isAllowedEmailDomain('user@gmail.com')).toBe(false);
    // endsWith('@pitt.edu') must anchor at the @ — these are the attacks.
    expect(isAllowedEmailDomain('user@evilpitt.edu')).toBe(false);
    expect(isAllowedEmailDomain('user@pitt.edu.evil.com')).toBe(false);
    expect(isAllowedEmailDomain('pitt.edu')).toBe(false);
    expect(isAllowedEmailDomain(null)).toBe(false);
    expect(isAllowedEmailDomain(undefined)).toBe(false);
    expect(isAllowedEmailDomain('')).toBe(false);
    expect(isAllowedEmailDomain('   ')).toBe(false);
  });
});

describe('getAuthedUser', () => {
  it('returns the user for a valid token from an allowed domain', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: UUID_A, email: 'ok@pitt.edu' } }, error: null });
    await expect(getAuthedUser(req('Bearer tok'))).resolves.toEqual({ id: UUID_A, email: 'ok@pitt.edu' });
    expect(mocks.getUser).toHaveBeenCalledWith('tok');
  });

  it('returns null with no Authorization header, and never calls Supabase', async () => {
    await expect(getAuthedUser(req())).resolves.toBeNull();
    await expect(getAuthedUser(req('Basic abc'))).resolves.toBeNull();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('returns null when the token does not verify', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad' } });
    await expect(getAuthedUser(req('Bearer forged'))).resolves.toBeNull();
  });

  it('returns null for a VALID token whose account is not from an allowed domain', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: UUID_A, email: 'valid@gmail.com' } }, error: null });
    await expect(getAuthedUser(req('Bearer tok'))).resolves.toBeNull();
  });

  describe('with REQUIRE_ADMIN_AAL2=1', () => {
    beforeEach(() => {
      vi.stubEnv('REQUIRE_ADMIN_AAL2', '1');
      mocks.getUser.mockResolvedValue({ data: { user: { id: UUID_A, email: 'admin@pitt.edu' } }, error: null });
    });

    it('rejects an aal1 session on an admin surface (phished password alone)', async () => {
      const token = jwt({ sub: UUID_A, aal: 'aal1' });
      await expect(getAuthedUser(req(`Bearer ${token}`), { requireAal2: true })).resolves.toBeNull();
    });

    it('rejects a token whose payload is unreadable', async () => {
      await expect(getAuthedUser(req('Bearer not-a-jwt'), { requireAal2: true })).resolves.toBeNull();
    });

    it('accepts an aal2 session on an admin surface', async () => {
      const token = jwt({ sub: UUID_A, aal: 'aal2' });
      await expect(getAuthedUser(req(`Bearer ${token}`), { requireAal2: true })).resolves.toEqual({
        id: UUID_A,
        email: 'admin@pitt.edu',
      });
    });

    it('still lets an aal1 session reach NON-admin surfaces', async () => {
      const token = jwt({ sub: UUID_A, aal: 'aal1' });
      await expect(getAuthedUser(req(`Bearer ${token}`))).resolves.toEqual({
        id: UUID_A,
        email: 'admin@pitt.edu',
      });
    });
  });

  it('ignores aal when the rollout flag is off (staged enforcement)', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: UUID_A, email: 'admin@pitt.edu' } }, error: null });
    const token = jwt({ sub: UUID_A, aal: 'aal1' });
    await expect(getAuthedUser(req(`Bearer ${token}`), { requireAal2: true })).resolves.toEqual({
      id: UUID_A,
      email: 'admin@pitt.edu',
    });
  });
});

describe('areUsersBlocked', () => {
  it('fails CLOSED (blocked) on anything that is not a UUID', async () => {
    await expect(areUsersBlocked('robert"); DROP', UUID_B)).resolves.toBe(true);
    await expect(areUsersBlocked(UUID_A, 'x.eq.y')).resolves.toBe(true);
    expect(mocks.from).not.toHaveBeenCalledWith('blocked_users');
  });

  it('reports blocked when a row exists in either direction', async () => {
    mocks.limit.mockResolvedValue({ data: [{ blocker_id: UUID_A }] });
    await expect(areUsersBlocked(UUID_A, UUID_B)).resolves.toBe(true);
  });

  it('reports not blocked when no row exists', async () => {
    mocks.limit.mockResolvedValue({ data: [] });
    await expect(areUsersBlocked(UUID_A, UUID_B)).resolves.toBe(false);
  });
});

describe('getCallerName', () => {
  it('prefers the profile full name', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { full_name: '  Ethan T ' } });
    await expect(getCallerName(UUID_A, 'e@pitt.edu')).resolves.toBe('Ethan T');
  });

  it('falls back to the email localpart, then to "Someone"', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null });
    await expect(getCallerName(UUID_A, 'jdoe12@pitt.edu')).resolves.toBe('jdoe12');
    await expect(getCallerName(UUID_A, null)).resolves.toBe('Someone');
  });
});
