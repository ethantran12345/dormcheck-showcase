import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Check, Loader2, PackageCheck, Plus, Users, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllChecklistGroups, fetchGroupMembers } from '@/components/checklist/checklistServer';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getInitials } from '@/lib/identity';
import { cn } from '@/lib/utils';

/**
 * Big-ticket, one-per-room items roommates most need to coordinate. English
 * constants on purpose - the checklist data layer (steps, provides lists) is
 * English throughout; only surrounding chrome is translated. `match` keywords
 * (lowercased substring) map an existing shared-checklist item onto a slot.
 */
const BIG_ITEMS: { key: string; label: string; match: string[] }[] = [
  { key: 'fridge', label: 'Mini fridge', match: ['fridge', 'refrigerator'] },
  { key: 'microwave', label: 'Microwave', match: ['microwave'] },
  { key: 'tv', label: 'TV', match: ['tv', 'television'] },
  { key: 'rug', label: 'Rug', match: ['rug'] },
  { key: 'vacuum', label: 'Vacuum', match: ['vacuum'] },
  { key: 'futon', label: 'Futon or extra seating', match: ['futon', 'couch', 'sofa', 'papasan'] },
  { key: 'coffee', label: 'Coffee maker or kettle', match: ['coffee', 'keurig', 'kettle', 'espresso'] },
  { key: 'fan', label: 'Fan', match: ['fan'] },
  { key: 'storage', label: 'Storage cart or shelving', match: ['storage', 'cart', 'shelf', 'shelving', 'drawer'] },
  { key: 'mirror', label: 'Full-length mirror', match: ['mirror'] },
];

const CLAIM_CATEGORY = 'Room shared items';

type GroupItem = { id: string; item: string; assigned_to: string | null; group_id: string | null };

/**
 * Live "who's bringing what" board for the Move-In tab's Before phase. Reuses the
 * existing shared-checklist collaboration engine (no parallel data model): each
 * big item slot is matched against the roommates' shared `checklist_items`
 * (group_id), and claiming writes `assigned_to`. Gaps (no matching shared item)
 * are added on demand - never auto-seeded - and self-claimed in one tap. Peers
 * see every change live via the checklist realtime channel. No connected
 * roommate -> the existing invite CTA.
 */
