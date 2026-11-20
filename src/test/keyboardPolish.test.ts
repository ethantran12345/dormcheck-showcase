import { describe, it, expect, beforeEach } from 'vitest';
import { LIST_CONTAINER_ATTR, LIST_ROW_ATTR, handleListArrowKeys } from '@/lib/listKeyboard';
import { PAGE_SEARCH_ATTR, focusPageSearch, isTypingTarget } from '@/lib/pageSearch';

/**
 * Identity P8 keyboard polish. These cover the DECISIONS the helpers make (which
 * key moves where, when the shortcut must stand down) - the actual key presses on
 * the running app are verified in the browser, not here.
 */

/** Minimal stand-in for the React synthetic event the handlers actually receive. */
function keyEvent(
  key: string,
  target: HTMLElement,
  container: HTMLElement,
  mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {},
) {
  let prevented = false;
  return {
    key,
    target,
    currentTarget: container,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
    preventDefault: () => {
      prevented = true;
    },
    get defaultPrevented() {
      return prevented;
    },
  } as unknown as React.KeyboardEvent<HTMLElement> & { defaultPrevented: boolean };
}

describe('handleListArrowKeys', () => {
  let rows: HTMLElement[];
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    container.setAttribute(LIST_CONTAINER_ATTR, '');
    rows = ['a', 'b', 'c'].map((id) => {
      const row = document.createElement('div');
      row.setAttribute(LIST_ROW_ATTR, '');
      row.tabIndex = 0;
      row.id = id;
      // jsdom has no layout, so scrollIntoView is not implemented by default.
      row.scrollIntoView = () => {};
      container.appendChild(row);
      return row;
    });
    document.body.appendChild(container);
  });

  it('ArrowDown moves focus to the next row', () => {
    rows[0].focus();
    expect(handleListArrowKeys(keyEvent('ArrowDown', rows[0], container))).toBe(true);
    expect(document.activeElement?.id).toBe('b');
  });

  it('ArrowUp moves focus to the previous row', () => {
    rows[2].focus();
    handleListArrowKeys(keyEvent('ArrowUp', rows[2], container));
    expect(document.activeElement?.id).toBe('b');
  });

  it('clamps at both ends instead of wrapping', () => {
    rows[0].focus();
    handleListArrowKeys(keyEvent('ArrowUp', rows[0], container));
    expect(document.activeElement?.id).toBe('a');
    rows[2].focus();
    handleListArrowKeys(keyEvent('ArrowDown', rows[2], container));
    expect(document.activeElement?.id).toBe('c');
  });

  it('Home and End jump to the ends', () => {
    rows[1].focus();
    handleListArrowKeys(keyEvent('End', rows[1], container));
    expect(document.activeElement?.id).toBe('c');
    handleListArrowKeys(keyEvent('Home', rows[2], container));
    expect(document.activeElement?.id).toBe('a');
  });

  it('ignores modified arrows so the browser keeps ⌥/⇧ behaviour', () => {
    rows[0].focus();
    expect(handleListArrowKeys(keyEvent('ArrowDown', rows[0], container, { shiftKey: true }))).toBe(
      false,
    );
    expect(document.activeElement?.id).toBe('a');
  });

  it('does nothing when the event did not come from a row', () => {
    const stray = document.createElement('input');
    container.appendChild(stray);
    stray.focus();
    expect(handleListArrowKeys(keyEvent('ArrowDown', stray, container))).toBe(false);
  });

  it('never walks out of its own container into a sibling list', () => {
    const other = document.createElement('div');
    other.setAttribute(LIST_CONTAINER_ATTR, '');
    const otherRow = document.createElement('div');
    otherRow.setAttribute(LIST_ROW_ATTR, '');
    otherRow.tabIndex = 0;
    otherRow.id = 'other';
    otherRow.scrollIntoView = () => {};
    other.appendChild(otherRow);
    document.body.appendChild(other);

    rows[2].focus();
    handleListArrowKeys(keyEvent('ArrowDown', rows[2], container));
    expect(document.activeElement?.id).toBe('c');
  });
});

describe('"/" search shortcut', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('stands down while the user is typing', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const div = document.createElement('div');
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(textarea)).toBe(true);
    expect(isTypingTarget(div)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it('focuses and selects the page-scoped search when one is mounted', () => {
    const input = document.createElement('input');
    input.setAttribute(PAGE_SEARCH_ATTR, '');
    input.value = 'dorm';
    // jsdom reports offsetParent null for everything; getClientRects is the fallback.
    input.getClientRects = (() => [{}] as unknown as DOMRectList) as typeof input.getClientRects;
    document.body.appendChild(input);

    expect(focusPageSearch()).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it('reports false when the screen has no scoped search, so the caller opens the palette', () => {
    expect(focusPageSearch()).toBe(false);
  });

  it('reports false for a disabled scoped search', () => {
    const input = document.createElement('input');
    input.setAttribute(PAGE_SEARCH_ATTR, '');
    input.disabled = true;
    document.body.appendChild(input);
    expect(focusPageSearch()).toBe(false);
  });
});
