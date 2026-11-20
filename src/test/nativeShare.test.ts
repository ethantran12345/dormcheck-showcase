import { afterEach, describe, expect, it, vi } from 'vitest';
import { canShareContent, shareContent } from '@/lib/nativeShare';

const originalShare = navigator.share;

afterEach(() => {
  delete (window as { webkit?: unknown }).webkit;
  Object.defineProperty(navigator, 'share', { configurable: true, value: originalShare });
});

describe('nativeShare', () => {
  it('prefers the native iOS activity-sheet bridge over Web Share', async () => {
    const postMessage = vi.fn();
    const webShare = vi.fn();
    window.webkit = { messageHandlers: { dormcheckNativeShare: { postMessage } } };
    Object.defineProperty(navigator, 'share', { configurable: true, value: webShare });

    expect(canShareContent()).toBe(true);
    await expect(shareContent({ title: 'Dormcheck', text: 'Hello' })).resolves.toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ title: 'Dormcheck', text: 'Hello' });
    expect(webShare).not.toHaveBeenCalled();
  });

  it('uses Web Share outside the native shell', async () => {
    const webShare = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: webShare });

    await expect(shareContent({ text: 'Hello' })).resolves.toBe(true);
    expect(webShare).toHaveBeenCalledWith({ text: 'Hello' });
  });

  it('reports unavailable instead of pretending a share surface exists', async () => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    expect(canShareContent()).toBe(false);
    await expect(shareContent({ text: 'Hello' })).resolves.toBe(false);
  });
});
