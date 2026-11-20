import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { TablesInsert, TablesUpdate } from '@/integrations/supabase/types';
import { ChecklistItem, type ChecklistItemStatus } from '@/types';
import { useAuth } from '@/hooks/useAuth';
import { useAnalytics } from '@/hooks/useAnalytics';
import { toast } from 'sonner';
import i18n from '@/i18n';
import { DORM_TEMPLATE, APARTMENT_TEMPLATE, CUSTOM_HEADERS } from '@/constants/defaults';
import { isAmazonAffiliateUrl } from '@/lib/amazonAffiliateUrl';
import { runRowWrites } from '@/lib/batchedWrites';
import { findAttachableNeedRow } from '@/components/checklist/checklistHelpers';

function normalizeChecklistItemName(name: string): string {
  return name.trim().toLowerCase();
}

/** PostgREST error when `checklist_items.image_url` exists in types but not in DB (or schema cache stale). */
function isChecklistItemsImageUrlSchemaError(message: string | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes('image_url') &&
    m.includes('checklist_items') &&
    (m.includes('schema cache') || m.includes('does not exist') || m.includes('could not find'))
  );
}

/** Personal (null) vs group lists, or two different group_ids - same list is excluded. */
function isDistinctChecklistScope(
  rowGroupId: string | null | undefined,
  sourceGroupId: string | null | undefined,
): boolean {
  const a = rowGroupId ?? null;
  const b = sourceGroupId ?? null;
  return a !== b;
}

/**
 * Mirror status + is_checked to other checklist_items for the same user when the item name
 * matches (trimmed, case-insensitive) on a different list. Failures are logged only.
 */
async function syncMatchingChecklistItemStatus(params: {
  userId: string;
  sourceId: string;
  sourceName: string;
  sourceGroupId: string | null | undefined;
  status: ChecklistItemStatus;
  isChecked: boolean;
}): Promise<void> {
  const key = normalizeChecklistItemName(params.sourceName);
  if (!key) return;

  try {
    const { data, error: selErr } = await supabase
      .from('checklist_items')
      .select('id, item, group_id')
      .eq('user_id', params.userId)
      .neq('id', params.sourceId);

    if (selErr) throw selErr;

    const rows = (data ?? []) as { id: string; item: string; group_id: string | null }[];
    const ids = rows
      .filter(
        (r) =>
          normalizeChecklistItemName(r.item) === key &&
          isDistinctChecklistScope(r.group_id, params.sourceGroupId),
      )
      .map((r) => r.id);

    if (ids.length === 0) return;

    const { error: upErr } = await supabase
      .from('checklist_items')
      .update({
        status: params.status,
        is_checked: params.isChecked,
      })
      .in('id', ids);

    if (upErr) throw upErr;
  } catch (err) {
    console.error('syncMatchingChecklistItemStatus error:', err);
  }
}

export type UseChecklistOptions = {
  /** When the main list is personal (`selectedGroupId` null), load these group item names for cross-list indicators. */
  pairedGroupIdWhenPersonal?: string | null;
};

/** Normalize a raw checklist_items.status (free-text/RPC-widened) to the typed union. */
function normalizeChecklistStatus(status: unknown, isChecked: unknown): ChecklistItemStatus {
  if (status === 'need' || status === 'bought' || status === 'packed' || status === 'skip') {
    return status;
  }
  return isChecked ? 'packed' : 'need';
}

/**
 * What the server has told us about the current list, kept apart from `loading`
 * (which only drives skeletons and is forced off by the 3s fetch guards):
 * - `pending`: no answer yet for this scope.
 * - `ready`: a fetch succeeded, so `items` is the truth (empty means empty).
 * - `unavailable`: the first fetch timed out or failed, so `items` proves nothing.
 * A late answer after a timeout still moves `unavailable` to `ready`.
 */
export type ChecklistListState = 'pending' | 'ready' | 'unavailable';

/**
 * Whether ChecklistPage may open the first-run "Start Your Essentials List" sheet.
 * Only a personal list the server has confirmed empty qualifies.
 */
export function shouldOfferChecklistFirstRun(s: {
  listState: ChecklistListState;
  loading: boolean;
  totalItems: number;
  isGroupContext: boolean;
  signedIn: boolean;
  onboardingCompleted: boolean;
}): boolean {
  return (
    s.listState === 'ready' &&
    !s.loading &&
    s.totalItems === 0 &&
    !s.isGroupContext &&
    s.signedIn &&
    !s.onboardingCompleted
  );
}