export function RoommateClaimBoard({
  userId,
  hideHeader = false,
}: {
  userId: string;
  /** Skip the internal title row when a parent entry card already names it. */
  hideHeader?: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState(false);

  // The roommate group. Most students have 0 or 1 shared checklist; use the first.
  const { data: groups, isLoading: groupsLoading } = useQuery({
    queryKey: ['movein-claim-groups', userId],
    queryFn: () => fetchAllChecklistGroups(userId),
  });
  const group = groups?.[0] ?? null;
  const groupId = group?.id ?? null;
  const roommateName =
    (group?.is_owner ? group?.collaborator_name : group?.owner_name)?.trim() ||
    group?.group_name?.trim() ||
    null;

  const { data: members } = useQuery({
    queryKey: ['movein-claim-members', groupId],
    queryFn: () => fetchGroupMembers(groupId as string),
    enabled: !!groupId,
  });

  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ['movein-claim-items', groupId],
    queryFn: async (): Promise<GroupItem[]> => {
      const { data, error: rpcError } = await supabase.rpc('get_group_checklist', {
        query_group_id: groupId as string,
      });
      if (rpcError) return [];
      const raw = Array.isArray(data) ? data : [];
      return raw.map((r) => ({
        id: String((r as GroupItem).id),
        item: String((r as GroupItem).item ?? ''),
        assigned_to: (r as GroupItem).assigned_to ?? null,
        group_id: (r as GroupItem).group_id ?? null,
      }));
    },
    enabled: !!groupId,
  });

  // Live sync: any group member's claim/add lands without a refresh. The filter
  // matches the active group scope (see docs/audits/realtime.md - filtered subs
  // fire on group rows).
  useEffect(() => {
    if (!groupId) return;
    const channel = supabase
      .channel(`movein-claim-${groupId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'checklist_items', filter: `group_id=eq.${groupId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['movein-claim-items', groupId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId, queryClient]);

  const memberName = useCallback(
    (uid: string): string => {
      if (uid === userId) return t('checklist:assignee.you');
      const m = members?.find((x) => x.user_id === uid);
      return m?.full_name?.trim() || t('checklist:assignee.studentFallback');
    },
    [members, userId, t],
  );

  // Resolve each big-item slot against the shared list.
  const slots = useMemo(() => {
    const list = items ?? [];
    return BIG_ITEMS.map((big) => {
      const matches = list.filter((it) => {
        const name = it.item.toLowerCase();
        return big.match.some((kw) => name.includes(kw));
      });
      // Prefer an already-claimed match so state reads clearly.
      const matched = matches.find((m) => m.assigned_to) ?? matches[0] ?? null;
      return { big, matched };
    });
  }, [items]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['movein-claim-items', groupId] });

  // Claim / unclaim an existing shared item.
  const setAssignee = async (item: GroupItem, next: string | null, key: string) => {
    setBusyKey(key);
    setError(false);
    const { error: upErr } = await supabase
      .from('checklist_items')
      .update({ assigned_to: next })
      .eq('id', item.id);
    setBusyKey(null);
    if (upErr) {
      setError(true);
      return;
    }
    await invalidate();
  };

  // A gap slot: add the item to the shared list AND claim it, in one tap.
  const addAndClaim = async (label: string, key: string) => {
    if (!groupId) return;
    setBusyKey(key);
    setError(false);
    const maxIdx = (items?.length ?? 0) + BIG_ITEMS.length;
    const { error: insErr } = await supabase.from('checklist_items').insert({
      user_id: userId,
      category: CLAIM_CATEGORY,
      item: label,
      is_checked: false,
      status: 'need',
      is_custom: true,
      group_id: groupId,
      order_index: maxIdx,
      assigned_to: userId,
    });
    setBusyKey(null);
    if (insErr) {
      setError(true);
      return;
    }
    await invalidate();
  };

  // ── No connected roommate: the existing invite CTA ────────────────────────
  if (!groupsLoading && !groupId) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 shadow-raised">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Users className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{t('checklist:moveIn.claimInviteTitle')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('checklist:moveIn.claimInviteDesc')}</p>
          </div>
        </div>
        <Button asChild className="mt-3 w-full bg-malachite-800 font-semibold text-white hover:bg-malachite-900">
          <Link to="/checklist?tab=checklist">{t('checklist:page.inviteRoommate')}</Link>
        </Button>
      </div>
    );
  }

  const gapCount = slots.filter((s) => !s.matched).length;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-raised">
      {!hideHeader && (
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <PackageCheck className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{t('checklist:moveIn.claimTitle')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {roommateName
                ? t('checklist:moveIn.claimSubtitle', { name: roommateName })
                : t('checklist:moveIn.claimSubtitleNoName')}
            </p>
          </div>
        </div>
      )}

      {groupsLoading || itemsLoading ? (
        <div className="mt-3 space-y-2" aria-hidden>
          <div className="h-11 w-full animate-pulse rounded-xl bg-muted" />
          <div className="h-11 w-full animate-pulse rounded-xl bg-muted" />
          <div className="h-11 w-full animate-pulse rounded-xl bg-muted" />
        </div>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {slots.map(({ big, matched }) => {
            const key = big.key;
            const busy = busyKey === key;
            const claimedBy = matched?.assigned_to ?? null;
            const mine = claimedBy === userId;

            return (
              <li
                key={key}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{big.label}</p>
                  <p
                    className={cn(
                      'truncate text-xs',
                      claimedBy ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {claimedBy
                      ? mine
                        ? t('checklist:moveIn.claimYouHaveIt')
                        : t('checklist:moveIn.claimMemberHasIt', { name: memberName(claimedBy) })
                      : matched
                        ? t('checklist:moveIn.claimSharedUnclaimed')
                        : t('checklist:moveIn.claimNobodyYet')}
                  </p>
                </div>

                {mine ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => matched && setAssignee(matched, null, key)}
                    aria-label={t('checklist:moveIn.claimUnclaimAria', { item: big.label })}
                    // Button takes size-3.5 for the leading check/spinner; the 12px
                    // trailing X is the odd one out and carries `!` to keep its size.
                    className="inline-flex h-auto shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-accent disabled:opacity-50 [&_svg]:size-3.5"
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Check className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {t('checklist:moveIn.claimGotIt')}
                    <X className="!h-3 !w-3 opacity-70" aria-hidden />
                  </Button>
                ) : claimedBy ? (
                  <Avatar className="h-6 w-6 shrink-0 border border-border">
                    <AvatarImage src={members?.find((m) => m.user_id === claimedBy)?.avatar_url ?? undefined} alt="" />
                    <AvatarFallback className="bg-muted text-[8px] text-muted-foreground">
                      {getInitials(members?.find((m) => m.user_id === claimedBy)?.full_name ?? '')}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => (matched ? setAssignee(matched, userId, key) : addAndClaim(big.label, key))}
                    aria-label={t('checklist:moveIn.claimGotItAria', { item: big.label })}
                    // [&_svg]:size-3.5 keeps the 14px glyphs off the base [&_svg]:size-4.
                    className="inline-flex h-auto shrink-0 items-center gap-1 rounded-full bg-foreground px-2.5 py-1 text-xs font-semibold text-background transition-colors hover:bg-foreground hover:text-background hover:opacity-90 disabled:opacity-50 [&_svg]:size-3.5"
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {t('checklist:moveIn.claimIveGotThis')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!groupsLoading && !itemsLoading && gapCount > 0 ? (
        <p className="mt-2.5 text-xs text-muted-foreground">
          {t('checklist:moveIn.claimGapHint', { n: gapCount })}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-xs font-medium text-destructive">{t('checklist:moveIn.claimError')}</p>
      ) : null}
    </div>
  );
}
