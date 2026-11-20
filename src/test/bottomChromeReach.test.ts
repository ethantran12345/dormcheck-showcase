import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Tripwires for "the control is on screen but the student cannot tap it".
 *
 * A live-browser reachability sweep (every button / link / input on every app
 * route at 390x844, 390x667 and 1280x900, each one scrolled into view and then
 * hit-tested with `document.elementFromPoint`) turned up three ways this app made
 * controls unreachable. All three are one-line CSS regressions that typecheck,
 * render, screenshot fine and are invisible to every other gate — the only
 * symptom is a student tapping a button that does nothing. Hence source-text
 * tripwires: they are blunt, but they fail loudly in exactly the spot where the
 * fix has to go back in.
 *
 *   1. TopNav's <nav> box spanned the full width of the top safe-area + h-12
 *      band at z-[1000] with default pointer-events, while painting only a
 *      gradient and a right-hand pill. It swallowed every tap in that band —
 *      the Messages back arrow was dead.
 *   2. The app shell reserved a hardcoded `4rem + safe-area` of bottom padding
 *      for a bar that actually measures ~90px, so the last rows of every
 *      scrolling page sat under it.
 *   3. DialogContent / AlertDialogContent had no height bound. A centred dialog
 *      is translated -50%, so a tall one grows off BOTH viewport edges and its
 *      footer actions leave the screen — at every width, not just on phones.
 *
 * Still open (deliberately not fixed here): on /housing and /subleases the Mapbox
 * logo link sits under the BottomNav pill. Lifting the control row by the bar
 * height just slides it under the route's own bottom sheet instead, so it needs a
 * layout decision about where map attribution lives, not a CSS nudge.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('top chrome does not swallow taps', () => {
  const SOURCE = read('src/components/TopNav.tsx');

  it('marks the fixed <nav> pointer-events-none', () => {
    const nav = SOURCE.match(/<nav className=\{cn\((.*?)\)\}>/s);
    expect(nav, 'TopNav root <nav> not found — update this test with the markup').not.toBeNull();
    expect(nav![1]).toContain('pointer-events-none');
  });

  it('re-arms pointer events on the md+ bar, which is a real surface', () => {
    expect(SOURCE).toMatch(/pointer-events-auto[^"']*md:block/);
  });

  it('keeps the mobile glass pill interactive', () => {
    expect(SOURCE).toMatch(/glass-chrome pointer-events-auto/);
  });
});

describe('the app shell reserves the measured bar height', () => {
  it('BottomNav publishes --dc-bottom-nav-h from a real measurement', () => {
    const SOURCE = read('src/components/BottomNav.tsx');
    expect(SOURCE).toContain('--dc-bottom-nav-h');
    expect(SOURCE).toContain('ResizeObserver');
  });

  it('App.tsx pads by that variable, not by a hardcoded bar height', () => {
    const SOURCE = read('src/App.tsx');
    const pad = SOURCE.match(/pb-\[calc\(var\(--keyboard-height,0px\)\+[^\]]*\]/);
    expect(pad, 'shell bottom padding not found — update this test with the markup').not.toBeNull();
    expect(pad![0]).toContain('var(--dc-bottom-nav-h');
  });

  it('reserves bottom-nav space only on routes that actually render the bar', () => {
    const SOURCE = read('src/App.tsx');
    const paddingGate = SOURCE.match(
      /showBottomNav\s*&&\s*!hideNativeBottomChrome\s*&&\s*!navHidden\s*&&\s*!isLeafRoute/,
    );
    expect(
      paddingGate,
      'a route without BottomNav must not receive its padding after first paint',
    ).not.toBeNull();
  });

  it('suppresses native top chrome synchronously on onboarding routes', () => {
    const SOURCE = read('src/App.tsx');
    const gate = SOURCE.slice(
      SOURCE.indexOf('const showNativeTopBar ='),
      SOURCE.indexOf('// BottomNav is app chrome'),
    );
    expect(gate).toContain('!pathname.startsWith("/onboarding")');
  });

  it('does not paint the site footer behind the fixed onboarding viewport', () => {
    const SOURCE = read('src/App.tsx');
    const gate = SOURCE.slice(
      SOURCE.indexOf('const showFooter ='),
      SOURCE.indexOf('return (', SOURCE.indexOf('const showFooter =')),
    );
    expect(gate).toContain('!isOnboardingPage');
  });
});

describe('centred overlays stay inside the viewport', () => {
  it.each([
    ['src/components/ui/dialog.tsx', 'DialogPrimitive.Content'],
    ['src/components/ui/alert-dialog.tsx', 'AlertDialogPrimitive.Content'],
  ])('%s bounds its height and scrolls', (file, marker) => {
    const SOURCE = read(file);
    const start = SOURCE.indexOf(marker);
    expect(start, `${marker} not found in ${file}`).toBeGreaterThan(-1);
    // The class string for the content element, up to the closing of its cn(...).
    const chunk = SOURCE.slice(start, start + 2400);
    expect(chunk, `${file}: unbounded height puts the footer actions off-screen`).toMatch(/max-h-\[calc\(100dvh/);
    expect(chunk, `${file}: bounded but not scrollable hides the overflow instead`).toContain('overflow-y-auto');
  });
});
