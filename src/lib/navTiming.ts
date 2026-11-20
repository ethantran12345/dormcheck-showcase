/**
 * Navigation timing probe — how long a tab tap takes to put content on screen.
 *
 * This exists because "the app feels slow" is not actionable and the two
 * plausible causes need opposite fixes. Time is spent either (a) fetching the
 * route's JS chunk and rendering the shell, or (b) waiting on data after the
 * page has already mounted. Prefetching only ever helps (a); caching only ever
 * helps (b). Measuring the split tells us which one we are actually paying.
 *
 * What is measured: the moment the pathname changes, to the first frame painted
 * after the new route's element commits. That covers chunk resolution + first
 * render, and deliberately does NOT cover data — a page that renders its own
 * skeleton in 20ms and then sits on a spinner for 900ms will report 20ms here,
 * and that gap between the number and the feel is exactly the signal that the
 * remaining cost is data, not code.
 *
 * Off by default so it costs nothing in production. Turn it on from a device
 * console (Safari Web Inspector against the WKWebView works) with:
 *   localStorage.setItem('dc:navtiming', '1')
 * and read the rolling log any time with `window.__dcNavTiming`.
 */

export type NavSample = {
  path: string;
  /** ms from pathname change to the first painted frame of the new route. */
  ms: number;
};

const MAX_SAMPLES = 50;

const samples: NavSample[] = [];
let pending: { path: string; startedAt: number } | null = null;

function enabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("dc:navtiming") === "1";
  } catch {
    // Private mode / disabled storage — never let a probe throw into a render.
    return false;
  }
}

/** Call the instant the pathname changes, before the new route renders. */
export function markNavStart(path: string): void {
  if (!enabled()) return;
  pending = { path, startedAt: performance.now() };
}

/**
 * Call once the new route has committed. Uses a double rAF so the number
 * includes the frame the browser actually painted, not just React's commit —
 * a commit that takes 3ms but paints 200ms later is still 200ms of feel.
 */
export function markNavReady(path: string): void {
  if (!enabled() || !pending || pending.path !== path) return;
  const { startedAt } = pending;
  pending = null;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const sample: NavSample = { path, ms: Math.round(performance.now() - startedAt) };
      samples.push(sample);
      if (samples.length > MAX_SAMPLES) samples.shift();
      // eslint-disable-next-line no-console -- probe is off unless dc:navtiming is set (enabled()).
      console.debug(`[navTiming] ${sample.path} ${sample.ms}ms`);
    });
  });
}

/** Everything recorded this session, oldest first. */
export function getNavSamples(): readonly NavSample[] {
  return samples;
}

if (typeof window !== "undefined") {
  (window as unknown as { __dcNavTiming: () => readonly NavSample[] }).__dcNavTiming =
    getNavSamples;
}
