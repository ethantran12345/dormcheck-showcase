import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { NavSectionSwitcher } from '@/components/nav/NavSectionSwitcher';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({
    showHousing: true,
    showRoommates: true,
    // Subleases browse: true on web AND native since 2026-08-18, so the launcher
    // has no platform branch of its own to mock around.
    showBrowseSublease: true,
    showSchedule: true,
  }),
}));

const openSearch = vi.fn();
vi.mock('@/contexts/GlobalSearchContext', () => ({
  useGlobalSearch: () => ({ openSearch }),
}));

vi.mock('@/contexts/ModalOverlayContext', () => ({
  useModalOverlay: () => ({ setActionMenuOpen: vi.fn() }),
}));

describe('NavSectionSwitcher', () => {
  it('opens the compact action grid, moves focus inside, and closes with Escape', async () => {
    render(
      <MemoryRouter initialEntries={['/my-home']}>
        <NavSectionSwitcher />
      </MemoryRouter>,
    );

    const trigger = screen.getByRole('button', { name: 'misc:actionMenu.switchSection' });
    fireEvent.click(trigger);

    const menu = screen.getByRole('menu', { name: 'misc:actionMenu.switchSection' });
    expect(menu.className).toContain('w-[min(21.5rem,calc(100vw-2rem))]');
    expect(menu.querySelector('.grid-cols-3')).not.toBeNull();
    await waitFor(() => expect(screen.getAllByRole('menuitemradio')[0]).toHaveFocus());

    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('shows the focused ten-tile Home map (plus Search) without deferred destinations', () => {
    render(
      <MemoryRouter initialEntries={['/my-home']}>
        <NavSectionSwitcher />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'misc:actionMenu.switchSection' }));

    for (const label of [
      'misc:nav.dorms',
      'misc:nav.studentSetups',
      'misc:nav.subleases',
      'misc:nav.browseProfiles',
      'misc:nav.myRoommates',
      'misc:nav.myChecklist',
      'misc:nav.studentMarket',
      'misc:nav.shopEssentials',
      'misc:nav.schedule',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const label of ['misc:nav.moveIn', 'misc:nav.moveOut', 'misc:nav.community']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    // Ten place tiles + the Search tile (the palette's only door on phone/native).
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(11);
  });

  it('opens the command palette from the Search tile and hands focus back to the trigger', () => {
    openSearch.mockClear();
    render(
      <MemoryRouter initialEntries={['/my-home']}>
        <NavSectionSwitcher />
      </MemoryRouter>,
    );
    const trigger = screen.getByRole('button', { name: 'misc:actionMenu.switchSection' });
    fireEvent.click(trigger);
    const tiles = screen.getAllByRole('menuitemradio');
    const search = tiles.find((tile) => tile.textContent?.includes('misc:search.trigger'));
    // After every place tile, so none of them moves (Home's Customize still trails).
    expect(tiles.indexOf(search!)).toBe(tiles.length - 2);
    fireEvent.click(search!);
    expect(openSearch).toHaveBeenCalledWith({ returnFocusTo: trigger });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('has no Messages tile — the header icon is the one door', () => {
    // Messages sits in a PERMANENT header cluster on every shell (TopNav on
    // mobile web, NativeTopBar on native, AppShellTopRight on desktop). A tile
    // here made it the only destination in the launcher reachable two ways,
    // in a grid whose job is to be the map of places with no other door.
    render(
      <MemoryRouter initialEntries={['/my-home']}>
        <NavSectionSwitcher />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'misc:actionMenu.switchSection' }));
    expect(screen.queryByText('misc:nav.messages')).not.toBeInTheDocument();
  });
});