export function useChecklist(selectedGroupId?: string | null, options?: UseChecklistOptions) {
  const { user } = useAuth();
  const { trackAction } = useAnalytics();
  const pairedGroupIdWhenPersonal = options?.pairedGroupIdWhenPersonal ?? null;
  const [items, setItems] = useState<ChecklistItem[]>([]);
  /** Normalized item names (trim + lower) on the list opposite the one currently shown. */
  const [otherListItemNames, setOtherListItemNames] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [listState, setListState] = useState<ChecklistListState>('pending');
  const [linkFetchingId, setLinkFetchingId] = useState<string | null>(null);
  const isResettingRef = useRef(false);
  const isSavingRef = useRef(false);
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** First non-silent fetch for this checklist scope; reset when group or user changes. */
  const checklistFetchOnceRef = useRef(false);
  /**
   * Stable section order: only updated when data is fetched from the DB or sections are
   * explicitly reordered/renamed. Never recalculated from item order_index during drags.
   */
  const [sectionOrderState, setSectionOrderState] = useState<string[]>([]);

  const FETCH_TIMEOUT_MS = 3000;

  /** Per-mount guard so each milestone probes the server at most once per session. */
  const milestoneClaimedRef = useRef<{ started: boolean; completed: boolean }>({
    started: false,
    completed: false,
  });

  /**
   * Funnel milestones (personal checklist only): set `profiles.checklist_started_at`
   * / `checklist_completed_at` once via a null-guarded conditional update, and fire
   * the analytics event only when this call actually claimed the milestone (a row
   * came back). Server-side null guard makes this once-only across devices/mounts;
   * completion is never un-set. Failures are logged only - never breaks the flow.
   */
  const claimChecklistMilestone = useCallback(
    async (
      milestone: 'started' | 'completed',
      eventName: string,
      properties: Record<string, unknown>,
    ) => {
      if (!user) return;
      if (milestoneClaimedRef.current[milestone]) return;
      milestoneClaimedRef.current[milestone] = true;
      const column = milestone === 'started' ? 'checklist_started_at' : 'checklist_completed_at';
      const now = new Date().toISOString();
      try {
        const { data, error } = await supabase
          .from('profiles')
          .update(
            milestone === 'started'
              ? { checklist_started_at: now }
              : { checklist_completed_at: now },
          )
          .eq('id', user.id)
          .is(column, null)
          .select('id');
        if (error) throw error;
        if ((data ?? []).length > 0) {
          await trackAction(eventName, properties);
        }
      } catch (err) {
        console.error(`claimChecklistMilestone(${milestone}) error:`, err);
        // Allow a retry on the next trigger - the milestone wasn't persisted.
        milestoneClaimedRef.current[milestone] = false;
      }
    },
    [user, trackAction],
  );

  /**
   * Stop the skeleton without claiming the list is empty: a fetch still in flight
   * (or never answered) leaves the scope `unavailable` until a real answer lands.
   */
  const stopLoadingWithoutAnswer = useCallback(() => {
    setLoading(false);
    setListState((s) => (s === 'pending' ? 'unavailable' : s));
  }, []);

  /** Infinite loop guard: force loading false if fetch hangs beyond 3s (not during reset) */
  useEffect(() => {
    if (!loading || isResettingRef.current) return;
    const guard = setTimeout(stopLoadingWithoutAnswer, FETCH_TIMEOUT_MS);
    return () => clearTimeout(guard);
  }, [loading, stopLoadingWithoutAnswer]);

  useEffect(() => {
    checklistFetchOnceRef.current = false;
    setListState('pending');
  }, [selectedGroupId, user?.id]);

  const fetchOtherListItemNames = useCallback(async () => {
    if (!user) {
      setOtherListItemNames(new Set());
      return;
    }
    try {
      if (selectedGroupId) {
        const { data, error } = await supabase
          .from('checklist_items')
          .select('item')
          .eq('user_id', user.id)
          .is('group_id', null);
        if (error) throw error;
        const next = new Set<string>();
        for (const row of data ?? []) {
          const k = normalizeChecklistItemName((row as { item: string }).item);
          if (k) next.add(k);
        }
        setOtherListItemNames(next);
      } else {
        const gid = pairedGroupIdWhenPersonal;
        if (!gid) {
          setOtherListItemNames(new Set());
          return;
        }
        const { data, error } = await supabase.rpc('get_group_checklist', {
          query_group_id: gid,
        });
        if (error) {
          setOtherListItemNames(new Set());
          return;
        }
        const raw = data == null ? [] : Array.isArray(data) ? data : [];
        const next = new Set<string>();
        for (const row of raw) {
          const k = normalizeChecklistItemName((row as { item: string }).item);
          if (k) next.add(k);
        }
        setOtherListItemNames(next);
      }
    } catch {
      setOtherListItemNames(new Set());
    }
  }, [user, selectedGroupId, pairedGroupIdWhenPersonal]);

  const fetchItems = useCallback(async (options?: { silent?: boolean }) => {
    if (!user) return;
    if (!options?.silent && !checklistFetchOnceRef.current) {
      setLoading(true);
    }
    const timeoutId = options?.silent ? null : setTimeout(stopLoadingWithoutAnswer, FETCH_TIMEOUT_MS);
    try {
      if (selectedGroupId) {
        const { data, error } = await supabase
          .rpc('get_group_checklist', { query_group_id: selectedGroupId });
        if (error) {
          console.warn('[get_group_checklist] RPC error:', {
            code: error.code,
            message: error.message,
            details: error.details,
          });

          // Wait for acceptance: verify membership before falling back.
          const { data: membership, error: membershipErr } = await supabase
            .from('ranking_group_members')
            .select('status')
            .eq('group_id', selectedGroupId)
            .eq('user_id', user.id)
            .maybeSingle();

          if (!membershipErr && membership?.status !== 'accepted') {
            // User hasn't accepted yet or invite was withdrawn – keep current items and surface a soft message.
            setListState((s) => (s === 'ready' ? s : 'unavailable'));
            toast('Waiting for group access', {
              description:
                'You have a pending invitation for this group. Accept it to see the shared checklist.',
            });
            return;
          }

          toast.error('Error loading group items', {
            description: error?.message || error?.details || 'Could not load group items.',
          });
          if (!checklistFetchOnceRef.current) {
            setItems([]);
            setSectionOrderState([]);
          }
          setListState((s) => (s === 'ready' ? s : 'unavailable'));
        } else {
          const raw = data == null ? [] : Array.isArray(data) ? data : [];
          // get_group_checklist returns checklist_items (*). Normalize nullable fields for UI.
          const safe = raw.map((row) => ({
            ...row,
            order_index: row.order_index != null ? Number(row.order_index) : (row.position != null ? Number(row.position) : 0),
            description: row.description ?? null,
            link: row.link ?? null,
            link_title: row.link_title ?? null,
            link_image: row.link_image ?? null,
            image_url: row.image_url ?? null,
            estimated_price: row.estimated_price != null ? Number(row.estimated_price) : 0,
            split_cost: row.split_cost != null ? Boolean(row.split_cost) : true,
            split_participant_ids: Array.isArray(row.split_participant_ids)
              ? row.split_participant_ids.map((x) => String(x))
              : null,
            split_percentages:
              row.split_percentages && typeof row.split_percentages === 'object'
                ? (Object.fromEntries(
                    Object.entries(row.split_percentages).map(([k, v]) => [k, Number(v)])
                  ) as Record<string, number>)
                : null,
            icon_name: row.icon_name ?? null,
            needs_purchase: row.needs_purchase != null ? Boolean(row.needs_purchase) : false,
            status: normalizeChecklistStatus(row.status, row.is_checked),
          }));
          setItems(safe);
          setListState('ready');
          setSectionOrderState((prev) =>
            prev.length === 0 ? Array.from(new Set(safe.map((i) => i.category))) : prev
          );
        }
      } else {
        // Personal mode: only items where user_id = current user AND group_id IS NULL
        const { data, error } = await supabase
          .from('checklist_items')
          .select('*')
          .eq('user_id', user.id)
          .is('group_id', null)
          .order('order_index', { ascending: true })
          .order('created_at', { ascending: true });
        if (error) throw error;
        const normalized = (data ?? []).map((row) => ({
          ...row,
          order_index: row.order_index != null ? Number(row.order_index) : (row.position != null ? Number(row.position) : 0),
          image_url: row.image_url ?? null,
          estimated_price: row.estimated_price != null ? Number(row.estimated_price) : 0,
          split_cost: row.split_cost != null ? Boolean(row.split_cost) : true,
          split_participant_ids: Array.isArray(row.split_participant_ids)
            ? row.split_participant_ids.map((x) => String(x))
            : null,
          split_percentages:
            row.split_percentages && typeof row.split_percentages === 'object'
              ? (Object.fromEntries(
                  Object.entries(row.split_percentages).map(([k, v]) => [k, Number(v)])
                ) as Record<string, number>)
              : null,
          icon_name: row.icon_name ?? null,
          needs_purchase: row.needs_purchase != null ? Boolean(row.needs_purchase) : false,
          status: normalizeChecklistStatus(row.status, row.is_checked),
        }));
        setItems(normalized);
        setListState('ready');
        setSectionOrderState((prev) =>
          prev.length === 0 ? Array.from(new Set(normalized.map((i) => i.category))) : prev
        );
      }
    } catch (error: unknown) {
      console.error('Checklist fetch error:', error);
      setListState((s) => (s === 'ready' ? s : 'unavailable'));
      const err = error as { message?: string; details?: string };
      if (!options?.silent) {
        if (selectedGroupId) {
          toast.error('Error loading group items', {
            description: err.message || err.details || 'Check console for details',
          });
          if (!checklistFetchOnceRef.current) {
            setItems([]);
          }
        } else {
          toast.error('Error loading checklist', {
            description: 'Please check your connection.',
          });
        }
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (!options?.silent) {
        setLoading(false);
        checklistFetchOnceRef.current = true;
      }
      void fetchOtherListItemNames();
    }
  }, [user, selectedGroupId, fetchOtherListItemNames, stopLoadingWithoutAnswer]);

  useEffect(() => {
    if (!user) {
      checklistFetchOnceRef.current = false;
      setItems([]);
      setOtherListItemNames(new Set());
      setLoading(false);
      return;
    }
    fetchItems();
  }, [user, fetchItems]);

  const toggleCheck = async (id: string, currentStatus: boolean) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, is_checked: !currentStatus } : i))
    );

    const { error } = await supabase
      .from('checklist_items')
      .update({ is_checked: !currentStatus })
      .eq('id', id);

    if (error) {
      console.error('toggleCheck error:', error);
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, is_checked: currentStatus } : i))
      );
      toast.error('Failed to update item', {
        description: error.message,
      });
    }
  };

  const toggleNeedsPurchase = async (id: string, current: boolean) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, needs_purchase: !current } : i))
    );

    const { error } = await supabase
      .from('checklist_items')
      .update({ needs_purchase: !current })
      .eq('id', id);

    if (error) {
      console.error('toggleNeedsPurchase error:', error);
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, needs_purchase: current } : i))
      );
      toast.error('Failed to update item', {
        description: error.message,
      });
    }
  };

  const cycleStatus = async (
    id: string,
    currentStatus: ChecklistItemStatus | undefined
  ): Promise<boolean> => {
    const sourceItem = items.find((i) => i.id === id);
    const cur: ChecklistItemStatus =
      currentStatus === 'need' || currentStatus === 'bought' || currentStatus === 'packed'
        ? currentStatus
        : 'need';
    // Purchase + packing tracker: Need to Buy -> Bought -> Packed -> back to Need.
    const next: ChecklistItemStatus =
      cur === 'need' ? 'bought' : cur === 'bought' ? 'packed' : 'need';
    const isChecked = next === 'packed';
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: next, is_checked: isChecked } : i))
    );
    const { error } = await supabase
      .from('checklist_items')
      .update({ status: next, is_checked: isChecked })
      .eq('id', id);
    if (error) {
      console.error('cycleStatus error:', error);
      setItems((prev) =>
        prev.map((i) =>
          i.id === id ? { ...i, status: cur, is_checked: cur === 'packed' } : i
        )
      );
      toast.error('Failed to update status', {
        description: error.message,
      });
      return false;
    }
    if (user && sourceItem) {
      await syncMatchingChecklistItemStatus({
        userId: user.id,
        sourceId: id,
        sourceName: sourceItem.item,
        sourceGroupId: sourceItem.group_id ?? null,
        status: next,
        isChecked,
      });
    }
    if (selectedGroupId) {
      await fetchItems({ silent: true });
    }
    return true;
  };

  /** Toggle the Night One (first-24-hours essential) flag on an item. Optimistic. */
  const toggleNightOne = async (id: string): Promise<boolean> => {
    const sourceItem = items.find((i) => i.id === id);
    if (!sourceItem) return false;
    const next = !sourceItem.is_night_one;
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, is_night_one: next } : i))
    );
    const { error } = await supabase
      .from('checklist_items')
      .update({ is_night_one: next })
      .eq('id', id);
    if (error) {
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, is_night_one: !next } : i))
      );
      toast.error('Failed to update Night One', {
        description: error.message,
      });
      return false;
    }
    return true;
  };

  /**
   * Fast-capture bulk add (paste / brain-dump). Each entry is created as a
   * `need` row in the current list, deduped against existing need rows AND within
   * the batch (a name already listed is skipped, not duplicated). One insert.
   * Returns the number of new rows created.
   */
  const addItemsBulk = async (
    entries: { name: string; category: string }[],
  ): Promise<number> => {
    if (!user || entries.length === 0) return 0;
    const targetGroupId = selectedGroupId ?? null;
    const batchSeen = new Set<string>();
    const fresh: { name: string; category: string }[] = [];
    for (const e of entries) {
      const name = e.name.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (batchSeen.has(key)) continue;
      if (findAttachableNeedRow(items, name, targetGroupId)) continue; // already listed
      batchSeen.add(key);
      fresh.push({ name, category: (e.category || '').trim() || 'Essentials' });
    }
    if (fresh.length === 0) return 0;

    const maxIdx =
      items.length === 0 ? 0 : Math.max(...items.map((i) => Number(i.order_index) || 0), 0) + 1;
    const rows = fresh.map((e, idx) => ({
      user_id: user.id,
      category: e.category,
      item: e.name,
      is_checked: false,
      status: 'need' as ChecklistItemStatus,
      is_custom: true,
      group_id: targetGroupId,
      order_index: maxIdx + idx,
    }));

    const stamp = Date.now();
    const temps = rows.map(
      (r, idx) => ({ ...r, id: `temp-bulk-${stamp}-${idx}` }) as ChecklistItem,
    );
    setItems((prev) => [...prev, ...temps]);
    setSectionOrderState((prev) => {
      const next = [...prev];
      for (const e of fresh) if (!next.includes(e.category)) next.push(e.category);
      return next;
    });

    const { error } = await supabase.from('checklist_items').insert(rows);
    if (error) {
      const tempIds = new Set(temps.map((t) => t.id));
      setItems((prev) => prev.filter((i) => !tempIds.has(i.id as string)));
      toast.error('Could not add items', {
        description: error.message,
      });
      return 0;
    }
    await fetchItems({ silent: true });
    return fresh.length;
  };

  /**
   * Move an item to another of the user's lists (Personal or a group) by
   * reassigning group_id - lossless (status / Night One / price preserved).
   * Optimistic: the row leaves the current list scope immediately.
   */
  const moveItemToList = async (
    itemId: string,
    targetGroupId: string | null,
    targetLabel?: string,
  ): Promise<boolean> => {
    const source = items.find((i) => i.id === itemId);
    if (!source || !user) return false;
    if ((source.group_id ?? null) === (targetGroupId ?? null)) return true;
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    const { error } = await supabase
      .from('checklist_items')
      .update({ group_id: targetGroupId })
      .eq('id', itemId);
    if (error) {
      setItems((prev) => [...prev, source]);
      toast.error('Could not move item', {
        description: error.message,
      });
      return false;
    }
    if (targetLabel) {
      toast(`Moved to ${targetLabel}`);
    }
    return true;
  };

  /** Bulk status setter (e.g. "mark category packed"). Optimistic, one UPDATE. */
  const setItemsStatus = async (
    ids: string[],
    status: ChecklistItemStatus
  ): Promise<boolean> => {
    if (ids.length === 0) return true;
    const idSet = new Set(ids);
    const prevById = new Map(
      items.filter((i) => i.id && idSet.has(i.id)).map((i) => [i.id as string, i])
    );
    const isChecked = status === 'packed';
    setItems((prev) =>
      prev.map((i) =>
        i.id && idSet.has(i.id) ? { ...i, status, is_checked: isChecked } : i
      )
    );
    const { error } = await supabase
      .from('checklist_items')
      .update({ status, is_checked: isChecked })
      .in('id', ids);
    if (error) {
      setItems((prev) =>
        prev.map((i) => (i.id && prevById.has(i.id) ? prevById.get(i.id)! : i))
      );
      toast.error('Failed to update items', {
        description: error.message,
      });
      return false;
    }
    if (selectedGroupId) await fetchItems({ silent: true });
    return true;
  };

  /** Inserts into `checklist_items` with `category` as the section/group name. */
  const addItem = async (
    category: string,
    itemName: string,
    link?: string | null,
    iconName?: string | null,
    isChecked?: boolean,
    extras?: {
      estimated_price?: number;
      needs_purchase?: boolean;
      image_url?: string | null;
      /** Chosen Shop Essentials variant label (e.g. "Pink"); rendered as a badge on the item. */
      variant_label?: string | null;
      /** When provided, insert into this list (`null` = personal). Should match the active checklist scope. */
      insertGroupId?: string | null;
    }
  ): Promise<boolean> => {
    const trimmed = itemName.trim();
    const categoryTrimmed = category.trim();
    if (!trimmed || !categoryTrimmed || !user) return false;

    const linkValue = typeof link === 'string' ? link.trim() || null : null;
    const imageUrlValue =
      typeof extras?.image_url === 'string' && extras.image_url.trim() ? extras.image_url.trim() : null;
    const variantLabelValue =
      typeof extras?.variant_label === 'string' && extras.variant_label.trim()
        ? extras.variant_label.trim()
        : null;
    const targetGroupId =
      extras && 'insertGroupId' in extras ? (extras.insertGroupId ?? null) : (selectedGroupId ?? null);

    // Checklist v2: adding a PRODUCT (link / image / price) for a need you already
    // listed ATTACHES to that need row - fills its link/price/image - instead of
    // spawning a parallel row, so the budget counts each need once. Plain typed
    // re-adds (no product payload) fall through to a fresh insert.
    const priceValue =
      extras?.estimated_price != null && extras.estimated_price > 0 ? extras.estimated_price : null;
    const isProductAdd = !!linkValue || !!imageUrlValue || priceValue != null;
    if (isProductAdd) {
      const existing = findAttachableNeedRow(items, trimmed, targetGroupId);
      if (existing && existing.id) {
        const patch: {
          link?: string;
          image_url?: string;
          estimated_price?: number;
          icon_name?: string;
          variant_label?: string;
        } = {};
        if (linkValue && !existing.link) patch.link = linkValue;
        if (imageUrlValue && !existing.image_url) patch.image_url = imageUrlValue;
        if (variantLabelValue && !existing.variant_label) patch.variant_label = variantLabelValue;
        if (priceValue != null && !(Number(existing.estimated_price) > 0))
          patch.estimated_price = priceValue;
        if (iconName && !existing.icon_name) patch.icon_name = iconName;
        if (Object.keys(patch).length === 0) return true; // already complete - dedup no-op
        const snapshot = { ...existing };
        setItems((prev) =>
          prev.map((i) => (i.id === existing.id ? ({ ...i, ...patch } as ChecklistItem) : i)),
        );
        const { error: attachError } = await supabase
          .from('checklist_items')
          .update(patch)
          .eq('id', existing.id);
        if (attachError) {
          setItems((prev) => prev.map((i) => (i.id === existing.id ? snapshot : i)));
          toast.error('Could not attach product', {
            description: attachError.message,
          });
          return false;
        }
        return true;
      }
    }

    const maxIdx = items.length === 0 ? 0 : Math.max(...items.map((i) => Number(i.order_index) || 0), 0) + 1;
    const packed = isChecked ?? false;
    const status: ChecklistItemStatus = packed ? 'packed' : 'need';
    const newItem = {
      user_id: user.id,
      category: categoryTrimmed,
      item: trimmed,
      is_checked: packed,
      status,
      is_custom: true,
      group_id: targetGroupId,
      order_index: maxIdx,
      ...(linkValue && { link: linkValue }),
      ...(iconName && { icon_name: iconName }),
      ...(extras?.estimated_price != null &&
        extras.estimated_price > 0 && { estimated_price: extras.estimated_price }),
      ...(extras?.needs_purchase === true && { needs_purchase: true }),
      ...(imageUrlValue && { image_url: imageUrlValue }),
      ...(variantLabelValue && { variant_label: variantLabelValue }),
    };

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setItems((prev) => [
      ...prev,
      { ...newItem, id: tempId, image_url: imageUrlValue ?? null, variant_label: variantLabelValue ?? null } as ChecklistItem,
    ]);
    // New section: append category to master order so it appears at bottom without shifting others.
    setSectionOrderState((prev) => (prev.includes(categoryTrimmed) ? prev : [...prev, categoryTrimmed]));

    let { data, error } = await supabase
      .from('checklist_items')
      .insert(newItem)
      .select()
      .single();

    if (error && imageUrlValue && isChecklistItemsImageUrlSchemaError(error.message)) {
      const payload = { ...newItem };
      delete payload.image_url;
      delete payload.variant_label;
      const retry = await supabase
        .from('checklist_items')
        .insert(payload)
        .select()
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      console.error('addItem error:', error);
      setItems((prev) => prev.filter((i) => i.id !== tempId));
      toast.error('Failed to add item', {
        description: error.message,
      });
      return false;
    }
    if (data) {
      const inserted = data as ChecklistItem;
      setItems((prev) =>
        prev.map((i) => (i.id === tempId ? inserted : i))
      );
      if (targetGroupId === null) {
        void claimChecklistMilestone('started', 'checklist_started', { source: 'add_item' });
      }
      if (linkValue && !imageUrlValue) {
        await saveLinkWithPreview(inserted.id, linkValue);
      }
      if (targetGroupId) {
        await fetchItems();
      }
      return true;
    }
    return false;
  };

  const updateItem = async (
    id: string,
    updates: {
      item?: string;
      category?: string;
      description?: string | null;
      link?: string | null;
      link_title?: string | null;
      link_image?: string | null;
      image_url?: string | null;
      estimated_price?: number | null;
      split_cost?: boolean | null;
      split_participant_ids?: string[] | null;
      split_percentages?: Record<string, number> | null;
      icon_name?: string | null;
      needs_purchase?: boolean | null;
      status?: ChecklistItemStatus | null;
      assigned_to?: string | null;
    },
  ) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const next = { ...item, ...updates };
    setItems((prev) =>
      prev.map((i) => (i.id === id ? next : i))
    );

    isSavingRef.current = true;
    try {
      const { error } = await supabase
        .from('checklist_items')
        .update(updates)
        .eq('id', id);

      if (error) {
        console.error('updateItem error:', error);
        setItems((prev) =>
          prev.map((i) => (i.id === id ? item : i))
        );
        toast.error('Failed to update item', {
          description: error.message,
        });
        throw error;
      }
      if (
        user &&
        updates.status !== undefined &&
        (updates.status === 'need' ||
          updates.status === 'bought' ||
          updates.status === 'packed')
      ) {
        await syncMatchingChecklistItemStatus({
          userId: user.id,
          sourceId: id,
          sourceName: item.item,
          sourceGroupId: item.group_id ?? null,
          status: updates.status,
          isChecked: updates.status === 'packed',
        });
      }
      if (selectedGroupId) {
        await fetchItems({ silent: true });
      }
    } finally {
      isSavingRef.current = false;
    }
  };

  /**
   * Insert a duplicate of `item` onto another list (personal vs group). Dedupes by trimmed
   * case-insensitive item name on the target list. Omits split fields and order (appended).
   */
  const copyItemToList = async (
    item: ChecklistItem,
    targetGroupId: string | null,
    targetListLabel: string,
  ): Promise<'copied' | 'duplicate' | 'error' | undefined> => {
    if (!user) return undefined;
    const nameKey = normalizeChecklistItemName(item.item);
    if (!nameKey) {
      toast.error('Nothing to copy', {
        description: 'Item name is empty.',
      });
      return 'error';
    }
    const sourceScope = item.group_id ?? null;
    const targetScope = targetGroupId ?? null;
    if (sourceScope === targetScope) return undefined;

    let dupQuery = supabase
      .from('checklist_items')
      .select('id, item')
      .eq('user_id', user.id);
    if (targetScope === null) {
      dupQuery = dupQuery.is('group_id', null);
    } else {
      dupQuery = dupQuery.eq('group_id', targetScope);
    }
    const { data: existingRows, error: dupErr } = await dupQuery;
    if (dupErr) {
      console.error('copyItemToList dedupe error:', dupErr);
      toast.error('Could not verify target list', {
        description: dupErr.message,
      });
      return 'error';
    }
    const hasDup = (existingRows ?? []).some(
      (r: { item: string }) => normalizeChecklistItemName(r.item) === nameKey,
    );
    if (hasDup) {
      toast(`Already on ${targetListLabel}`);
      return 'duplicate';
    }

    let ordQuery = supabase
      .from('checklist_items')
      .select('order_index')
      .eq('user_id', user.id);
    if (targetScope === null) {
      ordQuery = ordQuery.is('group_id', null);
    } else {
      ordQuery = ordQuery.eq('group_id', targetScope);
    }
    const { data: lastRow, error: ordErr } = await ordQuery
      .order('order_index', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ordErr) {
      console.error('copyItemToList order error:', ordErr);
      toast.error('Could not prepare copy', {
        description: ordErr.message,
      });
      return 'error';
    }
    const nextOrder =
      lastRow?.order_index != null ? Number(lastRow.order_index) + 1 : 0;

    const status: ChecklistItemStatus =
      item.status === 'need' || item.status === 'bought' || item.status === 'packed'
        ? item.status
        : item.is_checked
          ? 'packed'
          : 'need';
    const is_checked = status === 'packed';

    const insertRow: TablesInsert<'checklist_items'> = {
      user_id: user.id,
      group_id: targetGroupId,
      category: item.category.trim(),
      item: item.item.trim(),
      is_checked,
      status,
      is_custom: true,
      order_index: nextOrder,
      estimated_price: Number(item.estimated_price) || 0,
      needs_purchase: item.needs_purchase === true,
    };
    if (item.description != null && String(item.description).trim() !== '') {
      insertRow.description = item.description;
    }
    if (item.link?.trim()) {
      insertRow.link = item.link.trim();
      insertRow.link_title = item.link_title ?? null;
      insertRow.link_image = item.link_image ?? null;
    }
    if (item.image_url?.trim()) {
      insertRow.image_url = item.image_url.trim();
    }
    if (item.icon_name?.trim()) {
      insertRow.icon_name = item.icon_name.trim();
    }

    let { error: insErr } = await supabase
      .from('checklist_items')
      .insert(insertRow);

    if (insErr && insertRow.image_url && isChecklistItemsImageUrlSchemaError(insErr.message)) {
      const { image_url: _drop, ...rest } = insertRow;
      const retry = await supabase.from('checklist_items').insert(rest);
      insErr = retry.error;
    }

    if (insErr) {
      console.error('copyItemToList insert error:', insErr);
      toast.error('Could not copy item', {
        description: insErr.message,
      });
      return 'error';
    }

    toast(`Copied to ${targetListLabel}`);
    return 'copied';
  };

  const saveLinkWithPreview = async (id: string, url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setLinkFetchingId(id);
    try {
      const { data, error } = await supabase.functions.invoke(
        'fetch-link-preview',
        { body: { url: trimmed } },
      );
      if (error) throw error;
      const title = (data?.title ?? '').trim() || null;
      const image = (data?.image ?? '').trim() || null;
      await updateItem(id, {
        link: trimmed,
        link_title: title,
        link_image: image,
      });
    } catch (err) {
      console.error('Link preview fetch error:', err);
      // Graceful fallback: keep the link, but use a generic title/thumbnail so the UI still renders.
      let fallbackTitle: string | null = null;
      try {
        const urlObj = new URL(trimmed);
        fallbackTitle = urlObj.hostname.replace(/^www\./, '');
      } catch {
        fallbackTitle = 'External Link';
      }
      await updateItem(id, {
        link: trimmed,
        link_title: fallbackTitle,
        link_image: null,
      });
    } finally {
      setLinkFetchingId(null);
    }
  };

  const removeLink = async (id: string) => {
    await updateItem(id, { link: null, link_title: null, link_image: null });
  };

  const deleteItem = async (id: string) => {
    // Captured before the optimistic removal so Undo can put it back.
    const removed = items.find((i) => i.id === id);
    setItems((prev) => prev.filter((i) => i.id !== id));

    const { error } = await supabase
      .from('checklist_items')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('deleteItem error:', error);
      await fetchItems();
      toast.error('Failed to delete item', {
        description: error.message,
      });
    } else {
      if (selectedGroupId) {
        await fetchItems();
      } else {
        // Personal: refetch active list + otherListItemNames (fetchItems finally) so explore "In Checklist" stays in sync.
        await fetchItems({ silent: true });
      }
      // One tap deletes; a few seconds of Undo makes it recoverable (contract §8),
      // the same toast-with-undo the shop-items clear uses.
      if (removed) {
        toast(i18n.t('checklist:deleted.title', { item: removed.item }), {
          duration: 6000,
          action: {
            label: i18n.t('checklist:actions.undo'),
            onClick: () => void restoreChecklistItems([removed]),
          },
        });
      }
    }
  };

  /** Atomic reset: delete must complete before insert. On success, writes a local
   *  checklist-specific flag (localStorage.checklist_onboarding_completed). Does NOT
   *  touch profiles.has_completed_onboarding - auth onboarding is handled separately
   *  by /onboarding/intro.
   *  Personal mode: reset only personal items (group_id IS NULL).
   *  Group mode: optionally reset for all accepted members or just current user.
   */
  const resetToDefault = async (type: 'dorm' | 'apartment' | 'custom') => {
    if (!user) return;
    isResettingRef.current = true;
    setLoading(true);
    try {
      let targetUserIds: string[] = [user.id];
      const isGroupMode = !!selectedGroupId;
      let resetWholeGroup = false;

      if (isGroupMode) {
        resetWholeGroup = window.confirm(
          'Reset the entire group checklist for all members?\n\nClick "OK" to reset the whole group, or "Cancel" to reset only your items.'
        );

        if (resetWholeGroup) {
          const { data: members, error: memberErr } = await supabase
            .from('ranking_group_members')
            .select('user_id')
            .eq('group_id', selectedGroupId)
            .eq('status', 'accepted');
          if (memberErr) throw memberErr;
          const ids = (members ?? []).map((m) => String(m.user_id)).filter(Boolean);
          if (ids.length) {
            targetUserIds = Array.from(new Set(ids));
          }
        }
      }

      // Delete: personal mode = user_id + group_id IS NULL; group mode = group_id (and optionally user_id for "only my items")
      if (isGroupMode) {
        let delQuery = supabase.from('checklist_items').delete().eq('group_id', selectedGroupId);
        if (!resetWholeGroup) {
          delQuery = delQuery.eq('user_id', user.id);
        }
        const { error: delErr } = await delQuery;
        if (delErr) throw delErr;
      } else {
        const { error: delErr } = await supabase
          .from('checklist_items')
          .delete()
          .in('user_id', targetUserIds)
          .is('group_id', null);
        if (delErr) throw delErr;
      }

      const templateItems =
        type === 'dorm'
          ? DORM_TEMPLATE
          : type === 'apartment'
            ? APARTMENT_TEMPLATE
            : CUSTOM_HEADERS;
      if (templateItems.length > 0) {
        const groupId = isGroupMode ? selectedGroupId : null;
        const rows = targetUserIds.flatMap((uid) =>
          templateItems.map(({ category, item }) => ({
            user_id: uid,
            category,
            item,
            is_checked: false,
            is_custom: type === 'custom',
            group_id: groupId,
          })),
        );
        const { error: insErr } = await supabase.from('checklist_items').insert(rows);
        if (insErr) throw insErr;
      }

      if (!isGroupMode && templateItems.length > 0) {
        void claimChecklistMilestone('started', 'checklist_started', {
          source: 'template',
          template_type: type,
        });
      }

      try {
        localStorage.setItem('checklist_onboarding_completed', 'true');
      } catch { /* ignore */ }

      const messages = {
        dorm: 'Dorm essentials loaded!',
        apartment: 'Apartment essentials loaded!',
        custom: 'Custom list ready. Add your items!',
      };
      toast(messages[type]);
      await fetchItems();
    } catch (err: unknown) {
      console.error('Reset error:', err);
      const error = err as { message?: string };
      toast.error('Failed to reset list', { description: error?.message });
      await fetchItems();
    } finally {
      isResettingRef.current = false;
      setLoading(false);
    }
  };

  const addSection = async (categoryName: string) => {
    const trimmed = categoryName.trim();
    if (!trimmed || !user) return;
    await addItem(trimmed, 'Add your first item');
  };

  const renameCategory = async (oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    const ids = items.filter((i) => i.category === oldName).map((i) => i.id);
    if (ids.length === 0) return;
    setItems((prev) => prev.map((i) => (i.category === oldName ? { ...i, category: trimmed } : i)));
    // Keep stable section order in sync so the renamed section stays in its current position.
    setSectionOrderState((prev) => prev.map((c) => (c === oldName ? trimmed : c)));
    // Single batched update for the whole section instead of one round-trip per item.
    const { error } = await supabase
      .from('checklist_items')
      .update({ category: trimmed })
      .in('id', ids);
    if (error) {
      console.error('renameCategory error:', error);
      await fetchItems();
      toast.error('Failed to rename section', {
        description: error.message,
      });
      return;
    }
    if (selectedGroupId) await fetchItems();
    toast('Section renamed');
  };

  const deleteCategory = async (category: string) => {
    const ids = items.filter((i) => i.category === category).map((i) => i.id);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete the entire "${category}" section and all ${ids.length} items?`)) return;
    setItems((prev) => prev.filter((i) => i.category !== category));
    setSectionOrderState((prev) => prev.filter((c) => c !== category));
    // Single batched delete instead of one round-trip per item.
    await supabase.from('checklist_items').delete().in('id', ids);
    if (selectedGroupId) {
      await fetchItems();
    } else {
      await fetchItems({ silent: true });
    }
    toast('Section deleted');
  };

  /**
   * Persist a batch of order_index (and optional category) changes.
   * Preferred path is a single atomic RPC - one round-trip, one UPDATE - which
   * avoids the per-row request burst that overran WebKit's connection pool
   * ("Load failed"). If the RPC is unavailable (older deploy) or fails, we fall
   * back to bounded-concurrency per-row writes so reordering still persists
   * regardless of migration deploy order.
   */
  const persistOrderUpdates = useCallback(
    async (
      updates: { id: string; order_index: number; category?: string }[],
    ): Promise<{ error: { message?: string } | null }> => {
      if (updates.length === 0) return { error: null };

      const { error: rpcError } = await supabase.rpc('reorder_checklist_items', {
        p_updates: updates.map((u) => ({
          id: u.id,
          order_index: u.order_index,
          ...(u.category != null ? { category: u.category } : {}),
        })),
      });
      if (!rpcError) return { error: null };

      // Fallback: a single UPDATE statement is atomic, so a failed RPC wrote
      // nothing - safe to re-apply per row here without double-writing.
      const results = await runRowWrites(
        updates.map((u) => () => {
          const patch: TablesUpdate<'checklist_items'> = { order_index: u.order_index };
          if (u.category != null) patch.category = u.category;
          return supabase.from('checklist_items').update(patch).eq('id', u.id);
        }),
      );
      const failed = results.find((r) => r?.error);
      return { error: failed?.error ?? null };
    },
    [],
  );

  /** Reorder sections (categories). Optimistic UI, then sync order_index to Supabase. */
  const reorderSections = async (categoryOrder: string[]) => {
    if (categoryOrder.length === 0) return;
    // Update stable section order immediately so no re-derive from item values occurs.
    setSectionOrderState(categoryOrder);
    const orderMap = new Map(categoryOrder.map((c, i) => [c, i]));
    const reordered = items
      .slice()
      .sort((a, b) => (orderMap.get(a.category) ?? 999) - (orderMap.get(b.category) ?? 999));
    let secIdx = -1;
    let lastCat = '';
    let itemInSec = 0;
    reordered.forEach((item) => {
      if (item.category !== lastCat) {
        secIdx++;
        lastCat = item.category;
        itemInSec = 0;
      }
      (item as ChecklistItem & { order_index: number }).order_index = secIdx * 1000 + itemInSec;
      itemInSec++;
    });
    const nextItems = reordered.map((i) => {
      const item = i as ChecklistItem & { order_index: number };
      return { ...item, order_index: item.order_index };
    });
    setItems(nextItems);
    const { error } = await persistOrderUpdates(
      nextItems.map((item) => ({ id: item.id, order_index: item.order_index })),
    );
    if (error) {
      console.error('reorderSections error:', error);
      await fetchItems();
      toast.error('Failed to save order', {
        description: error.message ?? 'Changes were reverted.',
      });
      return;
    }
    if (selectedGroupId) await fetchItems();
  };

  /**
   * Section order: frozen list from sectionOrderState only. No dependency on items - 
   * so item index changes during drag never cause the category list to reorder.
   */
  const sectionOrder = useMemo(() => [...sectionOrderState], [sectionOrderState]);

  const categorizedItems = useMemo(() => {
    const acc: Record<string, ChecklistItem[]> = {};
    sectionOrder.forEach((cat) => { acc[cat] = []; });
    items.forEach((item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
    });
    sectionOrder.forEach((cat) => {
      if (acc[cat]) acc[cat].sort((a, b) => (Number(a.order_index) || 0) - (Number(b.order_index) || 0));
    });
    return acc;
  }, [items, sectionOrder]);

  /** Bulletproof bulk save: update local state, single upsert, revert on fail. Prevents snap-back. */
  const saveItemReorderBulk = useCallback(
    async (
      fromCategory: string,
      toCategory: string,
      activeId: string,
      fromIds: string[],
      targetIds: string[]
    ) => {
      const fromSectionIdx = sectionOrder.indexOf(fromCategory);
      const toSectionIdx = sectionOrder.indexOf(toCategory);
      if (fromSectionIdx < 0 || toSectionIdx < 0) return;

      const fromBase = fromSectionIdx * 1000;
      const toBase = toSectionIdx * 1000;

      const isCrossSection = fromCategory !== toCategory;

      setItems((prev) => {
        const byId = new Map(prev.map((i) => [i.id, i]));
        const catOrder =
          sectionOrder.length > 0
            ? sectionOrder
            : Array.from(new Set(prev.map((i) => i.category)));
        const nextByCat = new Map<string, ChecklistItem[]>();
        prev.forEach((item) => {
          const arr = nextByCat.get(item.category) ?? [];
          arr.push(item);
          nextByCat.set(item.category, arr);
        });

        if (isCrossSection) {
          const fromArr = fromIds
            .map((id, i) => {
              const item = byId.get(id);
              if (!item) return null;
              return { ...item, order_index: fromBase + i, category: fromCategory };
            })
            .filter(Boolean) as ChecklistItem[];
          const toArr = targetIds
            .map((id, i) => {
              const item = byId.get(id);
              if (!item) return null;
              return { ...item, order_index: toBase + i, category: toCategory };
            })
            .filter(Boolean) as ChecklistItem[];
          nextByCat.set(fromCategory, fromArr);
          nextByCat.set(toCategory, toArr);
        } else {
          const toArr = targetIds
            .map((id, i) => {
              const item = byId.get(id);
              if (!item) return null;
              return { ...item, order_index: toBase + i, category: toCategory };
            })
            .filter(Boolean) as ChecklistItem[];
          nextByCat.set(toCategory, toArr);
        }

        const next: ChecklistItem[] = [];
        catOrder.forEach((cat) => {
          const arr = nextByCat.get(cat);
          if (arr) next.push(...arr);
        });
        nextByCat.forEach((arr, cat) => {
          if (!catOrder.includes(cat)) next.push(...arr);
        });
        return next;
      });

      const byId = new Map(items.map((i) => [i.id, i]));

      const updates: { id: string; item: string; order_index: number; category: string; user_id: string; group_id: string | null; is_checked: boolean; is_custom: boolean }[] = [];

      if (isCrossSection) {
        fromIds.forEach((id, i) => {
          const item = byId.get(id);
          if (!item) return;
          updates.push({
            id,
            item: item.item ?? '',
            order_index: fromBase + i,
            category: fromCategory,
            user_id: item.user_id,
            group_id: item.group_id ?? null,
            is_checked: item.is_checked ?? false,
            is_custom: item.is_custom ?? false,
          });
        });
        targetIds.forEach((id, i) => {
          const item = byId.get(id);
          if (!item) return;
          updates.push({
            id,
            item: item.item ?? '',
            order_index: toBase + i,
            category: toCategory,
            user_id: item.user_id,
            group_id: item.group_id ?? null,
            is_checked: item.is_checked ?? false,
            is_custom: item.is_custom ?? false,
          });
        });
      } else {
        targetIds.forEach((id, i) => {
          const item = byId.get(id);
          if (!item) return;
          updates.push({
            id: item.id,
            item: item.item ?? '',
            order_index: toBase + i,
            category: toCategory,
            user_id: item.user_id,
            group_id: item.group_id ?? null,
            is_checked: item.is_checked ?? false,
            is_custom: item.is_custom ?? false,
          });
        });
      }

      const allUpdates = updates.filter((u) => u.category != null && u.category !== '' && u.item != null && u.item !== '');

      try {
        // Single atomic RPC (changed columns only, so no INSERT RLS) lets an
        // accepted group member reorder co-members' rows; falls back to bounded
        // per-row writes if the RPC is unavailable. Both avoid the request burst
        // that made WebKit reject overflow fetches with "Load failed".
        const { error } = await persistOrderUpdates(
          allUpdates.map((u) => ({ id: u.id, order_index: u.order_index, category: u.category })),
        );
        if (error) {
          await fetchItems();
          const errMsg = error?.message ?? JSON.stringify(error) ?? 'Unknown error';
          toast.error('Failed to save order', { description: `Reason: ${errMsg}` });
          return;
        }
      } catch (err: unknown) {
        await fetchItems();
        const error = err as { message?: string; details?: string };
        const errMsg = error?.message ?? error?.details ?? JSON.stringify(err) ?? 'Unknown error';
        toast.error('Failed to save order', { description: `Reason: ${errMsg}` });
        throw err;
      }
    },
    [sectionOrder, items, selectedGroupId, fetchItems]
  );

  /** Reorder items within a section. Optimistic UI, then bulk-update order_index in Supabase. */
  const reorderItems = async (category: string, itemIds: string[]) => {
    const sectionIndex = sectionOrder.indexOf(category);
    if (sectionIndex < 0) return;
    const baseIdx = sectionIndex * 1000;
    const updates: { id: string; order_index: number }[] = itemIds.map((id, i) => ({ id, order_index: baseIdx + i }));
    setItems((prev) => {
      const byId = new Map(prev.map((i) => [i.id, i]));
      const reordered = itemIds.map((id) => byId.get(id)).filter(Boolean).map((item, i) => ({
        ...item,
        order_index: baseIdx + i,
      })) as ChecklistItem[];
      const rest = prev.filter((i) => i.category !== category);
      return [...rest, ...reordered].sort((a, b) => (Number(a.order_index) || 0) - (Number(b.order_index) || 0));
    });
    const { error } = await persistOrderUpdates(updates);
    if (error) {
      console.error('reorderItems error:', error);
      await fetchItems();
      const err = error as { message?: string };
      toast.error('Failed to save order', {
        description: err.message ?? 'Changes were reverted.',
      });
      throw error;
    }
    if (selectedGroupId) await fetchItems();
  };

  /**
   * Reorder items WITHIN a readiness group (Night One / Still need). Those groups
   * span categories, so - unlike reorderItems (category-scoped) - this permutes
   * only the order_index VALUES the dragged group's items already occupy, leaving
   * every other row's order_index (and all categories) untouched. Optimistic UI,
   * then the same atomic RPC path. Personal-list use only.
   */
  const reorderItemsWithinGroup = async (orderedIds: string[]) => {
    if (orderedIds.length < 2) return;
    const byId = new Map(items.map((i) => [i.id, i]));
    const present = orderedIds.filter((id) => byId.has(id));
    if (present.length !== orderedIds.length) return;
    // The order_index slots these items currently occupy, ascending; reassign
    // them to the new visual sequence so only this group's internal order moves.
    const slots = present
      .map((id) => Number((byId.get(id) as ChecklistItem).order_index) || 0)
      .sort((a, b) => a - b);
    const updates = present.map((id, i) => ({ id, order_index: slots[i] }));
    const nextIndexById = new Map(updates.map((u) => [u.id, u.order_index]));
    setItems((prev) =>
      prev
        .map((it) => (nextIndexById.has(it.id) ? { ...it, order_index: nextIndexById.get(it.id)! } : it))
        .sort((a, b) => (Number(a.order_index) || 0) - (Number(b.order_index) || 0)),
    );
    const { error } = await persistOrderUpdates(updates);
    if (error) {
      console.error('reorderItemsWithinGroup error:', error);
      await fetchItems();
      const err = error as { message?: string };
      toast.error('Failed to save order', {
        description: err.message ?? 'Changes were reverted.',
      });
    }
  };

  /** Optimistically move an item between arrays only. Uses fixed sectionOrder; never re-sorts categories by item indices. */
  const moveItemOptimistic = (
    fromCategory: string,
    toCategory: string,
    activeId: string,
    overId: string | null
  ) => {
    setItems((prev) => {
      const activeItem = prev.find((i) => i.id === activeId);
      if (!activeItem) return prev;

      const byCat = new Map<string, ChecklistItem[]>();
      prev.forEach((item) => {
        const arr = byCat.get(item.category) ?? [];
        arr.push(item);
        byCat.set(item.category, arr);
      });

      if (fromCategory === toCategory) {
        const arr = (byCat.get(fromCategory) ?? []).filter((i) => i.id !== activeId);
        const moved: ChecklistItem = { ...activeItem, category: toCategory };
        if (overId && arr.some((i) => i.id === overId)) {
          const idx = arr.findIndex((i) => i.id === overId);
          arr.splice(idx, 0, moved);
        } else {
          arr.push(moved);
        }
        byCat.set(fromCategory, arr);
      } else {
        const fromArr = (byCat.get(fromCategory) ?? []).filter((i) => i.id !== activeId);
        const toArr = (byCat.get(toCategory) ?? []).filter((i) => i.id !== activeId);
        const moved: ChecklistItem = { ...activeItem, category: toCategory };
        if (!overId) {
          // Header-target move: visually prepend to the top of the new section.
          toArr.unshift(moved);
        } else if (toArr.some((i) => i.id === overId)) {
          const idx = toArr.findIndex((i) => i.id === overId);
          toArr.splice(idx, 0, moved);
        } else {
          toArr.push(moved);
        }
        byCat.set(fromCategory, fromArr);
        byCat.set(toCategory, toArr);
      }

      // Reconstruct from fixed section order only; never re-sort categories by order_index.
      const catOrder =
        sectionOrderState.length > 0
          ? sectionOrderState
          : Array.from(new Set(prev.map((i) => i.category)));
      const next: ChecklistItem[] = [];
      catOrder.forEach((cat) => {
        const arr = byCat.get(cat);
        if (arr) next.push(...arr);
      });
      byCat.forEach((arr, cat) => {
        if (!catOrder.includes(cat)) next.push(...arr);
      });

      return next;
    });
  };

  const clearChecked = async () => {
    const checkedIds = items
      .filter((i) => (i.status ?? (i.is_checked ? 'packed' : 'need')) === 'packed')
      .map((i) => i.id);
    if (checkedIds.length === 0) return;
    setItems((prev) =>
      prev.filter((i) => (i.status ?? (i.is_checked ? 'packed' : 'need')) !== 'packed')
    );
    // Single batched delete instead of one round-trip per item.
    await supabase.from('checklist_items').delete().in('id', checkedIds);
    toast('Cleared completed items');
    await fetchItems();
  };

  /**
   * Remove every Shop-sourced row (product image + Amazon affiliate link) from
   * the checklist. Returns the removed rows so callers can offer Undo via
   * `restoreChecklistItems`. Confirmation is the caller's job (dialog in the
   * Shop tab; `window.confirm` kept for legacy callers via `skipConfirm`).
   */
  const clearShopEssentialsItems = async (
    opts?: { skipConfirm?: boolean },
  ): Promise<ChecklistItem[] | null> => {
    const shopRows = items.filter(
      (i) =>
        !!i.image_url?.trim() &&
        !!i.link?.trim() &&
        isAmazonAffiliateUrl(i.link),
    );
    if (shopRows.length === 0) return null;
    if (
      !opts?.skipConfirm &&
      !window.confirm(
        `Remove all ${shopRows.length} Shop Essentials items from your checklist?`,
      )
    ) {
      return null;
    }
    const shopIds = shopRows.map((i) => i.id);
    setItems((prev) => prev.filter((i) => !shopIds.includes(i.id)));
    // Single batched delete instead of one round-trip per item.
    await supabase.from('checklist_items').delete().in('id', shopIds);
    if (!opts?.skipConfirm) {
      toast(`Removed ${shopRows.length} Shop Essentials items`);
    }
    await fetchItems();
    return shopRows;
  };

  /** Re-insert previously removed rows (Undo for bulk clears). Ids are re-minted. */
  const restoreChecklistItems = async (rows: ChecklistItem[]) => {
    if (rows.length === 0) return;
    const payload = rows.map((r) => ({
      user_id: r.user_id,
      category: r.category,
      item: r.item,
      is_checked: r.is_checked ?? false,
      status: r.status ?? (r.is_checked ? 'packed' : 'need'),
      is_custom: r.is_custom ?? true,
      group_id: r.group_id ?? null,
      order_index: r.order_index ?? null,
      ...(r.link && { link: r.link }),
      ...(r.icon_name && { icon_name: r.icon_name }),
      ...(r.image_url && { image_url: r.image_url }),
      ...(r.estimated_price != null && { estimated_price: r.estimated_price }),
      ...(r.needs_purchase != null && { needs_purchase: r.needs_purchase }),
    }));
    const { error } = await supabase.from('checklist_items').insert(payload);
    if (error) {
      toast.error('Could not restore items', {
        description: error.message,
      });
      return;
    }
    await fetchItems();
  };

  const totalItems = items.length;
  const packedItems = items.filter(
    (i) => (i.status ?? (i.is_checked ? 'packed' : 'need')) === 'packed'
  ).length;
  const remainingItems = totalItems - packedItems;
  const progress = totalItems === 0 ? 0 : Math.round((packedItems / totalItems) * 100);
  const totalEstimatedCost = items.reduce(
    (sum, i) => sum + (Number(i.estimated_price) || 0),
    0
  );

  // checklist_completed funnel milestone: one effect covers every mutation path
  // (cycleStatus, updateItem, templates, realtime sync). Personal list only - 
  // group lists are shared state and would double-count per member. The server
  // null guard in claimChecklistMilestone keeps this once-only for the user.
  useEffect(() => {
    if (selectedGroupId || loading) return;
    if (totalItems === 0 || progress !== 100) return;
    void claimChecklistMilestone('completed', 'checklist_completed', { item_count: totalItems });
  }, [selectedGroupId, loading, totalItems, progress, claimChecklistMilestone]);

  /** Emergency stop: call to force loading false (e.g. from page-level timeout guard) */
  const forceStopLoading = stopLoadingWithoutAnswer;

  // Realtime sync: when any checklist_items row changes, refresh (debounced, silent).
  // Skip refetch during local save to avoid overwriting optimistic updates with stale data.
  useEffect(() => {
    if (!user) return;
    // Scope the subscription to only the rows this list actually shows:
    // the active group's items in group mode, or the user's own items in
    // personal mode. Without a filter every client received every user's
    // checklist_items change and refetched needlessly.
    const filter = selectedGroupId
      ? `group_id=eq.${selectedGroupId}`
      : `user_id=eq.${user.id}`;
    const channel = supabase
      .channel(`checklist-sync-${user.id}-${selectedGroupId ?? 'personal'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'checklist_items', filter },
        () => {
          if (isSavingRef.current) return;
          if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
          realtimeDebounceRef.current = setTimeout(() => {
            realtimeDebounceRef.current = null;
            // Re-check at fire time: a drag/save that started after this was
            // scheduled must not be interrupted by a stale refetch (it would
            // cancel an in-flight dnd-kit drag and strand the overlay).
            if (isSavingRef.current) return;
            fetchItems({ silent: true });
          }, 400);
        },
      )
      .subscribe();

    return () => {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [user, selectedGroupId, fetchItems]);

  const beginLocalSave = useCallback(() => {
    isSavingRef.current = true;
  }, []);

  const endLocalSave = useCallback(() => {
    isSavingRef.current = false;
  }, []);

  return {
    items,
    otherListItemNames,
    categorizedItems,
    sectionOrder,
    reorderSections,
    reorderItems,
    reorderItemsWithinGroup,
    moveItemOptimistic,
    beginLocalSave,
    endLocalSave,
    progress,
    packedItems,
    totalEstimatedCost,
    remainingItems,
    totalItems,
    loading,
    listState,
    linkFetchingId,
    forceStopLoading,
    toggleCheck,
    toggleNeedsPurchase,
    cycleStatus,
    toggleNightOne,
    setItemsStatus,
    addItem,
    addItemsBulk,
    moveItemToList,
    updateItem,
    copyItemToList,
    saveLinkWithPreview,
    removeLink,
    deleteItem,
    resetToDefault,
    addSection,
    renameCategory,
    deleteCategory,
    clearChecked,
    clearShopEssentialsItems,
    restoreChecklistItems,
    refetch: fetchItems,
    saveItemReorderBulk,
  };
}
