import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { TOUR_COMPLETED_KEY, TOUR_PENDING_KEY, useTourSteps } from './tourSteps';

const ALLOWED_ROUTES = new Set(['/', '/campus', '/my-home', '/roommates', '/checklist', '/marketplace']);

function routeAllowsTour(pathname: string): boolean {
  if (ALLOWED_ROUTES.has(pathname)) return true;
  return pathname.startsWith('/campus/');
}

function readLocalFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeLocalFlag(key: string, value: '1' | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode / disabled storage */
  }
}

interface UseTourResult {
  isActive: boolean;
  stepIndex: number;
  totalSteps: number;
  next: () => void;
  prev: () => void;
  finish: () => void;
}

/**
 * Re-arm the tour (e.g. "Replay app tour" in Settings → Support): clears the
 * completed flag and sets pending so the next allowed route activates it.
 */
export function restartTour(): void {
  writeLocalFlag(TOUR_COMPLETED_KEY, null);
  writeLocalFlag(TOUR_PENDING_KEY, '1');
}

/**
 * Tour activation rules:
 *  - `dormcheck_tour_completed === '1'` → never activate.
 *  - When the user first lands on `/` or `/campus(/*)` with `dormcheck_tour_pending === '1'`,
 *    consume the pending flag and activate the tour.
 *  - If the user completes onboarding then navigates elsewhere first (e.g. `/roommates`),
 *    the pending flag stays set until they reach an allowed route - so the tour survives
 *    detours and refreshes until it actually starts.
 *  - On finish or skip, `completed = '1'` is written so it never reappears.
 */
export function useTour(): UseTourResult {
  const { pathname } = useLocation();
  const tourSteps = useTourSteps();
  const [isActive, setIsActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (isActive) return;
    if (!routeAllowsTour(pathname)) return;
    if (readLocalFlag(TOUR_COMPLETED_KEY)) return;
    if (!readLocalFlag(TOUR_PENDING_KEY)) return;
    writeLocalFlag(TOUR_PENDING_KEY, null);
    setStepIndex(0);
    setIsActive(true);
  }, [pathname, isActive]);

  const finish = useCallback(() => {
    writeLocalFlag(TOUR_COMPLETED_KEY, '1');
    setIsActive(false);
  }, []);

  const next = useCallback(() => {
    setStepIndex((i) => {
      if (i >= tourSteps.length - 1) {
        writeLocalFlag(TOUR_COMPLETED_KEY, '1');
        setIsActive(false);
        return i;
      }
      return i + 1;
    });
  }, [tourSteps.length]);

  const prev = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  return {
    isActive,
    stepIndex,
    totalSteps: tourSteps.length,
    next,
    prev,
    finish,
  };
}
