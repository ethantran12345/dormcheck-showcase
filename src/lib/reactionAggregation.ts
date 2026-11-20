// Pure reaction helpers — no React, no Supabase — so the aggregation and toggle
// logic is unit-testable in isolation (see src/test/reactionAggregation.test.ts).
//
// A "reaction row" is one (message, user, emoji) tuple. The UI needs the inverse:
// per-message, per-emoji counts plus whether the current user is one of the reactors.

export interface ReactionRowLike {
  message_id: string | number;
  user_id: string;
  emoji: string;
}

export interface AggregatedReaction {
  emoji: string;
  count: number;
  /** Distinct user ids who reacted with this emoji (order = first-seen). */
  userIds: string[];
  /** True when the current viewer is among `userIds`. */
  reactedByMe: boolean;
}

/**
 * Collapse a flat list of reaction rows into `messageId -> AggregatedReaction[]`.
 * Emoji order within a message follows first-appearance; users are de-duped so a
 * (defensively) doubled row never inflates a count.
 */
export function aggregateReactions(
  rows: ReactionRowLike[],
  currentUserId: string | null,
): Map<string, AggregatedReaction[]> {
  const byMessage = new Map<string, Map<string, AggregatedReaction>>();

  for (const row of rows) {
    const messageId = String(row.message_id);
    let emojiMap = byMessage.get(messageId);
    if (!emojiMap) {
      emojiMap = new Map<string, AggregatedReaction>();
      byMessage.set(messageId, emojiMap);
    }
    let agg = emojiMap.get(row.emoji);
    if (!agg) {
      agg = { emoji: row.emoji, count: 0, userIds: [], reactedByMe: false };
      emojiMap.set(row.emoji, agg);
    }
    if (!agg.userIds.includes(row.user_id)) {
      agg.userIds.push(row.user_id);
      agg.count += 1;
      if (currentUserId && row.user_id === currentUserId) agg.reactedByMe = true;
    }
  }

  const result = new Map<string, AggregatedReaction[]>();
  for (const [messageId, emojiMap] of byMessage) {
    result.set(messageId, Array.from(emojiMap.values()));
  }
  return result;
}

/**
 * Decide whether toggling (message, emoji) for a user should ADD or REMOVE.
 * Tapping a pill you already contributed to removes yours; a new emoji adds one.
 * This is what makes a double-toggle idempotent (add then remove = no net change).
 */
export function resolveToggle(
  rows: ReactionRowLike[],
  messageId: string | number,
  emoji: string,
  userId: string,
): 'add' | 'remove' {
  const mine = rows.some(
    (r) => String(r.message_id) === String(messageId) && r.user_id === userId && r.emoji === emoji,
  );
  return mine ? 'remove' : 'add';
}
