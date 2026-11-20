import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Tracks completed step ids for a logistics checklist (move-in / move-out),
 * keyed by `listKey`. localStorage-first for instant render and offline use,
 * with a `user_logistics_progress` row layered on top for cross-device sync.
 *
 * Deploy-order safe: if the table doesn't exist yet (migration not pushed), the
 * DB read/write quietly no-op and localStorage carries the state - so this works
 * before AND after `20260623020000_user_logistics_progress.sql` lands.
 */
export function useLogisticsProgress(listKey: string) {
  const { user } = useAuth();
  const storageKey = user ? `dormcheck_logistics_${listKey}_${user.id}` : null;
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());

  // 1) Instant: hydrate from localStorage.
  useEffect(() => {
    if (!storageKey) {
      setDoneIds(new Set());
      return;
    }
    try {
      const raw = localStorage.getItem(storageKey);
      setDoneIds(raw ? new Set(JSON.parse(raw) as string[]) : new Set());
    } catch {
      setDoneIds(new Set());
    }
  }, [storageKey]);

  // 2) Sync: overlay the DB row if present (cross-device). Missing table / no
  //    row / any error → keep the localStorage value.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('user_logistics_progress')
        .select('done_ids')
        .eq('user_id', user.id)
        .eq('list_key', listKey)
        .maybeSingle();
      if (cancelled || error || !data?.done_ids) return;
      const dbSet = new Set(data.done_ids as string[]);
      setDoneIds(dbSet);
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify([...dbSet]));
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, listKey, storageKey]);

  const toggle = useCallback(
    (id: string) => {
      setDoneIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        const arr = [...next];
        // localStorage is the source of truth that always succeeds.
        if (storageKey) {
          try {
            localStorage.setItem(storageKey, JSON.stringify(arr));
          } catch {
            /* ignore */
          }
        }
        // Best-effort DB upsert for cross-device sync; errors are non-fatal
        // (table may not exist yet, or the user is offline).
        if (user) {
          void supabase
            .from('user_logistics_progress')
            .upsert(
              { user_id: user.id, list_key: listKey, done_ids: arr },
              { onConflict: 'user_id,list_key' },
            )
            .then(() => undefined, () => undefined);
        }
        return next;
      });
    },
    [storageKey, user, listKey],
  );

  return { doneIds, toggle };
}
