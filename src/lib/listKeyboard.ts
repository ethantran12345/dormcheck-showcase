/**
 * Roving arrow-key navigation for a vertical list of focusable rows —
 * Identity P8 item 2 (Up/Down walk the conversation list).
 *
 * WHY A DOM SWEEP, NOT AN INDEX. The messages inbox renders the same row body
 * either bare (desktop) or wrapped in <SwipeRow> (mobile), and the list is split
 * across sub-tabs. Tracking "which index is focused" in React state would have to
 * mirror all of that; asking the DOM for the rows that are actually mounted, in
 * document order, cannot drift.
 *
 * WHY IT ONLY FIRES FROM A ROW. Hijacking Up/Down whenever the list merely
 * contains focus would steal scrolling from anything else in the pane. The handler
 * no-ops unless focus is already ON a row, which is also what makes it safe to
 * attach to a scroll container.
 *
 * This moves FOCUS, it does not activate: Enter/Space still open the conversation.
 * That's the listbox-style behaviour keyboard users expect, and it means arrowing
 * past a row never fires a navigation you didn't ask for.
 */
export const LIST_ROW_ATTR = 'data-list-row';
/**
 * Marks the scroll container that bounds one list. It is a plain attribute with no
 * handler and no role on purpose: hanging the keydown on the container instead
 * would make a <div> interactive and trip jsx-a11y (a blocking-ish gate here), and
 * a `role="listbox"` would fight the rows' existing `role="button"` semantics. The
 * rows are already interactive, so the handler belongs on them; this attribute
 * only tells the handler where the list ENDS, so a sibling list can't be walked
 * into.
 */
export const LIST_CONTAINER_ATTR = 'data-list-container';

const ROW_SELECTOR = `[${LIST_ROW_ATTR}]`;

/**
 * Attach to each ROW's `onKeyDown`. Handles Up/Down/Home/End; returns true when it
 * consumed the key, so a caller can chain its own handling (Enter/Space etc.).
 */
export function handleListArrowKeys(
  e: React.KeyboardEvent<HTMLElement>,
): boolean {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') {
    return false;
  }
  // Modified arrows belong to the browser/OS (e.g. ⌥↓, ⇧↓ selection).
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;

  const current = (e.target as HTMLElement | null)?.closest<HTMLElement>(ROW_SELECTOR);
  if (!current) return false;

  const container = current.closest<HTMLElement>(`[${LIST_CONTAINER_ATTR}]`);
  if (!container) return false;

  const rows = Array.from(container.querySelectorAll<HTMLElement>(ROW_SELECTOR));
  if (rows.length === 0) return false;

  const index = rows.indexOf(current);
  if (index === -1) return false;

  let nextIndex: number;
  if (e.key === 'Home') nextIndex = 0;
  else if (e.key === 'End') nextIndex = rows.length - 1;
  else if (e.key === 'ArrowDown') nextIndex = Math.min(index + 1, rows.length - 1);
  else nextIndex = Math.max(index - 1, 0);

  // Consume the key even at the ends, so the list doesn't scroll out from under
  // the focused row once you hit the top or bottom.
  e.preventDefault();
  const next = rows[nextIndex];
  if (next && next !== current) {
    next.focus();
    next.scrollIntoView({ block: 'nearest' });
  }
  return true;
}
