import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Every user-facing notify handler that emails a signed-in user must also push,
// gated by the same category via shouldSendPush. Exemptions are handlers whose
// recipients have no account/device (pre-signup waitlist) or admin digests.
const API_DIR = join(__dirname, '../../api');
const EXEMPT = new Set([
  'join-waitlist.ts', // pre-account, no device
  'admin-invite.ts', // admin onboarding, email is the right channel
  // Push parity lives in the notify_group_invite_accepted DB trigger (fires on
  // the same ranking_group_members row change); a sendPush() here too would
  // double-notify the owner. This handler is intentionally email-only.
  'notify-group-invite-accepted.ts',
]);

describe('notify handlers push/email parity', () => {
  const files = readdirSync(API_DIR).filter(
    (f) => f.endsWith('.ts') && !EXEMPT.has(f),
  );
  const emailGated = files.filter((f) =>
    readFileSync(join(API_DIR, f), 'utf8').includes('shouldSendEmail('),
  );

  it('covers the expected handlers', () => {
    expect(emailGated).toEqual(
      expect.arrayContaining([
        'notify-checklist-assigned.ts',
        'notify-listing-status.ts',
        'notify-message.ts',
        'notify-ranking-invite.ts',
        'notify-seller-rating.ts',
        'send-roommate-invite.ts',
      ]),
    );
  });

  for (const file of emailGated) {
    it(`${file} also sends a preference-gated push`, () => {
      const src = readFileSync(join(API_DIR, file), 'utf8');
      expect(src).toContain('shouldSendPush(');
      expect(src).toContain('sendPush(');
    });
  }

  it('every push carries a deep-link route', () => {
    for (const file of emailGated) {
      const src = readFileSync(join(API_DIR, file), 'utf8');
      if (src.includes('sendPush(')) {
        expect(src, `${file} push data must include a route`).toMatch(/route: /);
      }
    }
  });

  it('school launch pushes only to installed accounts', () => {
    const src = readFileSync(join(API_DIR, 'notify-school-launch.ts'), 'utf8');
    expect(src).toContain('device_tokens');
    expect(src).toContain('sendPush(');
  });
});
