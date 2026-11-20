import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Housing tab must mean housing.
 *
 * The bar remembers the last page you visited inside each tab's own cluster and
 * restores it on the next tap (`dormcheck_last_housing`). `/schedule` used to
 * count as part of the housing cluster, so one visit to My Schedule pinned the
 * store to `/schedule` and every later tap of the building icon opened the
 * schedule instead of the dorms list — permanently, until the student found
 * their own way back to a dorms route. Nothing failed; the tab just quietly
 * stopped being the way to the dorms.
 *
 * These are behavioural, not source-text: they drive the real component through
 * the real store, which is the only way to catch a re-coupling that compiles.
 */

const navigate = vi.fn();

// jsdom ships no ResizeObserver, and the bar mounts two of them (the sliding-pill
// measurement and the `--dc-bottom-nav-h` publisher). Neither is under test here;
// a no-op stub keeps them from throwing on mount.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', NoopResizeObserver);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({
    showHousing: true,
    showRoommates: true,
    showBrowseSublease: true,
    showSchedule: true,
  }),
}));

vi.mock('@/hooks/useKeyboardInset', () => ({ useKeyboardOpen: () => false }));

vi.mock('@/contexts/ScrollEngagementContext', () => ({
  useScrollEngagement: () => ({ engaged: false }),
}));

vi.mock('@/contexts/ModalOverlayContext', () => ({
  useModalOverlay: () => ({ setActionMenuOpen: vi.fn() }),
}));

vi.mock('@/components/nav/NavSectionSwitcher', () => ({
  NavSectionSwitcher: () => null,
}));

const { BottomNav } = await import('@/components/BottomNav');

const HOUSING_TAB = 'misc:nav.housing';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <BottomNav />
    </MemoryRouter>,
  );

const tapHousing = () => {
  const tab = screen.getAllByText(HOUSING_TAB)[0].closest('button');
  expect(tab, 'housing tab not found in the bar').not.toBeNull();
  fireEvent.click(tab!);
};

beforeEach(() => {
  navigate.mockClear();
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('the Housing tab always leads to housing', () => {
  it('does not remember /schedule as the housing destination', () => {
    renderAt('/schedule');
    // The WRITE side: being on /schedule must not pin the housing store.
    expect(localStorage.getItem('dormcheck_last_housing')).toBeNull();
  });

  it('still remembers a real housing page', () => {
    renderAt('/gallery');
    expect(localStorage.getItem('dormcheck_last_housing')).toBe('/gallery');
  });

  it('opens the dorms list even when /schedule is already stored', () => {
    // The READ side, and the migration for anyone carrying the old value: a
    // stored /schedule must fail validation and fall through to /housing rather
    // than being restored. No localStorage cleanup pass is needed anywhere.
    localStorage.setItem('dormcheck_last_housing', '/schedule');
    renderAt('/my-home');
    tapHousing();
    expect(navigate).toHaveBeenCalledWith('/housing');
  });

  it('restores a genuine housing page as before', () => {
    localStorage.setItem('dormcheck_last_housing', '/gallery');
    renderAt('/my-home');
    tapHousing();
    expect(navigate).toHaveBeenCalledWith('/gallery');
  });

  it('does not light the Housing tab up while on /schedule', () => {
    renderAt('/schedule');
    const tab = screen.getAllByText(HOUSING_TAB)[0].closest('button');
    expect(tab?.getAttribute('aria-current')).toBeNull();
  });

  it('still lights it up on a real housing route', () => {
    renderAt('/housing');
    const tab = screen.getAllByText(HOUSING_TAB)[0].closest('button');
    expect(tab?.getAttribute('aria-current')).toBe('page');
  });
});
