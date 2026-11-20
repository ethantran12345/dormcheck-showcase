import { describe, it, expect } from 'vitest';
import {
  aggregateReactions,
  resolveToggle,
  type ReactionRowLike,
} from '@/lib/reactionAggregation';

const ME = 'user-me';
const OTHER = 'user-other';
const THIRD = 'user-third';

describe('aggregateReactions', () => {
  it('returns an empty map for no rows', () => {
    expect(aggregateReactions([], ME).size).toBe(0);
  });

  it('counts the same emoji across multiple distinct users', () => {
    const rows: ReactionRowLike[] = [
      { message_id: 1, user_id: ME, emoji: '👍' },
      { message_id: 1, user_id: OTHER, emoji: '👍' },
    ];
    const agg = aggregateReactions(rows, ME).get('1')!;
    expect(agg).toHaveLength(1);
    expect(agg[0]).toMatchObject({ emoji: '👍', count: 2, reactedByMe: true });
    expect(agg[0].userIds).toEqual([ME, OTHER]);
  });

  it('separates distinct emojis on the same message and tracks reactedByMe per emoji', () => {
    const rows: ReactionRowLike[] = [
      { message_id: 1, user_id: ME, emoji: '👍' },
      { message_id: 1, user_id: OTHER, emoji: '🔥' },
      { message_id: 1, user_id: THIRD, emoji: '🔥' },
    ];
    const agg = aggregateReactions(rows, ME).get('1')!;
    const thumbs = agg.find((a) => a.emoji === '👍')!;
    const fire = agg.find((a) => a.emoji === '🔥')!;
    expect(thumbs).toMatchObject({ count: 1, reactedByMe: true });
    expect(fire).toMatchObject({ count: 2, reactedByMe: false });
  });

  it('groups reactions by message id (bigint and uuid keys coexist as strings)', () => {
    const rows: ReactionRowLike[] = [
      { message_id: 42, user_id: ME, emoji: '❤️' },
      { message_id: 'uuid-abc', user_id: OTHER, emoji: '😂' },
    ];
    const map = aggregateReactions(rows, ME);
    expect(map.get('42')![0].emoji).toBe('❤️');
    expect(map.get('uuid-abc')![0].emoji).toBe('😂');
  });

  it('does not double-count a defensively duplicated (message,user,emoji) row', () => {
    const rows: ReactionRowLike[] = [
      { message_id: 1, user_id: ME, emoji: '👍' },
      { message_id: 1, user_id: ME, emoji: '👍' },
    ];
    const agg = aggregateReactions(rows, ME).get('1')!;
    expect(agg[0].count).toBe(1);
  });

  it('treats a null current user as never having reacted', () => {
    const rows: ReactionRowLike[] = [{ message_id: 1, user_id: OTHER, emoji: '👍' }];
    expect(aggregateReactions(rows, null).get('1')![0].reactedByMe).toBe(false);
  });
});

describe('resolveToggle', () => {
  it('adds when the user has not reacted with that emoji', () => {
    expect(resolveToggle([], 1, '👍', ME)).toBe('add');
  });

  it('removes when the user already reacted with that emoji', () => {
    const rows: ReactionRowLike[] = [{ message_id: 1, user_id: ME, emoji: '👍' }];
    expect(resolveToggle(rows, 1, '👍', ME)).toBe('remove');
  });

  it("does not treat another user's identical reaction as mine", () => {
    const rows: ReactionRowLike[] = [{ message_id: 1, user_id: OTHER, emoji: '👍' }];
    expect(resolveToggle(rows, 1, '👍', ME)).toBe('add');
  });

  it('is idempotent: add then remove returns to the original state', () => {
    let rows: ReactionRowLike[] = [];
    // add
    expect(resolveToggle(rows, 1, '👍', ME)).toBe('add');
    rows = [...rows, { message_id: 1, user_id: ME, emoji: '👍' }];
    expect(aggregateReactions(rows, ME).get('1')![0].count).toBe(1);
    // remove
    expect(resolveToggle(rows, 1, '👍', ME)).toBe('remove');
    rows = rows.filter((r) => !(r.message_id === 1 && r.user_id === ME && r.emoji === '👍'));
    expect(aggregateReactions(rows, ME).size).toBe(0);
  });

  it('matches message ids across number/string representations', () => {
    const rows: ReactionRowLike[] = [{ message_id: 7, user_id: ME, emoji: '👍' }];
    expect(resolveToggle(rows, '7', '👍', ME)).toBe('remove');
  });
});
