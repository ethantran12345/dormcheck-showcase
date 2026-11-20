import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCollaboration } from "@/hooks/useCollaboration";
import { useChecklistSettlementContext } from "@/hooks/useChecklistSettlementContext";
import { fetchAllChecklistGroups } from "@/components/checklist/checklistServer";
import {
  pickFirstNonEmpty,
  buildDisambiguatedMemberLabels,
} from "@/components/checklist/checklistHelpers";
import type { GroupMember } from "@/components/checklist/checklistTypes";

/**
 * The group surface - your roommate/collaborator group, its members, and the
 * invite/manage modal state.
 *
 * Pulled out of ChecklistPage in the §5b split. The point of the extraction is
 * scope: this is a **year-long** concern, not a checklist tab. Your group in
 * August is your group in April, so Logistics (Move In *and* Move Out) reads the
 * same hook rather than each surface growing its own copy. Nothing here knows
 * about checklist items.
 *
 * NOTE: this does NOT collapse the `group_type = 'checklist'` vs
 * `group_type = 'roommate'` split. That distinction is enforced in Postgres
 * (CHECK constraint + five notification/push functions) and cannot be merged in
 * a behaviour-preserving frontend refactor - see docs/handoffs for the write-up.
 */
export type CollaborateGroupType = 'checklist' | 'roommate';

