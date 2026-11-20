import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { BusinessListingCard } from '@/components/marketplace/BusinessListingCard';
import type { Tables } from '@/integrations/supabase/types';

/**
 * Regression guard for design-audit A-3 (2026-08-02): listing/profile cards used
 * a `role="button"` container that WRAPPED the save, edit, delete, message and
 * Instagram controls. A control cannot contain controls — AT flattens or
 * mis-announces the inner ones, and the container's own Enter/Space handler
 * competed with theirs.
 *
 * These assertions are structural on purpose. jsdom does not implement implicit
 * button activation from a key event, so a test that "presses Enter" would prove
 * nothing about a real browser. What actually broke is expressible directly:
 * nothing interactive may nest, the tab sequence must be the controls in reading
 * order, and activating one control must not fire another.
 */

const INTERACTIVE = 'a[href],button,input,select,textarea,[tabindex],[role="button"],[role="link"]';

/** Every interactive element that has an interactive ancestor. Must always be empty. */
function nestedInteractives(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>(INTERACTIVE))
    .filter((el) => el.parentElement?.closest(INTERACTIVE))
    .map((el) => `${el.tagName.toLowerCase()}[${el.getAttribute('aria-label') ?? el.textContent?.trim() ?? ''}]`);
}

/** Tabbable elements in DOM order, which is the tab order for a card with no positive tabindex. */
function tabOrder(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>('a[href],button,[tabindex]'))
    .filter((el) => el.getAttribute('tabindex') !== '-1' && !el.hasAttribute('disabled'))
    .map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '');
}

const listing = {
  id: 'l1',
  user_id: 'seller-1',
  business_name: 'Nia Braids',
  category: 'Hair and Braiding',
  description: 'Knotless braids in your dorm.',
  price_range: '40',
  instagram_handle: '@niabraids',
  banner_image_url: null,
  banner_color: null,
  logo_url: null,
} as unknown as Tables<'business_listings'>;

function renderCard(overrides: Partial<Parameters<typeof BusinessListingCard>[0]> = {}) {
  const props = {
    listing,
    isSaved: false,
    onToggleSave: vi.fn(),
    currentUserId: 'viewer-1',
    onClick: vi.fn(),
    onMessage: vi.fn(),
    ...overrides,
  };
  const { container } = render(
    <MemoryRouter>
      <BusinessListingCard {...props} />
    </MemoryRouter>,
  );
  return { props, container: container as HTMLElement };
}

describe('BusinessListingCard — interactive nesting (A-3)', () => {
  beforeEach(cleanup);

  it('nests no interactive element inside another', () => {
    const { container } = renderCard();
    expect(nestedInteractives(container)).toEqual([]);
  });

  it('nests nothing even for the owner, whose card adds edit and delete', () => {
    const { container } = renderCard({
      currentUserId: 'seller-1',
      onEdit: vi.fn(),
      onDelete: vi.fn(),
    });
    expect(nestedInteractives(container)).toEqual([]);
  });

  it('exposes the business name as a real button, not a div with a role', () => {
    renderCard();
    const nameButton = screen.getByRole('button', { name: 'Nia Braids' });
    expect(nameButton.tagName).toBe('BUTTON');
    expect(nameButton.getAttribute('type')).toBe('button');
  });

  it('puts the card container out of the tab order and the controls in reading order', () => {
    const { container } = renderCard();
    const order = tabOrder(container);
    // Save (over the banner) sits visually above the name, so DOM order matches
    // what a sighted keyboard user sees moving down the card.
    expect(order[0]).toBe('Save');
    expect(order[1]).toBe('Nia Braids');
    expect(order).toContain('Message');
    // The container itself must not be tabbable: it is role="presentation" now.
    expect(container.querySelector('[role="button"][tabindex]')).toBeNull();
  });

  it('opens the listing exactly once when the name button is activated', () => {
    const { props } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Nia Braids' }));
    expect(props.onClick).toHaveBeenCalledTimes(1);
  });

  it('does not open the listing when a control inside the card is activated', () => {
    const { props } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(props.onToggleSave).toHaveBeenCalledTimes(1);
    expect(props.onClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Message' }));
    expect(props.onMessage).toHaveBeenCalledTimes(1);
    expect(props.onClick).not.toHaveBeenCalled();
  });

  it('no longer activates from a key event on the container', () => {
    const { props, container } = renderCard();
    const card = container.firstElementChild as HTMLElement;
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    // The container's keydown handler is gone; activation belongs to the name
    // button, which gets Enter and Space natively from the browser.
    expect(props.onClick).not.toHaveBeenCalled();
  });

  it('keeps the Instagram link a link, reachable and correctly attributed', () => {
    renderCard();
    const ig = screen.getByRole('link', { name: /instagram/i });
    expect(ig.getAttribute('href')).toBe('https://instagram.com/niabraids');
    expect(ig.getAttribute('rel')).toContain('noopener');
    expect(ig.closest('button')).toBeNull();
    // The handle is stored with its leading @ and the i18n key adds one, so this
    // used to announce "Instagram @@niabraids".
    expect(ig.getAttribute('aria-label')).toBe('Instagram @niabraids');
  });
});
