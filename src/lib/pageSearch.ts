/**
 * The "/" search shortcut — Identity P8 item 3.
 *
 * Two search surfaces exist and they are deliberately different things (see
 * PageToolbar's header comment): the page-scoped search that filters the CURRENT
 * collection, and the global Cmd/Ctrl+K palette that searches everything. "/" is
 * the *contextual* shortcut, so it resolves in that order:
 *
 *   1. a visible page-scoped search input on this screen  → focus + select it
 *   2. nothing scoped to focus                            → open the global palette
 *
 * Marking the input with an attribute rather than a ref/context is on purpose: the
 * scoped input is rendered by PageToolbar but the key listener lives in a provider
 * far above it, and one page can mount the toolbar conditionally. A DOM query is
 * the only thing that stays correct without threading a ref through every screen.
 */
export const PAGE_SEARCH_ATTR = 'data-page-search';

/** True when the key event came from somewhere a bare "/" is a literal character. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}

/**
 * Focus the current page's scoped search input. Returns false when this screen has
 * none (or it's hidden), so the caller can fall back to the global palette.
 *
 * `offsetParent === null` is the cheap "not rendered" test that also catches the
 * `hidden md:flex` chrome this app leans on; position:fixed elements report a null
 * offsetParent too, hence the getClientRects() second chance.
 */
export function focusPageSearch(): boolean {
  const el = document.querySelector<HTMLInputElement>(`input[${PAGE_SEARCH_ATTR}]`);
  if (!el || el.disabled) return false;
  if (el.offsetParent === null && el.getClientRects().length === 0) return false;
  el.focus();
  el.select();
  return true;
}