export function useGroupSurface() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const {
    activeChecklistGroupId: selectedGroupId,
    setActiveChecklistGroupId: setSelectedGroupId,
  } = useCollaboration();

  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false);
  const [isCollaborateOpen, setIsCollaborateOpen] = useState(false);
  const [collaborateOpenForCreate, setCollaborateOpenForCreate] = useState(false);
  const [collaborateGroupType, setCollaborateGroupType] = useState<CollaborateGroupType>('checklist');
  const [editingGroupName, setEditingGroupName] = useState<string | null>(null);
  const [editGroupNameValue, setEditGroupNameValue] = useState('');
  const [groupManageSheetOpen, setGroupManageSheetOpen] = useState(false);

  const {
    data: allGroups = [],
    isLoading: groupsLoading,
    isError: groupsError,
    refetch: refetchGroups,
  } = useQuery({
    queryKey: ['all_ranking_groups', user?.id],
    queryFn: () => (user?.id ? fetchAllChecklistGroups(user.id) : []),
    enabled: !!user?.id,
  });

  const activeGroupIds = useMemo(() => new Set(allGroups.map((g) => g.id)), [allGroups]);
  const isGroupContext = selectedGroupId !== null && activeGroupIds.has(selectedGroupId);
  const selectedGroup = selectedGroupId ? allGroups.find((g) => g.id === selectedGroupId) : null;
  const selectedGroupDisplayName = selectedGroup
    ? (selectedGroup.group_name?.trim() || (selectedGroup.is_owner ? 'My Group' : `${selectedGroup.owner_name ?? 'Unknown'} & ${selectedGroup.collaborator_name ?? 'Collaborator'}`))
    : null;

  /** Last opened shared list - used to load group item names while viewing Personal for cross-list hints. */
  const [pairedGroupForCrossList, setPairedGroupForCrossList] = useState<string | null>(null);
  useEffect(() => {
    if (isGroupContext && selectedGroupId) setPairedGroupForCrossList(selectedGroupId);
  }, [isGroupContext, selectedGroupId]);

  // Close the manage sheet when the selection moves to a DIFFERENT group than
  // the one it was opened for. It used to close on any selectedGroupId change,
  // so the hub's "Manage list" (which selects the group and opens the sheet in
  // the same tick) was closed again before it ever showed.
  const manageTargetRef = useRef<string | null>(null);
  useEffect(() => {
    if (manageTargetRef.current !== null && manageTargetRef.current === selectedGroupId) return;
    manageTargetRef.current = null;
    setGroupManageSheetOpen(false);
  }, [selectedGroupId]);
  const openManageGroup = useCallback((groupId: string) => {
    manageTargetRef.current = groupId;
    setSelectedGroupId(groupId);
    setGroupManageSheetOpen(true);
  }, [setSelectedGroupId]);

  /** Personal view: pair with a group for cross-list item names even before user opens the group tab. */
  useEffect(() => {
    if (!user?.id || selectedGroupId != null) return;
    setPairedGroupForCrossList((prev) => {
      if (allGroups.length === 0) return null;
      if (prev != null && allGroups.some((g) => g.id === prev)) return prev;
      return allGroups[0]!.id;
    });
  }, [user?.id, selectedGroupId, allGroups]);

  const { data: groupMembersBase = [] } = useQuery({
    queryKey: ['checklist_group_members', selectedGroupId],
    queryFn: async (): Promise<GroupMember[]> => {
      if (!selectedGroupId) return [];
      interface GroupMemberRow {
        id: string;
        user_id: string;
        role: string;
        status: string;
      }
      const { data: rows, error } = await supabase
        .from('ranking_group_members')
        .select('id, user_id, role, status')
        .eq('group_id', selectedGroupId)
        .eq('status', 'accepted');
      if (error || !rows?.length) return [];
      const userIds = [...new Set((rows as GroupMemberRow[]).map((r) => String(r.user_id)))];
      interface ProfileRow {
        id: string;
        full_name: string | null;
        avatar_url: string | null;
      }
      const { data: profiles } = await supabase
        .from('public_profiles')
        .select('id, full_name, avatar_url')
        .in('id', userIds);
      const profileById = new Map(
        (profiles as ProfileRow[] | null ?? []).map((p) => [
          String(p.id),
          {
            full_name: p.full_name,
            avatar_url: p.avatar_url,
          },
        ])
      );
      const result: GroupMember[] = (rows as GroupMemberRow[]).map((r) => {
        const p = profileById.get(String(r.user_id));
        return {
          id: r.id,
          user_id: String(r.user_id),
          full_name: p?.full_name ?? null,
          avatar_url: p?.avatar_url ?? null,
          role: (r.role ?? 'collaborator') as 'owner' | 'collaborator',
          status: r.status ?? 'accepted',
        };
      });
      result.sort((a, b) => {
        if (user?.id && a.user_id === user.id) return -1;
        if (user?.id && b.user_id === user.id) return 1;
        return 0;
      });
      return result;
    },
    enabled: !!selectedGroupId,
  });

  const { context: settlementContext } = useChecklistSettlementContext(selectedGroupId ?? null);

  const groupMembers = useMemo((): GroupMember[] => {
    const settlementByUserId = new Map(
      settlementContext.members.map((m) => [m.user_id, m]),
    );
    return groupMembersBase.map((member) => {
      const settlement = settlementByUserId.get(member.user_id);
      return {
        ...member,
        full_name: pickFirstNonEmpty(member.full_name, settlement?.full_name),
        venmo_username: settlement?.venmo_username ?? null,
        zelle_info: settlement?.zelle_info ?? null,
      };
    });
  }, [groupMembersBase, settlementContext.members]);

  const groupMemberProfiles = useMemo(
    () => groupMembers.map((m) => ({ user_id: m.user_id, full_name: m.full_name, avatar_url: m.avatar_url })),
    [groupMembers]
  );

  const assigneeLabels = useMemo(
    () =>
      buildDisambiguatedMemberLabels(
        groupMembers.map((m) => ({ user_id: m.user_id, full_name: m.full_name })),
      ),
    [groupMembers]
  );

  useEffect(() => {
    if (editingGroupName) {
      const timer = setTimeout(() => {
        document.getElementById('edit-group-name-input')?.focus({ preventScroll: true });
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [editingGroupName]);

  const handleLeaveGroup = async () => {
    if (!selectedGroupId || !user) return;
    const confirmed = window.confirm(
      t('checklist:page.confirmLeaveGroup')
    );
    if (!confirmed) return;

    const { data: memberRows, error: countError } = await supabase
      .from('ranking_group_members')
      .select('id')
      .eq('group_id', selectedGroupId);
    if (countError || !memberRows) {
      toast.error(t('checklist:page.couldNotLeaveGroup'));
      return;
    }
    const memberCount = memberRows.length;

    if (memberCount === 1) {
      // Last member - delete the group (ranking_collaborations CASCADE removes ranking_group_members)
      const { error } = await supabase
        .from('ranking_collaborations')
        .delete()
        .eq('id', selectedGroupId);
      if (error) {
        toast.error(t('checklist:page.couldNotLeaveGroup'));
        return;
      }
    } else if (memberCount > 1) {
      // Multiple members - remove only self from ranking_group_members
      const { error } = await supabase
        .from('ranking_group_members')
        .delete()
        .eq('user_id', user.id)
        .eq('group_id', selectedGroupId);
      if (error) {
        toast.error(t('checklist:page.couldNotLeaveGroup'));
        return;
      }
    }

    const leftGroupId = selectedGroupId;
    setSelectedGroupId(null);
    await queryClient.invalidateQueries({ queryKey: ['all_ranking_groups'] });
    await queryClient.invalidateQueries({ queryKey: ['checklist_group_members'] });
    await queryClient.invalidateQueries({ queryKey: ['checklist-settlement-context', leftGroupId] });
    await queryClient.invalidateQueries({ queryKey: ['group_dorm_rankings'] });
    toast(t('checklist:page.leftGroup'));
  };

  const handleSaveGroupName = async (collaborationId: string, newName: string) => {
    if (!user?.id) return;
    const { sanitizeOptional } = await import('@/lib/sanitize');
    const trimmed = sanitizeOptional(newName);
    const { error } = await supabase
      .from('ranking_collaborations')
      .update({ group_name: trimmed })
      .eq('id', collaborationId);
    if (error) {
      toast.error(t('checklist:page.couldNotUpdateGroupName'));
      return;
    }
    setEditingGroupName(null);
    setEditGroupNameValue('');
    await queryClient.invalidateQueries({ queryKey: ['all_ranking_groups'] });
    toast.success(t('checklist:page.groupNameUpdated'));
  };

  /** Open the invite flow for the current group. */
  const openInvite = () => {
    setCollaborateOpenForCreate(false);
    setIsCollaborateOpen(true);
  };

  /** Open the create-a-new-group flow. */
  const openCreateGroup = () => {
    setCollaborateOpenForCreate(true);
    setIsCollaborateOpen(true);
  };

  return {
    // identity
    selectedGroupId,
    setSelectedGroupId,
    allGroups,
    groupsLoading,
    // A failed read must not read as "no groups" (contract §7).
    groupsError,
    refetchGroups,
    hasGroups: allGroups.length > 0,
    isGroupContext,
    selectedGroupDisplayName,
    pairedGroupForCrossList,
    // members
    groupMembers,
    groupMemberProfiles,
    assigneeLabels,
    // modal state
    groupDropdownOpen,
    setGroupDropdownOpen,
    isCollaborateOpen,
    setIsCollaborateOpen,
    collaborateOpenForCreate,
    setCollaborateOpenForCreate,
    collaborateGroupType,
    setCollaborateGroupType,
    editingGroupName,
    setEditingGroupName,
    editGroupNameValue,
    setEditGroupNameValue,
    groupManageSheetOpen,
    setGroupManageSheetOpen,
    openManageGroup,
    // actions
    openInvite,
    openCreateGroup,
    handleLeaveGroup,
    handleSaveGroupName,
  };
}

export type GroupSurface = ReturnType<typeof useGroupSurface>;
