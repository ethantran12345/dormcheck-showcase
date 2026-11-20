// Consecutive messages from the same sender, sent close together, collapse into
// a visual "run" (iMessage-style): tight spacing within a run, and — in group
// chat — the avatar/name shown once per run instead of per message.
//
// Pure + framework-free so it can be unit-tested and reused by both the DM
// (ChatPanel) and group (GroupChatPanel) threads.

export const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export interface GroupingInput {
  /** Author id; `null` for system messages. */
  senderId: string | null;
  /** ISO timestamp (messages assumed already sorted ascending by this). */
  createdAt: string;
  /**
   * Rows that must never merge into a run — attachments/shared cards, system
   * notices, context-marker previews. They render standalone (first === last).
   */
  breaksRun?: boolean;
}

export interface GroupingFlags {
  /** First message of its run — the run's top edge. */
  isFirstInGroup: boolean;
  /** Last message of its run — the run's bottom edge (where the avatar sits). */
  isLastInGroup: boolean;
}

function continues(a: GroupingInput | undefined, b: GroupingInput | undefined, windowMs: number): boolean {
  if (!a || !b) return false;
  if (a.breaksRun || b.breaksRun) return false;
  if (a.senderId !== b.senderId) return false;
  const ta = new Date(a.createdAt).getTime();
  const tb = new Date(b.createdAt).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return Math.abs(tb - ta) <= windowMs;
}

/**
 * Returns per-message run flags in the same order as `items`.
 * A row is its own run when it `breaksRun`, when the sender changes, or when the
 * gap to the neighbour exceeds `windowMs`.
 */
export function computeMessageGrouping(
  items: GroupingInput[],
  windowMs: number = MESSAGE_GROUP_WINDOW_MS
): GroupingFlags[] {
  return items.map((item, i) => ({
    isFirstInGroup: !continues(items[i - 1], item, windowMs),
    isLastInGroup: !continues(item, items[i + 1], windowMs),
  }));
}
