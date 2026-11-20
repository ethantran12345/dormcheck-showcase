import { describe, expect, it } from 'vitest';
import { groupMessageCursorFilter } from '@/hooks/useGroupMessages';

describe('group message keyset pagination', () => {
  it('continues before the exact oldest created-at/id pair', () => {
    expect(groupMessageCursorFilter({
      created_at: '2026-08-16T17:00:00.000000+00:00',
      id: '11111111-2222-3333-4444-555555555555',
    })).toBe(
      'created_at.lt.2026-08-16T17:00:00.000000+00:00,and(created_at.eq.2026-08-16T17:00:00.000000+00:00,id.lt.11111111-2222-3333-4444-555555555555)',
    );
  });

  it('uses id as the deterministic tie-breaker when timestamps match', () => {
    const filter = groupMessageCursorFilter({
      created_at: '2026-08-16T17:00:00Z',
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    });
    expect(filter).toContain('created_at.eq.2026-08-16T17:00:00Z');
    expect(filter).toContain('id.lt.bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  });
});
