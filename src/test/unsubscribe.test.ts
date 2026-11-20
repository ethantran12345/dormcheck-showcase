import { createHmac } from 'crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  unsubscribeUrl,
} from '../../api/_lib/unsubscribe';

const USER_ID = '3665ebcf-dd64-48cf-b1e2-b91b06d2cf12';

beforeAll(() => {
  process.env.UNSUBSCRIBE_SECRET = 'test-secret-for-unsubscribe-tokens';
});

describe('unsubscribe tokens', () => {
  it('round-trips a signed token', () => {
    const token = signUnsubscribeToken(USER_ID, 'messages');
    expect(verifyUnsubscribeToken(token)).toEqual({ userId: USER_ID, category: 'messages' });
  });

  it('rejects a tampered payload', () => {
    const token = signUnsubscribeToken(USER_ID, 'messages');
    const [, sig] = token.split('.');
    const forged = `${Buffer.from(`${USER_ID}:marketplace`, 'utf8').toString('base64url')}.${sig}`;
    expect(verifyUnsubscribeToken(forged)).toBeNull();
  });

  it('rejects a tampered signature and garbage input', () => {
    const token = signUnsubscribeToken(USER_ID, 'messages');
    expect(verifyUnsubscribeToken(`${token}x`)).toBeNull();
    expect(verifyUnsubscribeToken('not-a-token')).toBeNull();
    expect(verifyUnsubscribeToken('')).toBeNull();
  });

  it('rejects unknown categories even when correctly signed', () => {
    // signUnsubscribeToken is typed to known categories; simulate a stale link
    // for a category that was later removed.
    const payload = `${USER_ID}:retired_category`;
    const sig = createHmac('sha256', process.env.UNSUBSCRIBE_SECRET as string)
      .update(payload)
      .digest()
      .toString('base64url');
    const token = `${Buffer.from(payload, 'utf8').toString('base64url')}.${sig}`;
    expect(verifyUnsubscribeToken(token)).toBeNull();
  });

  it('builds a dormcheck.com unsubscribe URL', () => {
    expect(unsubscribeUrl(USER_ID, 'marketplace')).toMatch(
      /^https:\/\/dormcheck\.com\/api\/unsubscribe\?t=/,
    );
  });
});
