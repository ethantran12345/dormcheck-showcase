import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAcademicTerms, nextTermAfter, termForDate } from '@/lib/academicTerms';
import { useUniversity } from '@/contexts/UniversityContext';
import { useAuth } from '@/hooks/useAuth';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Move-out becomes "in season" this many days before the move-out date. */
export const MOVE_OUT_SEASON_WINDOW_DAYS = 42;

/** Parse 'YYYY-MM-DD' at local midnight (avoids UTC off-by-one). */
function parseIsoDateLocal(iso: string | null): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function localMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * The student's move-out date: their own override if they set one (stored per
 * user in localStorage), otherwise the end of the current academic term - or,
 * between terms (summer), the end of the next term. Drives seasonal gating of
 * the Move-Out tab and the real dates on its checklist deadlines.
 */
export function useMoveOutDate() {
  const { university } = useUniversity();
  const { user } = useAuth();

  const storageKey = user ? `dormcheck_moveout_date_${user.id}` : null;
  const [userDateIso, setUserDateIso] = useState<string | null>(null);

  useEffect(() => {
    if (!storageKey) {
      setUserDateIso(null);
      return;
    }
    try {
      setUserDateIso(localStorage.getItem(storageKey));
    } catch {
      setUserDateIso(null);
    }
  }, [storageKey]);

  const setUserDate = useCallback(
    (iso: string | null) => {
      setUserDateIso(iso);
      if (!storageKey) return;
      try {
        if (iso) localStorage.setItem(storageKey, iso);
        else localStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );

  const { data: terms = [] } = useQuery({
    queryKey: ['academic_terms', university.id],
    queryFn: () => fetchAcademicTerms(university.id),
    staleTime: 24 * 60 * 60 * 1000,
  });

  return useMemo(() => {
    const today = localMidnight(new Date());
    const currentTerm = termForDate(terms, today);
    const upcomingTerm = nextTermAfter(terms, today);
    const term = currentTerm ?? upcomingTerm;

    const userDate = parseIsoDateLocal(userDateIso);
    const termDate = parseIsoDateLocal(term?.ends_at ?? null);
    const moveOutDate = userDate ?? termDate;

    const daysUntil =
      moveOutDate !== null
        ? Math.round((moveOutDate.getTime() - today.getTime()) / MS_PER_DAY)
        : null;

    // In season inside the run-up window (and through the week after, for
    // stragglers). Unknown date = in season, so missing term data never hides
    // the checklist from someone who needs it.
    const inSeason =
      daysUntil === null || (daysUntil <= MOVE_OUT_SEASON_WINDOW_DAYS && daysUntil >= -7);

    return {
      moveOutDate,
      daysUntil,
      inSeason,
      source: userDate ? ('user' as const) : termDate ? ('term' as const) : null,
      termName: !userDate ? (term?.name ?? null) : null,
      setUserDate,
    };
  }, [terms, userDateIso, setUserDate]);
}
