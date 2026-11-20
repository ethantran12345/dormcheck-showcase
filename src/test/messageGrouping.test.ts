import { describe, it, expect } from 'vitest';
import { computeMessageGrouping, MESSAGE_GROUP_WINDOW_MS } from '@/lib/messageGrouping';

const base = new Date('2026-07-21T12:00:00.000Z').getTime();
const at = (offsetMs: number) => new Date(base + offsetMs).toISOString();

describe('computeMessageGrouping', () => {
  it('marks a lone message as both first and last of its run', () => {
    const [flag] = computeMessageGrouping([{ senderId: 'a', createdAt: at(0) }]);
    expect(flag).toEqual({ isFirstInGroup: true, isLastInGroup: true });
  });

  it('collapses consecutive same-sender messages within the window into one run', () => {
    const flags = computeMessageGrouping([
      { senderId: 'a', createdAt: at(0) },
      { senderId: 'a', createdAt: at(60_000) },
      { senderId: 'a', createdAt: at(120_000) },
    ]);
    expect(flags.map((f) => f.isFirstInGroup)).toEqual([true, false, false]);
    expect(flags.map((f) => f.isLastInGroup)).toEqual([false, false, true]);
  });

  it('breaks a run when the sender changes', () => {
    const flags = computeMessageGrouping([
      { senderId: 'a', createdAt: at(0) },
      { senderId: 'b', createdAt: at(1_000) },
    ]);
    expect(flags[0]).toEqual({ isFirstInGroup: true, isLastInGroup: true });
    expect(flags[1]).toEqual({ isFirstInGroup: true, isLastInGroup: true });
  });

  it('breaks a run when the gap exceeds the window', () => {
    const flags = computeMessageGrouping([
      { senderId: 'a', createdAt: at(0) },
      { senderId: 'a', createdAt: at(MESSAGE_GROUP_WINDOW_MS + 1) },
    ]);
    expect(flags[0].isLastInGroup).toBe(true);
    expect(flags[1].isFirstInGroup).toBe(true);
  });

  it('never merges rows flagged breaksRun (attachments / system / shared cards)', () => {
    const flags = computeMessageGrouping([
      { senderId: 'a', createdAt: at(0) },
      { senderId: 'a', createdAt: at(1_000), breaksRun: true },
      { senderId: 'a', createdAt: at(2_000) },
    ]);
    // the standalone row splits the run into three singletons
    expect(flags.every((f) => f.isFirstInGroup && f.isLastInGroup)).toBe(true);
  });

  it('treats null sender (system) consistently as its own key', () => {
    const flags = computeMessageGrouping([
      { senderId: null, createdAt: at(0) },
      { senderId: null, createdAt: at(1_000) },
    ]);
    // same null sender within window still groups (caller marks system breaksRun if needed)
    expect(flags[0].isLastInGroup).toBe(false);
    expect(flags[1].isFirstInGroup).toBe(false);
  });
});
