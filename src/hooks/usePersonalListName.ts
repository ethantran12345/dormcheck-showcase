import { useCallback, useEffect, useState } from "react";

const NAME_STORAGE_PREFIX = "checklist_list_name_";

/** Default label for the (single) personal checklist when the user hasn't named it. */
export const DEFAULT_PERSONAL_LIST_NAME = "My Checklist";

function storageKey(userId: string): string {
  return `${NAME_STORAGE_PREFIX}${userId}`;
}

function readName(userId: string): string {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const trimmed = raw?.trim();
    return trimmed ? trimmed : DEFAULT_PERSONAL_LIST_NAME;
  } catch {
    return DEFAULT_PERSONAL_LIST_NAME;
  }
}

/**
 * localStorage-backed display name for the (single) personal checklist. Mirrors
 * the per-list budget pattern (`checklist_list_budget_<id>` in
 * ChecklistReadinessSummary): device-local, no migration, not synced across
 * devices. A synced name would be a one-column `profiles.personal_list_name`
 * add - flagged as an optional follow-up in the CHANGELOG, deliberately not
 * built here (the checklist-hub decision ships naming without a schema change).
 */
export function usePersonalListName(userId: string | null | undefined): {
  name: string;
  setName: (next: string) => void;
} {
  const [name, setNameState] = useState<string>(() =>
    userId ? readName(userId) : DEFAULT_PERSONAL_LIST_NAME,
  );

  useEffect(() => {
    setNameState(userId ? readName(userId) : DEFAULT_PERSONAL_LIST_NAME);
  }, [userId]);

  const setName = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      setNameState(trimmed || DEFAULT_PERSONAL_LIST_NAME);
      if (!userId) return;
      try {
        if (trimmed) localStorage.setItem(storageKey(userId), trimmed);
        else localStorage.removeItem(storageKey(userId));
      } catch {
        /* ignore quota / private mode */
      }
    },
    [userId],
  );

  return { name, setName };
}
