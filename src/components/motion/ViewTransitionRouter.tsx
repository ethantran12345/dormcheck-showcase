import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Router, UNSAFE_createBrowserHistory } from 'react-router';
import { popAlreadyAnimated, runViewTransition, shouldTransitionRoute } from '@/lib/viewTransition';

type BrowserHistory = ReturnType<typeof UNSAFE_createBrowserHistory>;
type HistoryUpdate = Parameters<Parameters<BrowserHistory['listen']>[0]>[0];

/**
 * `<BrowserRouter>`, plus a view transition when the top-level section changes.
 *
 * Why the router and not each call site: a route change arrives from links,
 * `navigate()`, back/forward and push taps alike, and every one of them funnels
 * through this single `history.listen`. Wrapping the state update here is the
 * only place that covers all of them, and the only place the "before" frame
 * still exists to be snapshotted. This is the same history + `<Router>` pair
 * `BrowserRouter` builds internally (react-router's declarative mode has no
 * view-transition hook of its own; `viewTransition` on `<Link>` is data-router
 * only). Everything that is not a top-level section change, or any browser that
 * cannot animate, takes the plain `setState` path, i.e. exactly BrowserRouter.
 */
export function ViewTransitionBrowserRouter({ children }: { children: ReactNode }) {
  const historyRef = useRef<BrowserHistory | null>(null);
  if (historyRef.current === null) {
    historyRef.current = UNSAFE_createBrowserHistory({ v5Compat: true });
  }
  const history = historyRef.current;
  const [state, setState] = useState<Pick<HistoryUpdate, 'action' | 'location'>>({
    action: history.action,
    location: history.location,
  });
  const pathnameRef = useRef(state.location.pathname);
  pathnameRef.current = state.location.pathname;

  useLayoutEffect(
    () =>
      history.listen((update) => {
        const next = { action: update.action, location: update.location };
        if (
          shouldTransitionRoute(pathnameRef.current, update.location.pathname) &&
          !popAlreadyAnimated(update.action)
        ) {
          runViewTransition('route', () => setState(next));
        } else {
          setState(next);
        }
      }),
    [history],
  );

  return (
    <Router location={state.location} navigationType={state.action} navigator={history}>
      {children}
    </Router>
  );
}
