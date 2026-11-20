import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPlatform } = vi.hoisted(() => ({ getPlatform: vi.fn() }));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform },
}));

import {
  syncNativeGlassMoreMenu,
  syncNativeGlassTabBar,
  usesNativeGlassTabBar,
} from '@/lib/nativeGlassTabBar';

describe('native glass tab bar bridge', () => {
  const postMessage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getPlatform.mockReturnValue('ios');
    window.webkit = {
      messageHandlers: {
        dormcheckNativeGlassTabBar: { postMessage },
      },
    };
  });

  it('syncs route state through the iOS bridge', () => {
    syncNativeGlassTabBar({ visible: true, route: '/checklist' });

    expect(postMessage).toHaveBeenCalledWith({ visible: true, route: '/checklist' });
  });

  it('syncs the More menu without changing bar visibility or selection', () => {
    syncNativeGlassMoreMenu(true);

    expect(postMessage).toHaveBeenCalledWith({ menuOpen: true });
  });

  it('does not post native chrome state on web', () => {
    getPlatform.mockReturnValue('web');

    expect(usesNativeGlassTabBar()).toBe(false);
    syncNativeGlassMoreMenu(true);
    expect(postMessage).not.toHaveBeenCalled();
  });
});
