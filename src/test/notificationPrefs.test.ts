import { describe, it, expect } from 'vitest';
import {
  NOTIFICATION_CATEGORIES,
  shouldSendEmail,
  shouldSendPush,
} from '../../api/_lib/notificationPrefs';
import { NOTIFICATION_CATEGORIES as UI_CATEGORIES } from '@/lib/notificationPrefs';

describe('category registry', () => {
  it('UI category list matches the server list', () => {
    expect([...UI_CATEGORIES]).toEqual([...NOTIFICATION_CATEGORIES]);
  });
});

describe('shouldSendEmail', () => {
  it('sends by default when prefs are empty or missing', () => {
    expect(shouldSendEmail({ email_notifications: true, notification_prefs: {} }, 'messages')).toBe(true);
    expect(shouldSendEmail({ email_notifications: true, notification_prefs: null }, 'messages')).toBe(true);
    expect(shouldSendEmail({ email_notifications: true }, 'marketplace')).toBe(true);
  });

  it('missing category key defaults to enabled (forward compat)', () => {
    const profile = { email_notifications: true, notification_prefs: { email: { messages: false } } };
    expect(shouldSendEmail(profile, 'marketplace')).toBe(true);
  });

  it('suppresses only the disabled category', () => {
    const profile = { email_notifications: true, notification_prefs: { email: { messages: false } } };
    expect(shouldSendEmail(profile, 'messages')).toBe(false);
    for (const cat of NOTIFICATION_CATEGORIES.filter((c) => c !== 'messages')) {
      expect(shouldSendEmail(profile, cat)).toBe(true);
    }
  });

  it('master kill-switch off suppresses every category regardless of prefs', () => {
    const profile = { email_notifications: false, notification_prefs: { email: { messages: true } } };
    for (const cat of NOTIFICATION_CATEGORIES) {
      expect(shouldSendEmail(profile, cat)).toBe(false);
    }
  });

  it('null/undefined master defaults to enabled', () => {
    expect(shouldSendEmail({ email_notifications: null }, 'messages')).toBe(true);
    expect(shouldSendEmail({}, 'messages')).toBe(true);
  });

  it('missing profile never sends', () => {
    expect(shouldSendEmail(null, 'messages')).toBe(false);
    expect(shouldSendEmail(undefined, 'messages')).toBe(false);
  });
});

describe('shouldSendPush', () => {
  it('is not gated by the email master switch', () => {
    const profile = { email_notifications: false, notification_prefs: {} };
    for (const cat of NOTIFICATION_CATEGORIES) {
      expect(shouldSendPush(profile, cat)).toBe(true);
    }
  });

  it('suppresses only the disabled push category', () => {
    const profile = {
      email_notifications: true,
      notification_prefs: { push: { marketplace: false } },
    };
    expect(shouldSendPush(profile, 'marketplace')).toBe(false);
    expect(shouldSendPush(profile, 'messages')).toBe(true);
  });

  it('email category off does not affect push for the same category', () => {
    const profile = { email_notifications: true, notification_prefs: { email: { messages: false } } };
    expect(shouldSendPush(profile, 'messages')).toBe(true);
  });

  it('missing prefs default to enabled; missing profile never sends', () => {
    expect(shouldSendPush({ email_notifications: true }, 'messages')).toBe(true);
    expect(shouldSendPush(null, 'messages')).toBe(false);
  });
});
