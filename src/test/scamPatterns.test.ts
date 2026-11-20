import { describe, expect, it } from 'vitest';
import { hasContactShareSignal, hasPaymentRiskSignal } from '@/lib/scamPatterns';

describe('payment-risk detection (P0.7 scam interstitial)', () => {
  it('flags deposits and off-platform payment rails', () => {
    expect(hasPaymentRiskSignal('can you send a deposit to hold it?')).toBe(true);
    expect(hasPaymentRiskSignal('my Venmo is @someone')).toBe(true);
    expect(hasPaymentRiskSignal('zelle me half')).toBe(true);
    expect(hasPaymentRiskSignal('I only take cash app')).toBe(true);
    expect(hasPaymentRiskSignal('wire transfer works')).toBe(true);
    expect(hasPaymentRiskSignal('pay with a GIFT CARD')).toBe(true);
  });

  it('flags outbound contact shares (phone, email, payment handles)', () => {
    expect(hasContactShareSignal('text me at 412-555-0134')).toBe(true);
    expect(hasContactShareSignal('call (412) 555 0134 anytime')).toBe(true);
    expect(hasContactShareSignal('email me: someone@gmail.com')).toBe(true);
    expect(hasContactShareSignal('my venmo is @someone')).toBe(true);
    expect(hasContactShareSignal('see you at the tour tomorrow')).toBe(false);
    expect(hasContactShareSignal('room 302 works for me')).toBe(false);
  });

  it('ignores ordinary housing chat', () => {
    expect(hasPaymentRiskSignal('is the desk still available?')).toBe(false);
    expect(hasPaymentRiskSignal('can we do a tour on Tuesday?')).toBe(false);
    expect(hasPaymentRiskSignal(null)).toBe(false);
    expect(hasPaymentRiskSignal('')).toBe(false);
  });
});
