import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const isNative = vi.fn(() => false);
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => isNative() } }));

import {
  canViewTransition,
  popAlreadyAnimated,
  runViewTransition,
  runningViewTransition,
  shouldTransitionRoute,
} from '@/lib/viewTransition';

type StartVT = (cb: () => void) => { finished: Promise<void> };
const doc = document as unknown as { startViewTransition?: StartVT };
const realMatchMedia = window.matchMedia;

function setMedia(matches: (q: string) => boolean) {
  window.matchMedia = ((query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

describe('shouldTransitionRoute', () => {
  it('transitions only between top-level sections', () => {
    expect(shouldTransitionRoute('/checklist', '/marketplace')).toBe(true);
    expect(shouldTransitionRoute('/my-home', '/messages')).toBe(true);
    expect(shouldTransitionRoute('/marketplace', '/marketplace/my-items')).toBe(false);
    expect(shouldTransitionRoute('/marketplace', '/marketplace')).toBe(false);
  });

  it('leaves sheet routes to their own sheet motion', () => {
    expect(shouldTransitionRoute('/checklist', '/settings')).toBe(false);
    expect(shouldTransitionRoute('/settings', '/checklist')).toBe(false);
    expect(shouldTransitionRoute('/marketplace', '/marketplace/create')).toBe(false);
  });
});

describe('popAlreadyAnimated', () => {
  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it('trusts hasUAVisualTransition when the browser reports it', () => {
    setMedia(() => true);
    const swipe = new PopStateEvent('popstate');
    Object.defineProperty(swipe, 'hasUAVisualTransition', { value: true });
    window.dispatchEvent(swipe);
    expect(popAlreadyAnimated('POP')).toBe(true);
    expect(popAlreadyAnimated('PUSH')).toBe(false);

    const button = new PopStateEvent('popstate');
    Object.defineProperty(button, 'hasUAVisualTransition', { value: false });
    window.dispatchEvent(button);
    expect(popAlreadyAnimated('POP')).toBe(false);
  });

  it('assumes a swipe on touch when the flag is not reported', () => {
    setMedia((q) => q.includes('coarse'));
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(popAlreadyAnimated('POP')).toBe(true);
    setMedia(() => false);
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(popAlreadyAnimated('POP')).toBe(false);
  });
});

describe('runViewTransition', () => {
  let resolveFinished: () => void;
  const start = vi.fn<StartVT>((cb) => {
    cb();
    return { finished: new Promise<void>((r) => (resolveFinished = r)) };
  });

  beforeEach(() => {
    isNative.mockReturnValue(false);
    setMedia(() => false);
    document.documentElement.className = '';
    doc.startViewTransition = start;
    start.mockClear();
  });
  afterEach(() => {
    delete doc.startViewTransition;
    window.matchMedia = realMatchMedia;
    document.documentElement.className = '';
  });

  it('runs the update inside the transition and releases state when it settles', async () => {
    const update = vi.fn();
    const cleanup = vi.fn();
    runViewTransition('route', update, cleanup);
    expect(start).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.viewTransition).toBe('route');
    expect(runningViewTransition()).toBe('route');
    // A second transition while one runs falls through to a plain update.
    const second = vi.fn();
    runViewTransition('route', second);
    expect(start).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();

    resolveFinished();
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
    expect(document.documentElement.dataset.viewTransition).toBeUndefined();
    expect(runningViewTransition()).toBeNull();
  });

  it('is fully off (plain update, no transition) for reduced motion, native, and unsupported browsers', () => {
    const cases: [string, () => void][] = [
      ['OS reduced motion', () => setMedia((q) => q.includes('reduce'))],
      ['in-app Reduce Motion', () => document.documentElement.classList.add('reduce-motion')],
      ['native shell', () => isNative.mockReturnValue(true)],
      ['no View Transitions API', () => delete doc.startViewTransition],
    ];
    for (const [label, arrange] of cases) {
      arrange();
      const update = vi.fn();
      const cleanup = vi.fn();
      expect(canViewTransition(), label).toBe(false);
      runViewTransition('listing-open', update, cleanup);
      expect(update, label).toHaveBeenCalledOnce();
      expect(cleanup, label).toHaveBeenCalledOnce();
      expect(start, label).not.toHaveBeenCalled();
      // reset for the next case
      isNative.mockReturnValue(false);
      setMedia(() => false);
      document.documentElement.className = '';
      doc.startViewTransition = start;
    }
  });

  it('honours the in-app override that opts back in despite the OS setting', () => {
    setMedia((q) => q.includes('reduce'));
    document.documentElement.classList.add('motion-safe-override');
    expect(canViewTransition()).toBe(true);
  });
});
