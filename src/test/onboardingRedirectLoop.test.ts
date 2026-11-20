import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The inescapable onboarding loop.
 *
 * RLS on `profiles` is `id = auth.uid()`, so a read made without a valid access
 * token comes back as ZERO ROWS AND NO ERROR. `getPostLoginRedirect` used to ask
 * `data?.has_completed_onboarding === true` and discard `error` entirely, so
 * "could not read your profile" and "has not onboarded" were the same answer —
 * and the answer was onboarding. The everyday trigger is app start, where a
 * persisted session yields a user while the token is still refreshing.
 *
 * That is a loop with no exit: onboarding writes a flag that is already true,
 * sends you home, the read fails again, and you are back at step one. Ethan hit
 * it with `has_completed_onboarding: true` sitting in production the whole time.
 *
 * "No row" cannot mean "new user": prod carries 84 auth users and 74 profiles,
 * and all 10 without a row are unconfirmed and have never signed in. Anyone who
 * reaches this code path has a row.
 */

const maybeSingle = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle }),
      }),
    }),
  },
}));

const { getPostLoginRedirect } = await import('@/lib/authRedirects');

const HOME = '/';
const ONBOARDING = '/onboarding/intro';

beforeEach(() => {
  maybeSingle.mockReset();
});

describe('getPostLoginRedirect never reads a failure as "not onboarded"', () => {
  it('sends a completed user home', async () => {
    maybeSingle.mockResolvedValue({ data: { has_completed_onboarding: true }, error: null });
    await expect(getPostLoginRedirect('u1')).resolves.toBe(HOME);
  });

  it('sends a genuinely un-onboarded user to onboarding', async () => {
    maybeSingle.mockResolvedValue({ data: { has_completed_onboarding: false }, error: null });
    await expect(getPostLoginRedirect('u1')).resolves.toBe(ONBOARDING);
  });

  it('treats a null flag as outstanding, since the column is nullable', async () => {
    maybeSingle.mockResolvedValue({ data: { has_completed_onboarding: null }, error: null });
    await expect(getPostLoginRedirect('u1')).resolves.toBe(ONBOARDING);
  });

  it('does NOT route to onboarding when RLS hides the row (no rows, no error)', async () => {
    // The loop's actual shape: a stale or still-refreshing token, so auth.uid()
    // does not match and PostgREST returns nothing at all — without an error.
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(getPostLoginRedirect('u1')).resolves.toBe(HOME);
  });

  it('does NOT route to onboarding when the read errors outright', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'network' } });
    await expect(getPostLoginRedirect('u1')).resolves.toBe(HOME);
  });
});
