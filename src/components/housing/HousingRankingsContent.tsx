import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { sanitizeOptional } from '@/lib/sanitize';
import { fetchSavedDormsAndRankings, type RankingsQueryResult, type UserDormRankingRow } from '@/lib/rankingsApi';
import { useAuth } from '@/hooks/useAuth';
import { useDorms } from '@/hooks/useDorms';
import { dormSlugFromName } from '@/lib/dormSlug';
import { useSavedDorms } from '@/hooks/useSavedDorms';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, ListOrdered, Grip, Users2, Pencil, Plus, X, ChevronDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { CollaborateModal } from '@/components/collaborate/CollaborateModal';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverlay,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface RankingItem {
  dormId: number;
  displayName: string;
  image: string;
  priceText: string;
  voters?: { id: string; name: string; avatar: string | null }[];
}

type RankingGroupMemberRow = Database['public']['Tables']['ranking_group_members']['Row'] & {
  ranking_collaborations?: Database['public']['Tables']['ranking_collaborations']['Row'] | null;
};
type RankingCollaborationsRow = Database['public']['Tables']['ranking_collaborations']['Row'];
type PublicProfilesRow = Database['public']['Views']['public_profiles']['Row'];
type UserDormRankingsRow = Database['public']['Tables']['user_dorm_rankings']['Row'];
type GroupDormRankingsRow = Database['public']['Tables']['group_dorm_rankings']['Row'];

function SortableRankingItem({
  item,
  index,
  disabled = false,
}: {
  item: RankingItem;
  index: number;
  disabled?: boolean;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.dormId, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li ref={setNodeRef} style={style} className="transition-all duration-200 ease-out">
      <Card
        className={cn(
          'transition-colors hover:bg-muted/50',
          'flex flex-row items-center gap-3',
          isDragging
            ? 'relative z-50 scale-105 shadow-overlay transition-none'
            : 'transition-all duration-200 ease-out'
        )}
      >
        <div
          {...(disabled ? {} : { ...attributes, ...listeners })}
          className={cn(
            'flex h-12 w-10 shrink-0 items-center justify-center rounded-l-lg bg-transparent',
            disabled ? 'text-muted-foreground/50 cursor-default' : 'text-muted-foreground cursor-grab active:cursor-grabbing touch-none'
          )}
        >
          <Grip className="w-5 h-5" strokeWidth={2} />
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/5 text-base font-semibold text-primary">
          {index + 1}
        </div>
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md">
          <img
            src={item.image}
            alt={item.displayName}
            className="h-full w-full object-cover"
          />
        </div>
        <CardContent className="flex flex-1 items-center justify-between py-4 pl-0 pr-4 min-w-0">
          <div className="flex flex-col min-w-0 flex-1">
            <p className="font-semibold text-foreground">
              {item.displayName}
            </p>
            {item.priceText && (
              <p className="text-xs text-muted-foreground">
                {item.priceText}
              </p>
            )}
          </div>
          {item.voters && item.voters.length > 0 && (
            <div className="flex items-center mr-2 shrink-0">
              {item.voters.map((voter) => {
                const initials = voter.name
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .toUpperCase()
                  .substring(0, 2);
                return (
                  <Avatar key={voter.id} className="h-6 w-6 border-2 border-background -ml-2 first:ml-0">
                    <AvatarImage src={voter.avatar ?? undefined} />
                    <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                  </Avatar>
                );
              })}
            </div>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              navigate('/housing/' + dormSlugFromName(item.displayName), { state: { fromExplore: true } });
            }}
            className="flex shrink-0 items-center justify-center p-2 -m-2 rounded-md cursor-pointer hover:bg-primary/10 transition-colors"
            aria-label={t('housing:rankings.ariaLabels.viewDorm', { name: item.displayName })}
          >
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </button>
        </CardContent>
      </Card>
    </li>
  );
}

