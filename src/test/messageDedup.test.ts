import { describe, it, expect } from 'vitest';
import { appendMessageById, byCreatedAtAsc } from '@/lib/messageDedup';

type TestMsg = { id: string; created_at: string };

const base = new Date('2026-07-22T12:00:00.000Z').getTime();
const at = (offsetMs: number) => new Date(base + offsetMs).toISOString();
const msg = (id: string, offsetMs: number): TestMsg => ({ id, created_at: at(offsetMs) });

describe('appendMessageById', () => {
  it('appends a new row when its id is not already present', () => {
    const prev = [msg('a', 0)];
    const next = appendMessageById<TestMsg>(prev, msg('b', 1_000), byCreatedAtAsc);
    expect(next.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('is idempotent: a row whose id already exists is not appended twice', () => {
    // This is the DM double-render bug: the realtime echo of our own INSERT
    // arrives while the awaited local append also fires. The second write
    // must be a no-op instead of pushing a duplicate bubble.
    const existing = msg('a', 0);
    const prev = [existing];
    const next = appendMessageById<TestMsg>(prev, msg('a', 0), byCreatedAtAsc);
    expect(next).toHaveLength(1);
    expect(next.map((m) => m.id)).toEqual(['a']);
  });

  it('returns the SAME array reference on a duplicate so React skips the re-render', () => {
    const prev = [msg('a', 0)];
    const next = appendMessageById<TestMsg>(prev, msg('a', 0), byCreatedAtAsc);
    expect(next).toBe(prev);
  });

  it('re-sorts by created_at ascending when a comparator is supplied', () => {
    // an out-of-order arrival (older row lands after a newer one) is slotted
    // back into chronological order
    const prev = [msg('a', 0), msg('c', 2_000)];
    const next = appendMessageById<TestMsg>(prev, msg('b', 1_000), byCreatedAtAsc);
    expect(next.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('preserves insertion order (no sort) when no comparator is supplied', () => {
    // mirrors the group-chat path, which appends without re-sorting
    const prev = [msg('c', 2_000)];
    const next = appendMessageById(prev, msg('a', 0));
    expect(next.map((m) => m.id)).toEqual(['c', 'a']);
  });

  it('does not mutate the input array', () => {
    const prev = [msg('a', 0)];
    appendMessageById<TestMsg>(prev, msg('b', 1_000), byCreatedAtAsc);
    expect(prev.map((m) => m.id)).toEqual(['a']);
  });
});
