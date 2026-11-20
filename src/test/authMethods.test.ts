import { describe, it, expect } from 'vitest';
import {
  deriveSignInStage,
  deriveShellSignInStage,
  visibleSsoMethodsFor,
} from '@/lib/authMethods';
import type { AuthMethod } from '@/config/universities';

const PITT: readonly AuthMethod[] = ['google', 'email'];
const CMU: readonly AuthMethod[] = ['email'];

describe('deriveSignInStage', () => {
  it('routes a missing account to signup', () => {
    expect(deriveSignInStage({ exists: false, hasPassword: false, providers: [] }, PITT)).toEqual({
      mode: 'signup',
    });
  });

  it('fails safe to sign-in on an unavailable lookup (never auto create-account)', () => {
    // null = network failure / endpoint absent. Must NOT offer create-password
    // for an email we cannot prove is brand new.
    expect(deriveSignInStage(null, PITT)).toEqual({ mode: 'password' });
  });

  it('shows the password field when the account has a password', () => {
    expect(
      deriveSignInStage({ exists: true, hasPassword: true, providers: ['email'] }, PITT),
    ).toEqual({ mode: 'password' });
  });

  it('routes a Google-only account to Google when the school offers it', () => {
    expect(
      deriveSignInStage({ exists: true, hasPassword: false, providers: ['google'] }, PITT),
    ).toEqual({ mode: 'oauth-only', oauthMethod: 'google' });
  });

  it('maps the azure provider to the microsoft button', () => {
    expect(
      deriveSignInStage({ exists: true, hasPassword: false, providers: ['azure'] }, [
        'microsoft',
        'email',
      ]),
    ).toEqual({ mode: 'oauth-only', oauthMethod: 'microsoft' });
  });

  it('falls open to the password field when the OAuth provider is not offered', () => {
    // e.g. a google-only account arriving on an email-only school (CMU)
    expect(
      deriveSignInStage({ exists: true, hasPassword: false, providers: ['google'] }, CMU),
    ).toEqual({ mode: 'password' });
  });

  it('falls open to the password field for an account with no usable provider', () => {
    // seeded/edge account: no password, no OAuth identity
    expect(
      deriveSignInStage({ exists: true, hasPassword: false, providers: [] }, PITT),
    ).toEqual({ mode: 'password' });
  });
});

describe('visibleSsoMethodsFor (App Store 4.8 compliance gate)', () => {
  const PITT_FULL: readonly AuthMethod[] = ['google', 'microsoft', 'email'];

  it('renders NO Google button on iOS', () => {
    // The whole point of build 31: with Google gone, the iOS app uses its own
    // account system exclusively and needs no Sign in with Apple. If this
    // assertion ever flips back, the next submission gets rejected.
    expect(visibleSsoMethodsFor(PITT_FULL, 'ios')).not.toContain('google');
  });

  it('leaves iOS with no SSO at all for a google+email school', () => {
    expect(visibleSsoMethodsFor(PITT, 'ios')).toEqual([]);
  });

  it('keeps Google on web, including mobile Chrome (platform "web")', () => {
    expect(visibleSsoMethodsFor(PITT, 'web')).toEqual(['google']);
  });

  it('keeps Google on Android and still hides Microsoft there', () => {
    expect(visibleSsoMethodsFor(PITT_FULL, 'android')).toEqual(['google']);
  });

  it('never treats email as an SSO button', () => {
    expect(visibleSsoMethodsFor(PITT_FULL, 'web')).not.toContain('email');
  });
});

describe('deriveShellSignInStage', () => {
  // What the iOS shell renders after the 4.8 gate: Pitt still OFFERS google,
  // but the shell shows no SSO buttons at all.
  const IOS_VISIBLE: readonly AuthMethod[] = [];
  const WEB_VISIBLE: readonly AuthMethod[] = ['google'];

  it('flags a Google-only account as oauth-unavailable when the shell hides Google', () => {
    // The build-30 lockout: without this the user lands on a password field for
    // a password they never set.
    expect(
      deriveShellSignInStage(
        { exists: true, hasPassword: false, providers: ['google'] },
        PITT,
        IOS_VISIBLE,
      ),
    ).toEqual({ mode: 'oauth-unavailable', oauthMethod: 'google' });
  });

  it('still routes the same account to Google on a shell that shows it', () => {
    expect(
      deriveShellSignInStage(
        { exists: true, hasPassword: false, providers: ['google'] },
        PITT,
        WEB_VISIBLE,
      ),
    ).toEqual({ mode: 'oauth-only', oauthMethod: 'google' });
  });

  it('leaves a password account alone even when the shell hides every provider', () => {
    expect(
      deriveShellSignInStage(
        { exists: true, hasPassword: true, providers: ['email', 'google'] },
        PITT,
        IOS_VISIBLE,
      ),
    ).toEqual({ mode: 'password' });
  });

  it('leaves signup and the fail-open password stage untouched', () => {
    expect(
      deriveShellSignInStage({ exists: false, hasPassword: false, providers: [] }, PITT, IOS_VISIBLE),
    ).toEqual({ mode: 'signup' });
    expect(deriveShellSignInStage(null, PITT, IOS_VISIBLE)).toEqual({ mode: 'password' });
  });

  it('does not invent an oauth-unavailable stage for a school that never offered the provider', () => {
    // CMU is email-only, so deriveSignInStage already fell open to password;
    // the shell wrapper must not re-classify that as a dead end.
    expect(
      deriveShellSignInStage(
        { exists: true, hasPassword: false, providers: ['google'] },
        CMU,
        IOS_VISIBLE,
      ),
    ).toEqual({ mode: 'password' });
  });
});