export function HousingRankingsContent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { dorms } = useDorms();
  const { savedDormIds } = useSavedDorms();
  const { t } = useTranslation();
  const editGroupNameInputRef = useRef<HTMLInputElement>(null);
  const [orderedDorms, setOrderedDorms] = useState<RankingItem[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [collaborateModalOpen, setCollaborateModalOpen] = useState(false);
  const [collaborateModalOpenForCreate, setCollaborateModalOpenForCreate] = useState(false);
  const [addToGroupIdForInvite, setAddToGroupIdForInvite] = useState<string | null>(null);
  const [selectedCollaborationId, setSelectedCollaborationId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState<string | null>(null);
  const [editGroupNameValue, setEditGroupNameValue] = useState('');
  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false);
  const [activeCollaborators, setActiveCollaborators] = useState<Map<string, { id: string; name: string; avatar?: string }>>(new Map());

  useEffect(() => {
    if (editingGroupName && editGroupNameInputRef.current) {
      editGroupNameInputRef.current.focus();
    }
  }, [editingGroupName]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const {
    data: rankingsData = null,
    isLoading: rankingsLoading,
    error: rankingsError,
  } = useQuery({
    queryKey: ['saved_dorms_and_user_dorm_rankings', user?.id],
    queryFn: fetchSavedDormsAndRankings,
    enabled: !!user?.id,
  });

  useEffect(() => {
    if (selectedCollaborationId !== null) return;
    if (!user?.id || !rankingsData) return;
    const { savedDorms, rankings } = rankingsData;
    const saved = savedDorms ?? [];
    if (!saved.length) return;

    const sortedRankings = [...(rankings ?? [])].sort((a: UserDormRankingRow, b: UserDormRankingRow) => a.rank_order - b.rank_order);
    const rankedDormIds = new Set(sortedRankings.map((r: UserDormRankingRow) => Number(r.dorm_id)));
    const unranked = saved.filter((s) => !rankedDormIds.has(Number(s.dorm_id)));
    const idealOrder: number[] = [
      ...sortedRankings.map((r: UserDormRankingRow) => Number(r.dorm_id)),
      ...unranked.map((s) => Number(s.dorm_id)),
    ];
    if (!idealOrder.length) return;

    const rankOrderByDorm = new Map<number, number>();
    sortedRankings.forEach((r: UserDormRankingRow) => rankOrderByDorm.set(Number(r.dorm_id), Number(r.rank_order)));

    let needsUpdate = false;
    for (let i = 0; i < idealOrder.length; i++) {
      const dormId = idealOrder[i];
      const expectedOrder = i + 1;
      const currentOrder = rankOrderByDorm.get(dormId);
      if (currentOrder === undefined || currentOrder !== expectedOrder) {
        needsUpdate = true;
        break;
      }
    }

    if (!needsUpdate) return;

    void (async () => {
      const upsertPayload = idealOrder.map((dorm_id, index) => ({
        user_id: user.id,
        dorm_id,
        rank_order: index + 1,
      }));
      const { error } = await supabase
        .from('user_dorm_rankings')
        .upsert(upsertPayload, { onConflict: 'user_id,dorm_id' });
      if (!error) {
        queryClient.invalidateQueries({ queryKey: ['saved_dorms_and_user_dorm_rankings'] });
      }
    })();
  }, [rankingsData, user?.id, queryClient, selectedCollaborationId]);

  const { data: allGroups = [], isLoading: groupsLoading } = useQuery({
    queryKey: ['all_ranking_groups', user?.id],
    queryFn: async (): Promise<Array<{
      id: string;
      owner_id: string;
      collaborator_id: string;
      owner_name: string | null;
      collaborator_name: string | null;
      owner_avatar_url: string | null;
      collaborator_avatar_url: string | null;
      group_name: string | null;
      is_owner: boolean;
    }>> => {
      if (!user?.id) return [];
      const { data: rows, error } = await supabase
        .from('ranking_group_members')
        .select('*, ranking_collaborations(*)')
        .eq('user_id', user.id)
        .eq('status', 'accepted');
      if (error) return [];
      const groups = (
        (rows ?? [])
          .map((row: RankingGroupMemberRow) => row.ranking_collaborations)
          .filter(Boolean) as RankingCollaborationsRow[]
      )
        // Confirmed roommate groups back the checklist, not dorm rankings.
        .filter((g) => g.group_type !== 'roommate');
      if (groups.length === 0) return [];
      const groupIds: string[] = Array.from(
        new Set(groups.map((r: RankingCollaborationsRow) => String(r.id ?? '')))
      );
      const { data: collaboratorRows } = await supabase
        .from('ranking_group_members')
        .select('group_id, user_id, status')
        .in('group_id', groupIds)
        .eq('role', 'collaborator')
        .in('status', ['accepted', 'pending']);

      const acceptedCollabByGroup = new Map<string, string>();
      const pendingCollabByGroup = new Map<string, string>();
      (collaboratorRows ?? []).forEach((r: RankingGroupMemberRow) => {
        const gid = String(r.group_id);
        const uid = String(r.user_id);
        const status = String(r.status ?? '');
        if (status === 'accepted') {
          if (!acceptedCollabByGroup.has(gid)) acceptedCollabByGroup.set(gid, uid);
        } else if (status === 'pending') {
          if (!pendingCollabByGroup.has(gid)) pendingCollabByGroup.set(gid, uid);
        }
      });
      const chosenCollabByGroup = new Map<string, string>();
      groupIds.forEach((gid) => {
        const accepted = acceptedCollabByGroup.get(gid);
        const pending = pendingCollabByGroup.get(gid);
        if (typeof accepted === 'string' && accepted) chosenCollabByGroup.set(gid, accepted);
        else if (typeof pending === 'string' && pending) chosenCollabByGroup.set(gid, pending);
      });

      const allUserIds = [...new Set([
        ...groups.flatMap((r: RankingCollaborationsRow) => [String(r.owner_id ?? '')]),
        ...chosenCollabByGroup.values(),
      ])].filter(Boolean);
      const { data: profiles } = await supabase
        .from('public_profiles')
        .select('id, full_name, avatar_url')
        .in('id', allUserIds);
      const profileById = new Map<string, { full_name?: string | null; avatar_url?: string | null }>(
        (profiles ?? []).map((p: PublicProfilesRow) => [String(p.id), { full_name: p.full_name, avatar_url: p.avatar_url }])
      );
      return groups
        .map((r: RankingCollaborationsRow) => {
          const oid = String(r.owner_id ?? '');
          const cid = chosenCollabByGroup.get(String(r.id ?? '')) ?? '';
          const op = profileById.get(oid);
          const cp = profileById.get(cid);
          return {
            id: String(r.id ?? ''),
            owner_id: oid,
            collaborator_id: cid,
            owner_name: op?.full_name ?? null,
            collaborator_name: cp?.full_name ?? null,
            owner_avatar_url: op?.avatar_url ?? null,
            collaborator_avatar_url: cp?.avatar_url ?? null,
            group_name: (r.group_name as string | null)?.trim() || null,
            is_owner: oid === user.id,
          };
        })
        .sort((a, b) => (a.is_owner ? 0 : 1) - (b.is_owner ? 0 : 1));
    },
    enabled: !!user?.id,
  });

  const activeGroupIds = useMemo(() => new Set(allGroups.map((g) => g.id)), [allGroups]);

  const hasInitializedDefault = useRef(false);
  useEffect(() => {
    if (!user?.id || groupsLoading) return;
    if (selectedCollaborationId && !activeGroupIds.has(selectedCollaborationId)) {
      setSelectedCollaborationId(null);
    }
    if (hasInitializedDefault.current) return;
    if (selectedCollaborationId === null && allGroups.length > 0) {
      hasInitializedDefault.current = true;
      setSelectedCollaborationId(allGroups[0].id);
    }
  }, [user?.id, allGroups, groupsLoading, selectedCollaborationId, activeGroupIds]);

  const isGroupContext = selectedCollaborationId !== null && activeGroupIds.has(selectedCollaborationId);

  const {
    data: sharedRankingsData = null,
    isLoading: sharedRankingsLoading,
  } = useQuery({
    queryKey: ['shared_dorm_rankings', user?.id, selectedCollaborationId],
    queryFn: async () => {
      if (!user?.id || !selectedCollaborationId) {
        return {
          memberIds: [] as string[],
          ownerId: null as string | null,
          personalRankings: [] as UserDormRankingRow[],
        };
      }

      const { data: groupRow } = await supabase
        .from('ranking_collaborations')
        .select('owner_id')
        .eq('id', selectedCollaborationId)
        .single();
      const ownerId = groupRow?.owner_id ?? null;
      if (!ownerId) {
        return { memberIds: [], ownerId: null, personalRankings: [] };
      }
      const { data: memberRows } = await supabase
        .from('ranking_group_members')
        .select('user_id')
        .eq('group_id', selectedCollaborationId)
        .eq('status', 'accepted');
      const memberIdsSet = new Set<string>([ownerId]);
      (memberRows ?? []).forEach((r: RankingGroupMemberRow) => {
        if (r?.user_id) memberIdsSet.add(String(r.user_id));
      });
      if (!memberIdsSet.has(ownerId)) memberIdsSet.add(ownerId);
      const memberIds = Array.from(memberIdsSet);

      const { data: rows, error } = await supabase
        .from('user_dorm_rankings')
        .select('*')
        .in('user_id', memberIds)
        .order('rank_order', { ascending: true });

      if (error) {
        console.error('[RoommatePage] fetch shared personal rankings error:', error);
        return { memberIds: [], ownerId: null, personalRankings: [] };
      }

      const personalRankings = (rows ?? [])
        .filter((row: UserDormRankingsRow) => memberIds.includes(String(row.user_id ?? '')))
        .map((row: UserDormRankingsRow) => ({
          ...row,
          dorm_id: Number(row.dorm_id),
          rank_order: Number(row.rank_order),
        }));

      return {
        memberIds,
        ownerId,
        personalRankings,
      };
    },
    enabled: !!user?.id && !!selectedCollaborationId && activeGroupIds.has(selectedCollaborationId),
  });

  const {
    data: groupOverridesData = [],
  } = useQuery({
    queryKey: ['group_dorm_rankings', selectedCollaborationId],
    queryFn: async (): Promise<Array<{ group_id: string; dorm_id: number; rank_order: number }>> => {
      if (!selectedCollaborationId) return [];
      const { data, error } = await supabase
        .from('group_dorm_rankings')
        .select('group_id, dorm_id, rank_order')
        .eq('group_id', selectedCollaborationId)
        .order('rank_order', { ascending: true });
      if (error) return [];
      return (data ?? []).map((r: GroupDormRankingsRow) => ({
        group_id: String(r.group_id),
        dorm_id: Number(r.dorm_id),
        rank_order: Number(r.rank_order),
      }));
    },
    enabled: !!selectedCollaborationId && activeGroupIds.has(selectedCollaborationId),
  });

  const consensusRankings = useMemo(() => {
    if (!isGroupContext || !user?.id || !sharedRankingsData?.memberIds?.length) return [];
    const personal = sharedRankingsData.personalRankings ?? [];

    const personalByUser = new Map<string, Map<number, number>>();
    for (const uid of sharedRankingsData.memberIds) {
      const userRanks = personal
        .filter((r: UserDormRankingRow) => String(r.user_id) === uid)
        .sort((a: UserDormRankingRow, b: UserDormRankingRow) => a.rank_order - b.rank_order);
      const dormToSeq = new Map<number, number>();
      userRanks.forEach((r: UserDormRankingRow, idx: number) => dormToSeq.set(Number(r.dorm_id), idx + 1));
      personalByUser.set(uid, dormToSeq);
    }

    const memberDormIdSets = sharedRankingsData.memberIds.map(
      (uid) => new Set((personalByUser.get(uid) ?? new Map()).keys())
    );
    const maxLen = Math.max(...memberDormIdSets.map((s) => s.size), 1);
    const penalty = maxLen + 1;

    const allMemberDormIds = [...new Set(memberDormIdSets.flatMap((s) => [...s]))];

    const withAvg = allMemberDormIds.map((dormId) => {
      const ranks = sharedRankingsData.memberIds.map((uid) => {
        const r = (personalByUser.get(uid) ?? new Map()).get(dormId);
        return r ?? penalty;
      });
      const average = ranks.reduce((a, b) => a + b, 0) / ranks.length;
      return { dorm_id: dormId, average };
    });
    withAvg.sort((a, b) => a.average - b.average);
    return withAvg.map((x) => x.dorm_id);
  }, [isGroupContext, user?.id, sharedRankingsData?.memberIds, sharedRankingsData?.personalRankings]);

  const { data: pendingInvites = [] } = useQuery({
    queryKey: ['ranking_group_members_pending', user?.id],
    queryFn: async (): Promise<Array<{ id: string; owner_id: string; owner_name: string | null; owner_avatar_url: string | null; status: string }>> => {
      if (!user?.id) return [];
      const { data: rows, error } = await supabase
        .from('ranking_group_members')
        .select('group_id, status, role, ranking_collaborations(owner_id)')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .neq('role', 'owner');
      if (error) {
        if (import.meta.env.DEV) {
          console.error('[HousingRankingsContent] ranking_group_members pending fetch:', error.message, error.code);
        }
        return [];
      }
      // Callback types inferred from the narrow select above (group_id, status, role,
      // ranking_collaborations(owner_id)) — not the full RankingGroupMemberRow.
      const valid = (rows ?? []).filter(
        (r) =>
          r.ranking_collaborations &&
          String(r.ranking_collaborations?.owner_id ?? '') !== user.id,
      );
      if (!valid.length) return [];
      const ownerIds = [...new Set(valid.map((r) => r.ranking_collaborations?.owner_id).filter(Boolean))];
      const { data: profiles } = await supabase
        .from('public_profiles')
        .select('id, full_name, avatar_url')
        .in('id', ownerIds);
      const profileById = new Map<string, { full_name: string | null; avatar_url: string | null }>(
        (profiles ?? []).map((p: PublicProfilesRow) => [String(p.id), { full_name: p.full_name ?? null, avatar_url: p.avatar_url ?? null }])
      );
      return valid
        .filter((r) => r.status === 'pending')
        .map((r) => {
          const ownerId = r.ranking_collaborations?.owner_id;
          const profile = ownerId ? profileById.get(String(ownerId)) : undefined;
          return {
            id: String(r.group_id),
            owner_id: ownerId ?? '',
            owner_name: profile?.full_name ?? null,
            owner_avatar_url: profile?.avatar_url ?? null,
            status: r.status,
          };
        })
        .filter(Boolean);
    },
    enabled: !!user?.id,
  });

  const pendingCount = pendingInvites.filter((inv) => inv.status === 'pending').length;
  const hasCollaborationsOrPending = allGroups.length >= 1 || pendingCount > 0;

  const selectedGroup = selectedCollaborationId
    ? allGroups.find((g) => g.id === selectedCollaborationId)
    : null;

  const { data: extendedGroupMembers = [] } = useQuery({
    queryKey: ['group_members_extended', selectedCollaborationId],
    queryFn: async (): Promise<Array<{ id: string; role: 'owner' | 'collaborator'; full_name: string | null; avatar_url: string | null; status?: string }>> => {
      if (!selectedCollaborationId) return [];
      const { data: memberRows } = await supabase
        .from('ranking_group_members')
        .select('user_id, role, status')
        .eq('group_id', selectedCollaborationId)
        .eq('status', 'accepted');
      if (!memberRows?.length) return [];
      const ids = memberRows.map((r: RankingGroupMemberRow) => String(r.user_id));
      const uniqueIds = [...new Set(ids)] as string[];
      const { data: profiles } = await supabase
        .from('public_profiles')
        .select('id, full_name, avatar_url')
        .in('id', uniqueIds);
      const profileById = new Map<string, { full_name?: string | null; avatar_url?: string | null }>(
        (profiles ?? []).map((p: PublicProfilesRow) => [String(p.id), { full_name: p.full_name, avatar_url: p.avatar_url }])
      );
      const memberByUserId = new Map<string, { role?: string; status?: string }>(
        memberRows.map((r: RankingGroupMemberRow) => [String(r.user_id), { role: r.role, status: r.status }])
      );
      const list: Array<{ id: string; role: 'owner' | 'collaborator'; full_name: string | null; avatar_url: string | null; status?: string }> = uniqueIds.map((uid: string) => {
        const m = memberByUserId.get(uid);
        const p = profileById.get(uid);
        return {
          id: uid,
          role: (m?.role ?? 'collaborator') as 'owner' | 'collaborator',
          full_name: p?.full_name ?? null,
          avatar_url: p?.avatar_url ?? null,
          status: m?.status ?? 'accepted',
        };
      });
      list.sort((a: { id: string }, b: { id: string }) => {
        if (user?.id && a.id === user.id) return -1;
        if (user?.id && b.id === user.id) return 1;
        return 0;
      });
      return list;
    },
    enabled: !!selectedCollaborationId,
  });

  const { data: pendingCollaborators = [] } = useQuery({
    queryKey: ['group_members_pending_extended', selectedCollaborationId],
    queryFn: async (): Promise<Array<{ id: string; role: 'collaborator'; full_name: string | null; avatar_url: string | null; status: 'pending' }>> => {
      if (!selectedCollaborationId) return [];
      const { data: memberRows } = await supabase
        .from('ranking_group_members')
        .select('user_id, role, status')
        .eq('group_id', selectedCollaborationId)
        .eq('status', 'pending')
        .eq('role', 'collaborator');
      if (!memberRows?.length) return [];
      const ids = memberRows.map((r: RankingGroupMemberRow) => String(r.user_id));
      const uniqueIds = [...new Set(ids)] as string[];
      const { data: profiles } = await supabase
        .from('public_profiles')
        .select('id, full_name, avatar_url')
        .in('id', uniqueIds);
      const profileById = new Map<string, { full_name?: string | null; avatar_url?: string | null }>(
        (profiles ?? []).map((p: PublicProfilesRow) => [String(p.id), { full_name: p.full_name, avatar_url: p.avatar_url }])
      );
      return uniqueIds.map((uid: string) => {
        const p = profileById.get(uid);
        return {
          id: uid,
          role: 'collaborator' as const,
          full_name: p?.full_name ?? null,
          avatar_url: p?.avatar_url ?? null,
          status: 'pending' as const,
        };
      });
    },
    enabled: !!selectedCollaborationId,
  });

  const groupMembers = useMemo(() => {
    if (extendedGroupMembers.length > 0) return extendedGroupMembers;
    if (!selectedGroup) return [];
    const owner = { id: selectedGroup.owner_id, role: 'owner' as const, full_name: selectedGroup.owner_name, avatar_url: selectedGroup.owner_avatar_url, status: 'accepted' as const };
    const collab = { id: selectedGroup.collaborator_id, role: 'collaborator' as const, full_name: selectedGroup.collaborator_name, avatar_url: selectedGroup.collaborator_avatar_url, status: 'accepted' as const };
    const list = [owner, collab].filter((m) => m.id);
    list.sort((a, b) => {
      if (user?.id && a.id === user.id) return -1;
      if (user?.id && b.id === user.id) return 1;
      return 0;
    });
    return list;
  }, [extendedGroupMembers, selectedGroup, user?.id]);

  const showSharedWithBar = isGroupContext && groupMembers.length > 0;
  const selectedGroupDisplayName = selectedGroup
    ? (selectedGroup.group_name?.trim() || (selectedGroup.is_owner ? 'My Group' : `${selectedGroup.owner_name ?? 'Unknown'} & ${selectedGroup.collaborator_name ?? 'Collaborator'}`))
    : null;

  const savedDormsForList = isGroupContext && consensusRankings.length > 0
    ? consensusRankings.map((dorm_id) => ({ dorm_id }))
    : rankingsData?.savedDorms ?? [];
  const savedDormIdsForList = useMemo(() => {
    if (isGroupContext && consensusRankings.length > 0) {
      return new Set(consensusRankings.map(String));
    }
    return savedDormIds;
  }, [isGroupContext, consensusRankings, savedDormIds]);

  const resolvedSavedDorms = useMemo(() => {
    if (!savedDormsForList.length) return [];
    return savedDormsForList.map((row) => {
      const dormId = Number(row.dorm_id);
      const dorm = dorms.find((d) => Number(d.id) === dormId);
      const displayName = dorm?.name ?? `Dorm #${dormId}`;

      const rate =
        typeof dorm?.minRate === 'number' && dorm.minRate > 0
          ? dorm.minRate
          : typeof dorm?.semesterRate === 'number'
            ? dorm.semesterRate
            : null;
      const period =
        dorm?.rentPeriod === 'month'
          ? '/mo'
          : dorm?.rentPeriod === 'semester'
            ? '/sem'
            : '';
      const priceText =
        rate && rate > 0 ? `$${rate.toLocaleString()}/${period ? period.slice(1) : 'sem'}` : '';

      return {
        dormId,
        displayName,
        image: dorm?.image ?? '/placeholder.svg',
        priceText,
      };
    });
  }, [savedDormsForList, dorms]);

  useEffect(() => {
    if (!user?.id) return;

    const channelName = isGroupContext && selectedCollaborationId
      ? `rankings:group:${selectedCollaborationId}`
      : `rankings:user:${user.id}`;
    const groupMemberIds = sharedRankingsData?.memberIds ?? (selectedGroup ? [selectedGroup.owner_id, selectedGroup.collaborator_id].filter(Boolean) : []);
    const filter = isGroupContext && groupMemberIds.length >= 1
      ? `user_id=in.(${groupMemberIds.join(',')})`
      : `user_id=eq.${user.id}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_dorm_rankings',
          filter,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['saved_dorms_and_user_dorm_rankings'] });
          if (isGroupContext) {
            queryClient.invalidateQueries({ queryKey: ['shared_dorm_rankings'] });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, isGroupContext, selectedCollaborationId, selectedGroup, queryClient]);

  useEffect(() => {
    if (!isGroupContext || !selectedCollaborationId) return;

    const channel = supabase
      .channel(`group-rankings:${selectedCollaborationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'group_dorm_rankings',
          filter: `group_id=eq.${selectedCollaborationId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['group_dorm_rankings'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isGroupContext, selectedCollaborationId, queryClient]);

  useEffect(() => {
    const channel = supabase
      .channel('ranking_groups_changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ranking_collaborations' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['all_ranking_groups'] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ranking_group_members' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['all_ranking_groups'] });
          queryClient.invalidateQueries({ queryKey: ['ranking_group_members_pending'] });
          queryClient.invalidateQueries({ queryKey: ['group_members_extended'] });
          queryClient.invalidateQueries({ queryKey: ['group_members_pending_extended'] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  useEffect(() => {
    if (!user?.id) return;

    const channelName = isGroupContext && sharedRankingsData?.ownerId
      ? `presence:${sharedRankingsData.ownerId}`
      : `presence:${user.id}`;

    const channel = supabase.channel(channelName, {
      config: {
        presence: {
          key: user.id,
        },
      },
    })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<{ user_id: string; name?: string; avatar?: string }>();
        const collaborators = new Map<string, { id: string; name: string; avatar?: string }>();

        Object.values(state).forEach((presences: Array<{ user_id: string; name?: string; avatar?: string }>) => {
          presences.forEach((presence: { user_id: string; name?: string; avatar?: string }) => {
            collaborators.set(presence.user_id, {
              id: presence.user_id,
              name: presence.name || 'Unknown',
              avatar: presence.avatar,
            });
          });
        });

        setActiveCollaborators(collaborators);
      })
      .on('presence', { event: 'join' }, ({ newPresences }: { newPresences: Array<{ user_id: string; name?: string; avatar?: string }> }) => {
        const presence = newPresences?.[0];
        if (presence) {
          setActiveCollaborators((prev) => {
            const updated = new Map(prev);
            updated.set(presence.user_id, {
              id: presence.user_id,
              name: presence.name || 'Unknown',
              avatar: presence.avatar,
            });
            return updated;
          });
        }
      })
      .on('presence', { event: 'leave' }, ({ key }: { key: string }) => {
        setActiveCollaborators((prev) => {
          const updated = new Map(prev);
          updated.delete(key);
          return updated;
        });
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, avatar_url')
            .eq('id', user.id)
            .single();

          const displayName = profile?.full_name?.trim() || 'User';

          await channel.track({
            user_id: user.id,
            name: displayName,
            avatar: profile?.avatar_url,
            online_at: new Date().toISOString(),
          });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, isGroupContext, sharedRankingsData?.ownerId]);

  useEffect(() => {
    const saved = resolvedSavedDorms;
    const savedById = new Map(saved.map((item) => [item.dormId, item]));

    if (isGroupContext) {
      if (!consensusRankings.length && !groupOverridesData.length) {
        setOrderedDorms([]);
        return;
      }
      const mathOrder = consensusRankings.filter((dormId) => savedDormIdsForList.has(String(dormId)));
      const mathScoreByDorm = new Map(mathOrder.map((dormId, i) => [dormId, i]));

      let orderedDormIds: number[];
      if (groupOverridesData.length > 0) {
        const manualDormIds = groupOverridesData
          .map((r) => r.dorm_id)
          .filter((dormId) => savedDormIdsForList.has(String(dormId)));
        const manualSet = new Set(manualDormIds);
        const onlyInMath = mathOrder.filter((dormId) => !manualSet.has(dormId));
        onlyInMath.sort((a, b) => (mathScoreByDorm.get(a) ?? 9999) - (mathScoreByDorm.get(b) ?? 9999));
        orderedDormIds = [...manualDormIds, ...onlyInMath];
      } else {
        orderedDormIds = mathOrder;
      }

      const acceptedMemberIds = new Set(sharedRankingsData?.memberIds ?? []);
      const votersByDorm = new Map<number, string[]>();
      (sharedRankingsData?.personalRankings ?? []).forEach((row: { user_id?: string; dorm_id: number }) => {
        const uid = row.user_id ? String(row.user_id) : null;
        if (!uid || !acceptedMemberIds.has(uid)) return;
        const did = Number(row.dorm_id);
        if (!votersByDorm.has(did)) votersByDorm.set(did, []);
        const list = votersByDorm.get(did)!;
        if (!list.includes(uid)) list.push(uid);
      });
      const memberById = new Map(groupMembers.map((m) => [m.id, m]));

      const ordered: RankingItem[] = orderedDormIds.map((dormId) => {
        const dorm = savedById.get(dormId);
        const base = dorm ?? {
          dormId,
          displayName: `Dorm #${dormId}`,
          image: '/placeholder.svg',
          priceText: '',
        };
        const voterIds = (votersByDorm.get(dormId) ?? []).filter((uid) => acceptedMemberIds.has(uid));
        const voters = voterIds
          .map((uid) => memberById.get(uid))
          .filter(Boolean)
          .map((m) => ({
            id: m!.id,
            name: (m!.full_name ?? 'Unknown').trim() || 'Unknown',
            avatar: m!.avatar_url ?? null,
          }));
        return { ...base, voters: voters.length > 0 ? voters : undefined };
      });
      setOrderedDorms(ordered);
      return;
    }

    const dataToUse = rankingsData;
    if (!dataToUse) return;

    const existing = (dataToUse as RankingsQueryResult).rankings || [];
    if (!saved.length) {
      setOrderedDorms([]);
      return;
    }

    if (!existing.length) {
      setOrderedDorms(saved);
      return;
    }

    const rankedIds = new Set<number>();
    const orderedFromRankings: RankingItem[] = existing
      .slice()
      .sort((a: UserDormRankingRow, b: UserDormRankingRow) => a.rank_order - b.rank_order)
      .map((row: UserDormRankingRow) => {
        const dormId = Number(row.dorm_id);
        rankedIds.add(dormId);
        const dorm = savedById.get(dormId);
        return (
          dorm ?? {
            dormId,
            displayName: `Dorm #${dormId}`,
            image: '/placeholder.svg',
            priceText: '',
          }
        );
      });

    const unrankedSaved: RankingItem[] = saved.filter(
      (item) => !rankedIds.has(item.dormId)
    );

    const combined = [...orderedFromRankings, ...unrankedSaved];
    const filtered = combined.filter((item) => savedDormIdsForList.has(String(item.dormId)));
    setOrderedDorms(filtered);
  }, [rankingsData, sharedRankingsData, resolvedSavedDorms, savedDormIdsForList, isGroupContext, consensusRankings, groupOverridesData, groupMembers]);

  const openInviteModal = (addToId?: string | null) => {
    if (!user) {
      navigate('/auth');
      return;
    }
    setAddToGroupIdForInvite(addToId ?? null);
    setCollaborateModalOpenForCreate(addToId == null);
    setCollaborateModalOpen(true);
  };

  const handleAcceptInvite = async (inviteId: string) => {
    if (!user?.id) return;
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser?.id || authUser.id !== user.id) {
      toast.error(t('housing:rankings.toasts.unableToJoinGroup'));
      await queryClient.invalidateQueries({ queryKey: ['ranking_group_members_pending'] });
      return;
    }
    const errorToast = () =>
      toast.error(t('housing:rankings.toasts.unableToJoinGroup'));
    const doSuccess = async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ranking_group_members_pending'] }),
        queryClient.invalidateQueries({ queryKey: ['all_ranking_groups'] }),
        queryClient.invalidateQueries({ queryKey: ['shared_dorm_rankings'] }),
        queryClient.invalidateQueries({ queryKey: ['group_members_extended'] }),
        queryClient.invalidateQueries({ queryKey: ['group_dorm_rankings'] }),
      ]);
      toast.success(t('housing:rankings.toasts.invitationAccepted'));
    };
    try {
      const { data: preCheck } = await supabase
        .from('ranking_group_members')
        .select('id, status')
        .eq('group_id', inviteId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!preCheck) {
        toast.error(t('housing:rankings.toasts.invitationExpired'));
        await queryClient.invalidateQueries({ queryKey: ['ranking_group_members_pending'] });
        return;
      }
      if (preCheck.status === 'accepted') {
        await doSuccess();
        return;
      }
      const { data: memberRows, error: memberError } = await supabase
        .from('ranking_group_members')
        .update({ status: 'accepted' })
        .eq('group_id', inviteId)
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .neq('role', 'owner')
        .select('id');
      if (memberError) {
        errorToast();
        await queryClient.invalidateQueries({ queryKey: ['ranking_group_members_pending'] });
        return;
      }
      if (!memberRows || memberRows.length === 0) {
        const { data: recheck } = await supabase
          .from('ranking_group_members')
          .select('id, status')
          .eq('group_id', inviteId)
          .eq('user_id', user.id)
          .maybeSingle();
        if (recheck?.status === 'accepted') {
          await doSuccess();
          return;
        }
        toast.error(t('housing:rankings.toasts.invitationExpired'));
        await queryClient.invalidateQueries({ queryKey: ['ranking_group_members_pending'] });
        return;
      }
      await doSuccess();
    } catch {
      errorToast();
      await queryClient.invalidateQueries({ queryKey: ['ranking_group_members_pending'] });
    }
  };

  const handleDeclineInvite = async (inviteId: string) => {
    if (!user?.id) return;
    const { error } = await supabase
      .from('ranking_group_members')
      .delete()
      .eq('group_id', inviteId)
      .eq('user_id', user.id)
      .neq('role', 'owner');
    if (error) {
      toast.error(t('housing:rankings.toasts.couldNotDeclineInvite'));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['ranking_group_members_pending'] });
    await queryClient.invalidateQueries({ queryKey: ['all_ranking_groups'] });
    toast(t('housing:rankings.toasts.invitationDeclined'));
  };

  const handleLeaveGroup = async (collaborationId: string) => {
    if (!user?.id) return;
    const confirmed = window.confirm(
      t('housing:rankings.confirmDialogs.leaveGroup')
    );
    if (!confirmed) return;

    const memberCount = groupMembers.length;
    if (memberCount > 1) {
      const { error } = await supabase
        .from('ranking_group_members')
        .delete()
        .eq('user_id', user.id)
        .eq('group_id', collaborationId);
      if (error) {
        toast.error(t('housing:rankings.toasts.couldNotLeaveGroup'));
        return;
      }
      await supabase
        .from('user_dorm_rankings')
        .delete()
        .eq('group_id', collaborationId)
        .eq('user_id', user.id);
    } else {
      const { error } = await supabase
        .from('ranking_collaborations')
        .delete()
        .eq('id', collaborationId);
      if (error) {
        toast.error(t('housing:rankings.toasts.couldNotLeaveGroup'));
        return;
      }
    }

    setSelectedCollaborationId(null);
    setEditingGroupName(null);
    setEditGroupNameValue('');
    await queryClient.invalidateQueries({ queryKey: ['all_ranking_groups'] });
    await queryClient.invalidateQueries({ queryKey: ['shared_dorm_rankings'] });
    await queryClient.invalidateQueries({ queryKey: ['group_members_extended'] });
    await queryClient.invalidateQueries({ queryKey: ['group_dorm_rankings'] });
    await queryClient.invalidateQueries({ queryKey: ['group_members_pending_extended'] });
    toast(t('housing:rankings.toasts.leftGroup'));
  };

  const handleCancelPendingInvite = async (pendingUserId: string) => {
    if (!selectedCollaborationId || !user?.id) return;
    const { error } = await supabase
      .from('ranking_group_members')
      .delete()
      .eq('group_id', selectedCollaborationId)
      .eq('user_id', pendingUserId)
      .eq('status', 'pending');
    if (error) {
      toast.error(t('housing:rankings.toasts.couldNotCancelInvite'));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['group_members_pending_extended'] });
    await queryClient.invalidateQueries({ queryKey: ['all_ranking_groups'] });
    toast(t('housing:rankings.toasts.inviteCancelled'));
  };

  const handleSaveGroupName = async (collaborationId: string, newName: string) => {
    if (!user?.id) return;
    const trimmed = sanitizeOptional(newName);
    const { error } = await supabase
      .from('ranking_collaborations')
      .update({ group_name: trimmed })
      .eq('id', collaborationId);
    if (error) {
      toast.error(t('housing:rankings.toasts.couldNotUpdateGroupName'));
      return;
    }
    setEditingGroupName(null);
    setEditGroupNameValue('');
    await queryClient.invalidateQueries({ queryKey: ['all_ranking_groups'] });
    await queryClient.invalidateQueries({ queryKey: ['shared_dorm_rankings'] });
    await queryClient.refetchQueries({ queryKey: ['all_ranking_groups'] });
    toast.success(t('housing:rankings.toasts.groupNameUpdated'));
  };

  const handleReorder = async (newOrder: RankingItem[]) => {
    if (isGroupContext) return;
    setOrderedDorms(newOrder);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) return;

      const upsertPayload = newOrder.map((item, index) => ({
        user_id: user.id,
        dorm_id: Number(item.dormId),
        rank_order: index + 1,
      }));

      const { error } = await supabase
        .from('user_dorm_rankings')
        .upsert(upsertPayload, { onConflict: 'user_id,dorm_id' });

      if (error) {
        toast.error(t('housing:rankings.toasts.saveFailed'), {
          description: t('housing:rankings.toasts.saveFailedDescription'),
        });
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ['saved_dorms_and_user_dorm_rankings'] });
      await queryClient.invalidateQueries({ queryKey: ['shared_dorm_rankings'] });
      toast.success(t('housing:rankings.toasts.personalListSaved'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[RoommatePage] unexpected error while saving rankings:', message);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as number);
    if ('vibrate' in navigator) {
      navigator.vibrate(10);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (over && active.id !== over.id) {
      setOrderedDorms((items) => {
        const oldIndex = items.findIndex((item) => item.dormId === active.id);
        const newIndex = items.findIndex((item) => item.dormId === over.id);
        const newOrder = arrayMove(items, oldIndex, newIndex);
        if (isGroupContext && selectedCollaborationId) {
          const payload = newOrder.map((item, index) => ({
            group_id: selectedCollaborationId,
            dorm_id: Number(item.dormId),
            rank_order: index + 1,
          }));
          (async () => {
            const { error } = await supabase
              .from('group_dorm_rankings')
              .upsert(payload, { onConflict: 'group_id,dorm_id' });
            if (!error) {
              queryClient.invalidateQueries({ queryKey: ['group_dorm_rankings'] });
            }
          })();
        } else {
          handleReorder(newOrder);
        }
        return newOrder;
      });
    }
  };

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 mt-12 min-h-[280px]">
        <ListOrdered className="w-12 h-12 text-malachite-600/50 mb-4" />
        <h3 className="text-xl font-bold text-foreground mb-2">{t('housing:rankings.unauthenticated.title')}</h3>
        <p className="text-sm text-muted-foreground text-center max-w-xs mb-6">
          {t('housing:rankings.unauthenticated.description')}
        </p>
        <Button
          onClick={() => navigate('/auth')}
          className="rounded-full px-8 py-6 text-base font-bold bg-malachite-800 hover:bg-malachite-900 text-white"
        >
          {t('housing:rankings.unauthenticated.signInButton')}
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {pendingCount > 0 && (
        <div className="space-y-3 mb-4">
          {pendingInvites.filter((inv) => inv.status === 'pending').map((inv) => {
            const ownerName = inv.owner_name ?? 'Someone';
            const initials = ownerName
              .split(' ')
              .map((n) => n[0])
              .join('')
              .toUpperCase()
              .substring(0, 2);
            return (
              <div
                key={inv.id}
                className="rounded-xl border border-malachite-600/30 bg-malachite-600/5 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <Avatar className="h-10 w-10 shrink-0 rounded-full border-2 border-background">
                    <AvatarImage src={inv.owner_avatar_url ?? undefined} />
                    <AvatarFallback className="bg-malachite-600/20 text-malachite-800 text-sm font-semibold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <p className="text-sm text-foreground">
                    {ownerName}
                    {' '}
                    {t('housing:rankings.invites.invitedYouLabel')}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0 sm:pl-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleDeclineInvite(inv.id)}
                  >
                    {t('housing:rankings.invites.decline')}
                  </Button>
                  <Button
                    size="sm"
                    className="bg-malachite-800 hover:bg-malachite-900 text-white"
                    onClick={() => handleAcceptInvite(inv.id)}
                  >
                    {t('housing:rankings.invites.accept')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h2 className="text-xl font-bold text-foreground">{t('housing:rankings.header.title')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {hasCollaborationsOrPending ? (
            <DropdownMenu open={groupDropdownOpen} onOpenChange={setGroupDropdownOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-[220px] justify-between shrink-0',
                    isGroupContext && 'border-malachite-600 bg-malachite-600/10 text-malachite-800 hover:bg-malachite-600/15'
                  )}
                >
                  {selectedGroupDisplayName ?? 'Personal Rankings'}
                  <ChevronDown className="h-4 w-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[220px]">
                <DropdownMenuItem
                  onClick={() => {
                    setSelectedCollaborationId(null);
                    setGroupDropdownOpen(false);
                  }}
                  className={cn(!isGroupContext && 'bg-malachite-600/10 text-malachite-600')}
                >
                  {t('housing:rankings.dropdown.personalRankings')}
                </DropdownMenuItem>
                {allGroups.map((g) => {
                  const label = g.group_name?.trim()
                    || (g.is_owner ? 'My Group' : `${g.owner_name ?? 'Unknown'} & ${g.collaborator_name ?? 'Collaborator'}`);
                  const isActive = selectedCollaborationId === g.id;
                  return (
                    <DropdownMenuItem
                      key={g.id}
                      onClick={() => {
                        setSelectedCollaborationId(g.id);
                        setGroupDropdownOpen(false);
                      }}
                      className={cn(isActive && 'bg-malachite-600/10 text-malachite-600')}
                    >
                      {label}
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setGroupDropdownOpen(false);
                    openInviteModal(null);
                  }}
                  className="text-malachite-600 focus:bg-malachite-600/10 focus:text-malachite-600"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t('housing:rankings.dropdown.createNewGroup')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {!isGroupContext && (
            <Button
              size="sm"
              onClick={() => openInviteModal(null)}
              className="bg-malachite-800 hover:bg-malachite-900 text-white shrink-0"
            >
              <Users2 className="w-4 h-4 mr-2" />
              {t('housing:rankings.actions.collaborate')}
            </Button>
          )}
        </div>
      </div>

      {(isGroupContext ? sharedRankingsLoading : rankingsLoading) ? (
        <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
          {t('housing:rankings.states.loading', { context: isGroupContext ? 'shared' : 'personal' })}
        </div>
      ) : (!isGroupContext && rankingsError) ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 px-6 text-center">
            <p className="text-muted-foreground mb-4">
              {t('housing:rankings.states.error')}
            </p>
            <Button variant="outline" onClick={() => window.location.reload()}>
              {t('common:actions.retry')}
            </Button>
          </CardContent>
        </Card>
      ) : isGroupContext && (!sharedRankingsData || !sharedRankingsData.personalRankings?.length) ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 px-6 text-center">
            <Users2 className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">
              {t('housing:rankings.states.emptyGroup')}
            </p>
            <Button
              size="lg"
              onClick={() => openInviteModal(selectedCollaborationId)}
              className="bg-malachite-800 hover:bg-malachite-900 text-white gap-2"
            >
              <Users2 className="w-5 h-5" />
              {t('housing:rankings.actions.inviteRoommate')}
            </Button>
          </CardContent>
        </Card>
      ) : !orderedDorms.length ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 px-6 text-center">
            <ListOrdered className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">
              {t('housing:rankings.states.empty')}
            </p>
            <Button
              variant="outline"
              onClick={() => navigate('/')}
              className="gap-2"
            >
              {t('housing:rankings.actions.goToCampus')}
              <ChevronRight className="w-4 h-4" />
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {!isGroupContext && (
            <div className="rounded-xl border border-muted bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{t('housing:rankings.badges.private')}</span> - {t('housing:rankings.badges.privateDescription')}
            </div>
          )}
          {isGroupContext && groupOverridesData.length === 0 && (
            <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm text-foreground">
              ✨ {t('housing:rankings.badges.smartConsensus')}
            </div>
          )}
          {isGroupContext && selectedGroupDisplayName && (
            <div className="rounded-xl border border-malachite-600/30 bg-malachite-600/10 px-4 py-2 flex flex-wrap items-center gap-2">
              <span className="text-sm text-foreground">
                {t('housing:rankings.group.viewing')}: <span className="font-semibold">{selectedGroupDisplayName}</span>
              </span>
              <div className="flex items-center gap-2">
                {selectedCollaborationId && editingGroupName === selectedCollaborationId ? (
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSaveGroupName(selectedCollaborationId, editGroupNameValue);
                    }}
                  >
                    <Input
                      ref={editGroupNameInputRef}
                      value={editGroupNameValue}
                      onChange={(e) => setEditGroupNameValue(e.target.value)}
                      placeholder={t('housing:rankings.group.groupNamePlaceholder')}
                      className="h-8 w-40"
                    />
                    <Button type="submit" size="sm" className="h-8 bg-malachite-800 hover:bg-malachite-900 text-white">
                      {t('common:actions.save')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingGroupName(null);
                        setEditGroupNameValue('');
                      }}
                    >
                      {t('common:actions.cancel')}
                    </Button>
                  </form>
                ) : (
                  <>
                    {selectedCollaborationId && editingGroupName !== selectedCollaborationId && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-malachite-600 hover:bg-malachite-600/20"
                        onClick={() => {
                          setEditingGroupName(selectedCollaborationId);
                          setEditGroupNameValue(selectedGroupDisplayName || '');
                        }}
                        aria-label={t('housing:rankings.ariaLabels.editGroupName')}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCollaborateModalOpenForCreate(false);
                        setAddToGroupIdForInvite(selectedCollaborationId ?? null);
                        setCollaborateModalOpen(true);
                      }}
                      className="shrink-0 border-malachite-600 text-malachite-600 hover:bg-malachite-600/10"
                    >
                      <Users2 className="w-4 h-4 mr-1.5" />
                      {t('housing:rankings.actions.invite')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => selectedCollaborationId && handleLeaveGroup(selectedCollaborationId)}
                      className="shrink-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      {t('housing:rankings.actions.leaveGroup')}
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
          {showSharedWithBar && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">{t('housing:rankings.members.sharedWith')}</p>
              <p className="text-xs font-medium text-muted-foreground opacity-80">{t('housing:rankings.members.accepted')}</p>
              <div className="flex flex-wrap items-center gap-3">
                {groupMembers.map((member) => {
                  const isOnline = activeCollaborators.has(member.id);
                  const initials = (member.full_name ?? '?')
                    .trim()
                    .split(/\s+/)
                    .map((n) => n[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase();
                  const displayName = (member.full_name ?? 'Member').trim() || '?';
                  const isMe = member.id === user?.id;
                  return (
                    <div
                      key={member.id}
                      className={cn(
                        'flex items-center gap-2 rounded-full border pl-1 pr-3 py-1 shadow-raised',
                        isMe ? 'border-malachite-600 bg-malachite-600/5 font-semibold' : 'border-border bg-card'
                      )}
                    >
                      <div className="relative shrink-0">
                        <Avatar className="h-8 w-8 rounded-full border-2 border-border">
                          <AvatarImage src={member.avatar_url ?? undefined} />
                          <AvatarFallback
                            className={cn(
                              'text-xs',
                              isMe ? 'bg-malachite-600/20 text-malachite-600' : 'bg-muted text-muted-foreground'
                            )}
                          >
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        {isOnline && (
                          <span
                            className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-malachite-600 border-2 border-white"
                            aria-label={t('housing:rankings.ariaLabels.online')}
                          />
                        )}
                      </div>
                      <span
                        className={cn(
                          'text-sm',
                          isMe ? 'font-semibold text-foreground' : 'font-medium text-foreground'
                        )}
                      >
                        {displayName}
                      </span>
                    </div>
                  );
                })}
                {selectedCollaborationId && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0 rounded-full border-2 border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5"
                    onClick={() => openInviteModal(selectedCollaborationId)}
                    aria-label={t('housing:rankings.ariaLabels.addMember')}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {pendingCollaborators.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border">
                  <p className="text-xs font-medium text-muted-foreground w-full">{t('housing:rankings.members.pending')}</p>
                  {pendingCollaborators.map((p) => {
                    const initials = (p.full_name ?? '?')
                      .trim()
                      .split(/\s+/)
                      .map((n) => n[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase();
                    return (
                      <div key={p.id} className="flex items-center gap-2 opacity-75">
                        <Avatar className="h-9 w-9 rounded-full border-2 border-background">
                          <AvatarImage src={p.avatar_url ?? undefined} />
                          <AvatarFallback className="bg-muted text-muted-foreground text-xs rounded-full">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm text-muted-foreground">{p.full_name ?? 'Unknown'}</span>
                        <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                          {t('housing:rankings.members.pendingBadge')}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => handleCancelPendingInvite(p.id)}
                          aria-label={t('housing:rankings.ariaLabels.removeInvite', { name: p.full_name ?? 'user' })}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={orderedDorms.map((item) => item.dormId)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-2">
                {orderedDorms.map((item, index) => (
                  <SortableRankingItem
                    key={item.dormId}
                    item={item}
                    index={index}
                  />
                ))}
              </ul>
            </SortableContext>
            <DragOverlay>
              {activeId ? (
                <div className="opacity-90">
                  {(() => {
                    const activeItem = orderedDorms.find((item) => item.dormId === activeId);
                    if (!activeItem) return null;
                    const activeIndex = orderedDorms.findIndex((item) => item.dormId === activeId);
                    return (
                      <Card className="flex flex-row items-center gap-3 scale-105 shadow-overlay">
                        <div className="flex h-12 w-10 shrink-0 items-center justify-center rounded-l-lg bg-transparent text-muted-foreground">
                          <Grip className="w-5 h-5" strokeWidth={2} />
                        </div>
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/5 text-base font-semibold text-primary">
                          {activeIndex + 1}
                        </div>
                        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md">
                          <img
                            src={activeItem.image}
                            alt={activeItem.displayName}
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <CardContent className="flex flex-1 items-center justify-between py-4 pl-0 pr-4 min-w-0">
                          <div className="flex flex-col min-w-0">
                            <p className="font-semibold text-foreground">
                              {activeItem.displayName}
                            </p>
                            {activeItem.priceText && (
                              <p className="text-xs text-muted-foreground">
                                {activeItem.priceText}
                              </p>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })()}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </>
      )}

      <CollaborateModal
        open={collaborateModalOpen}
        onOpenChange={(open) => {
          setCollaborateModalOpen(open);
          if (!open) {
            setAddToGroupIdForInvite(null);
            setCollaborateModalOpenForCreate(false);
            queryClient.invalidateQueries({ queryKey: ['all_ranking_groups'] });
            queryClient.invalidateQueries({ queryKey: ['group_members_extended'] });
            queryClient.invalidateQueries({ queryKey: ['group_members_pending_extended'] });
            queryClient.invalidateQueries({ queryKey: ['shared_dorm_rankings'] });
          }
        }}
        currentGroupId={collaborateModalOpenForCreate ? null : (addToGroupIdForInvite ?? selectedCollaborationId)}
        createMode={collaborateModalOpenForCreate}
        onGroupCreated={(groupId) => {
          setSelectedCollaborationId(groupId);
          setCollaborateModalOpenForCreate(false);
          queryClient.invalidateQueries({ queryKey: ['all_ranking_groups'] });
          queryClient.invalidateQueries({ queryKey: ['group_members_extended'] });
          queryClient.invalidateQueries({ queryKey: ['shared_dorm_rankings'] });
        }}
      />
    </div>
  );
}
