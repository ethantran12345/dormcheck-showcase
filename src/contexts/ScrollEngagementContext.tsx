import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useScrollEngaged } from '@/hooks/useScrollEngaged';

interface ScrollEngagementValue {
  /** True while content is scrolled under the nav chrome (past the threshold). */
  engaged: boolean;
  /**
   * Register the element that actually scrolls on the current page. Pass `null` to fall
   * back to `window` scroll (the default for document-level pages). Pages with an internal
   * scroll container (e.g. the housing explore list) register their element on mount and
   * unregister on unmount.
   */
  registerScrollTarget: (el: HTMLElement | null) => void;
}

const ScrollEngagementContext = createContext<ScrollEngagementValue | null>(null);

export function ScrollEngagementProvider({ children }: { children: ReactNode }) {
  const [targetEl, setTargetEl] = useState<HTMLElement | null>(null);
  const engaged = useScrollEngaged(24, targetEl);
  const value = useMemo<ScrollEngagementValue>(
    () => ({ engaged, registerScrollTarget: setTargetEl }),
    [engaged],
  );
  return (
    <ScrollEngagementContext.Provider value={value}>{children}</ScrollEngagementContext.Provider>
  );
}

/** Consume scroll-engaged state. Safe outside the provider (returns a stable no-op default). */
export function useScrollEngagement(): ScrollEngagementValue {
  return useContext(ScrollEngagementContext) ?? NOOP_VALUE;
}

const NOOP_VALUE: ScrollEngagementValue = { engaged: false, registerScrollTarget: () => {} };
