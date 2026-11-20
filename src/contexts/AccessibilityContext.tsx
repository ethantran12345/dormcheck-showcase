import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  applyReduceMotion,
  applyTextSize,
  getStoredReduceMotion,
  getStoredTextSize,
  getSystemReduceMotion,
  REDUCE_MOTION_STORAGE_KEY,
  resolveReduceMotion,
  TEXT_SIZE_STORAGE_KEY,
  type ReduceMotionPreference,
  type TextSize,
} from '@/lib/accessibility';

type AccessibilityContextValue = {
  /** The stored preference (may be 'system'). */
  reduceMotion: ReduceMotionPreference;
  /** Effective on/off after folding in the OS value — what the Switch shows. */
  reduceMotionResolved: boolean;
  setReduceMotion: (preference: ReduceMotionPreference) => void;
  textSize: TextSize;
  setTextSize: (size: TextSize) => void;
};

const AccessibilityContext = createContext<AccessibilityContextValue | null>(null);

/**
 * Reduce Motion + Text Size preferences, applied to <html> so both CSS and
 * framer-motion honor them app-wide. localStorage-backed (cross-tab synced).
 *
 * TODO(settings-R-later): optionally write-through to a `profiles.accessibility_prefs`
 * column so the choice follows the account across devices, mirroring the theme
 * precedent in ThemeContext. Deferred here to keep R5 migration-free; localStorage
 * is the source of truth for now.
 */
export function AccessibilityProvider({ children }: { children: ReactNode }) {
  const [reduceMotion, setReduceMotionState] = useState<ReduceMotionPreference>(getStoredReduceMotion);
  const [textSize, setTextSizeState] = useState<TextSize>(getStoredTextSize);
  const [systemReduceMotion, setSystemReduceMotion] = useState<boolean>(getSystemReduceMotion);

  const setReduceMotion = useCallback((next: ReduceMotionPreference) => {
    setReduceMotionState(next);
    localStorage.setItem(REDUCE_MOTION_STORAGE_KEY, next);
  }, []);

  const setTextSize = useCallback((next: TextSize) => {
    setTextSizeState(next);
    localStorage.setItem(TEXT_SIZE_STORAGE_KEY, next);
  }, []);

  useLayoutEffect(() => {
    applyReduceMotion(reduceMotion);
  }, [reduceMotion]);

  useLayoutEffect(() => {
    applyTextSize(textSize);
  }, [textSize]);

  // Track the OS Reduce Motion setting so a 'system' preference stays live.
  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setSystemReduceMotion(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  // Cross-tab sync: another tab changed a preference.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === REDUCE_MOTION_STORAGE_KEY) {
        if (e.newValue === 'on' || e.newValue === 'off' || e.newValue === 'system') {
          setReduceMotionState(e.newValue);
        }
      } else if (e.key === TEXT_SIZE_STORAGE_KEY) {
        if (e.newValue === 'default' || e.newValue === 'large' || e.newValue === 'larger') {
          setTextSizeState(e.newValue);
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const reduceMotionResolved = resolveReduceMotion(reduceMotion, systemReduceMotion);

  const value = useMemo(
    () => ({ reduceMotion, reduceMotionResolved, setReduceMotion, textSize, setTextSize }),
    [reduceMotion, reduceMotionResolved, setReduceMotion, textSize, setTextSize],
  );

  return <AccessibilityContext.Provider value={value}>{children}</AccessibilityContext.Provider>;
}

export function useAccessibility(): AccessibilityContextValue {
  const ctx = useContext(AccessibilityContext);
  if (!ctx) {
    throw new Error('useAccessibility must be used within AccessibilityProvider');
  }
  return ctx;
}
