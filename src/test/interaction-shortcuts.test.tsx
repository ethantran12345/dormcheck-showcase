import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The provider's dialogs are lazy; stand them in with markers so this test is
// about WHEN they open, not what they render.
vi.mock('@/components/search/GlobalSearchDialog', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="palette" /> : null),
}));
vi.mock('@/components/shortcuts/ShortcutsSheet', () => ({
  ShortcutsSheet: ({ open }: { open: boolean }) => (open ? <div data-testid="shortcuts-sheet" /> : null),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/contexts/AdminUniversityContext', () => ({
  useAdminUniversitySilo: () => ({ effectiveIsAdmin: false }),
}));
const isNative = vi.fn(() => false);
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => isNative() } }));

import { GlobalSearchProvider } from '@/contexts/GlobalSearchContext';

const realMatchMedia = window.matchMedia;
function pointer(fine: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: fine,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

async function press(key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    fireEvent.keyDown(window, { key, ...init });
  });
}

describe('GlobalSearchProvider keyboard', () => {
  beforeEach(() => {
    isNative.mockReturnValue(false);
    pointer(true);
  });
  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it('opens the shortcuts sheet on "?" with a desktop pointer', async () => {
    render(<GlobalSearchProvider><button type="button">page</button></GlobalSearchProvider>);
    await press('?', { shiftKey: true });
    expect(await screen.findByTestId('shortcuts-sheet')).toBeInTheDocument();
  });

  it('ignores "?" on touch and in the native shell, where no hint ever showed it', async () => {
    pointer(false);
    const { unmount } = render(<GlobalSearchProvider><span /></GlobalSearchProvider>);
    await press('?', { shiftKey: true });
    expect(screen.queryByTestId('shortcuts-sheet')).not.toBeInTheDocument();
    unmount();

    pointer(true);
    isNative.mockReturnValue(true);
    render(<GlobalSearchProvider><span /></GlobalSearchProvider>);
    await press('?', { shiftKey: true });
    expect(screen.queryByTestId('shortcuts-sheet')).not.toBeInTheDocument();
  });

  it('leaves "?" alone while typing', async () => {
    render(
      <GlobalSearchProvider>
        <input aria-label="message" />
      </GlobalSearchProvider>,
    );
    const input = screen.getByLabelText('message');
    await act(async () => {
      fireEvent.keyDown(input, { key: '?', shiftKey: true });
    });
    expect(screen.queryByTestId('shortcuts-sheet')).not.toBeInTheDocument();
  });

  it('opens the palette on the registry chord', async () => {
    render(<GlobalSearchProvider><span /></GlobalSearchProvider>);
    await press('k', { metaKey: true });
    expect(await screen.findByTestId('palette')).toBeInTheDocument();
  });
});
