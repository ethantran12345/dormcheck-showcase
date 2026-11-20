import { describe, expect, it } from 'vitest';
import {
  EMPTY_CHECKLIST_SETTLEMENT_CONTEXT,
  parseChecklistSettlementContext,
} from '@/hooks/useChecklistSettlementContext';

const VALID_PAYLOAD = {
  members: [
    {
      member_id: 'm-1',
      user_id: 'u-1',
      role: 'owner',
      full_name: 'Alex',
      avatar_url: 'https://example.com/a.png',
      venmo_username: '@alex',
      zelle_info: 'alex@pitt.edu',
    },
  ],
  payment_history: [
    {
      id: 'ph-1',
      group_id: 'g-1',
      payer_id: 'u-1',
      receiver_id: 'u-2',
      amount: 12.5,
      method: 'venmo',
      status: 'completed',
      note: 'split',
      created_at: '2026-06-01T12:00:00Z',
    },
  ],
  legacy_payments: [
    {
      id: 'cp-1',
      group_id: 'g-1',
      payer_id: 'u-2',
      payee_id: 'u-1',
      amount: '5.00',
      paid_at: '2026-06-02T12:00:00Z',
      created_at: '2026-06-02T12:00:00Z',
    },
  ],
  payment_acks: [
    {
      group_id: 'g-1',
      debtor_id: 'u-2',
      creditor_id: 'u-1',
      sent_at: '2026-06-03T12:00:00Z',
    },
  ],
};

describe('parseChecklistSettlementContext', () => {
  it('parses a valid RPC payload into the typed shape', () => {
    const parsed = parseChecklistSettlementContext(VALID_PAYLOAD);

    expect(parsed.members).toHaveLength(1);
    expect(parsed.members[0]).toEqual({
      member_id: 'm-1',
      user_id: 'u-1',
      role: 'owner',
      full_name: 'Alex',
      avatar_url: 'https://example.com/a.png',
      venmo_username: '@alex',
      zelle_info: 'alex@pitt.edu',
    });
    expect(parsed.paymentHistory).toHaveLength(1);
    expect(parsed.paymentHistory[0].amount).toBe(12.5);
    expect(parsed.legacyPayments).toHaveLength(1);
    expect(parsed.legacyPayments[0].payee_id).toBe('u-1');
    expect(parsed.paymentAcks).toHaveLength(1);
    expect(parsed.paymentAcks[0].sent_at).toBe('2026-06-03T12:00:00Z');
  });

  it('returns the empty sentinel for malformed payloads without throwing', () => {
    expect(parseChecklistSettlementContext(null)).toEqual(EMPTY_CHECKLIST_SETTLEMENT_CONTEXT);
    expect(parseChecklistSettlementContext('bad' as unknown as null)).toEqual(
      EMPTY_CHECKLIST_SETTLEMENT_CONTEXT,
    );
    expect(
      parseChecklistSettlementContext({
        members: 'not-an-array',
        payment_history: [],
        legacy_payments: [],
        payment_acks: [],
      }),
    ).toEqual(EMPTY_CHECKLIST_SETTLEMENT_CONTEXT);
    expect(
      parseChecklistSettlementContext({
        members: [{ member_id: 'only-partial' }],
        payment_history: [],
        legacy_payments: [],
        payment_acks: [],
      }).members,
    ).toEqual([]);
  });
});
