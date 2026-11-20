import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';

interface Ctx {
  heartClickOverride: (() => void) | null;
  registerHeartClickOverride: (fn: (() => void) | null) => void;
  heartOverrideActive: boolean;
  setHeartOverrideActive: (active: boolean) => void;
  /** null = unknown; do not gate NavSavedHeart visibility. */
  savedCount: number | null;
  setSavedCount: (count: number | null) => void;
}

const HousingSavedContext = createContext<Ctx | null>(null);

export function HousingSavedProvider({ children }: { children: ReactNode }) {
  const [heartClickOverride, setHeartClickOverride] = useState<(() => void) | null>(null);
  const [heartOverrideActive, setHeartOverrideActiveState] = useState(false);
  const [savedCount, setSavedCountState] = useState<number | null>(null);
  const registerHeartClickOverride = useCallback(
    (fn: (() => void) | null) => setHeartClickOverride(() => fn),
    [],
  );
  const setHeartOverrideActive = useCallback(
    (active: boolean) => setHeartOverrideActiveState(active),
    [],
  );
  const setSavedCount = useCallback(
    (count: number | null) => setSavedCountState(count),
    [],
  );

  const value = useMemo(
    () => ({
      heartClickOverride,
      registerHeartClickOverride,
      heartOverrideActive,
      setHeartOverrideActive,
      savedCount,
      setSavedCount,
    }),
    [
      heartClickOverride,
      registerHeartClickOverride,
      heartOverrideActive,
      setHeartOverrideActive,
      savedCount,
      setSavedCount,
    ],
  );

  return (
    <HousingSavedContext.Provider value={value}>
      {children}
    </HousingSavedContext.Provider>
  );
}

export function useHousingSaved() {
  return useContext(HousingSavedContext);
}
