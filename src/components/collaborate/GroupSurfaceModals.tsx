import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { CollaborateModal } from "@/components/collaborate/CollaborateModal";
import { ReceivedInvitations } from "@/components/collaborate/ReceivedInvitations";
import { ChecklistManageGroupSheet } from "@/components/checklist/ChecklistManageGroupSheet";
import { getInitials, resolveGroupMemberLabel } from "@/components/checklist/checklistHelpers";
import type { GroupSurface } from "@/hooks/useGroupSurface";

/**
 * Every piece of group chrome that is not the group's *content*: the pending-
 * invitation banner, the manage-group sheet, and the invite/create modal.
 *
 * Extracted from ChecklistPage in the §5b split so the same surface can mount on
 * any page that reads `useGroupSurface()` - the checklist today, Logistics
 * (Move In / Move Out) alongside it. Behaviour matches what ChecklistPage
 * rendered inline; nothing here is checklist-specific.
 */
export function GroupSurfaceModals({
  group,
  bannerClassName,
  showBanner = true,
}: {
  group: GroupSurface;
  bannerClassName?: string;
  showBanner?: boolean;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const {
    selectedGroupId,
    setSelectedGroupId,
    selectedGroupDisplayName,
    groupMembers,
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
    setGroupDropdownOpen,
    openInvite,
    handleLeaveGroup,
    handleSaveGroupName,
  } = group;

  return (
    <>
      {user && showBanner ? (
        <ReceivedInvitations
          variant="banner"
          wrapperClassName={cn(bannerClassName)}
          onAccept={(groupId) => {
            setSelectedGroupId(groupId);
            setGroupDropdownOpen(false);
          }}
        />
      ) : null}

      {selectedGroupId && selectedGroupDisplayName ? (
        <ChecklistManageGroupSheet
          open={groupManageSheetOpen}
          onOpenChange={setGroupManageSheetOpen}
          selectedGroupId={selectedGroupId}
          selectedGroupDisplayName={selectedGroupDisplayName}
          editingGroupName={editingGroupName}
          editGroupNameValue={editGroupNameValue}
          onEditGroupNameValueChange={setEditGroupNameValue}
          onStartEditGroupName={() => {
            setEditingGroupName(selectedGroupId);
            setEditGroupNameValue(selectedGroupDisplayName || '');
          }}
          onCancelEditGroupName={() => {
            setEditingGroupName(null);
            setEditGroupNameValue('');
          }}
          onSaveGroupName={() => {
            void handleSaveGroupName(selectedGroupId, editGroupNameValue);
          }}
          onInvite={openInvite}
          onLeaveGroup={() => {
            void handleLeaveGroup();
          }}
          groupMembers={groupMembers}
          currentUserId={user?.id}
          currentUserEmail={user?.email}
          getInitials={getInitials}
          resolveMemberLabel={resolveGroupMemberLabel}
        />
      ) : null}

      <CollaborateModal
        open={isCollaborateOpen}
        onOpenChange={(open) => {
          setIsCollaborateOpen(open);
          if (!open) {
            setCollaborateOpenForCreate(false);
            setCollaborateGroupType('checklist');
            queryClient.invalidateQueries({ queryKey: ['all_ranking_groups'] });
            queryClient.invalidateQueries({ queryKey: ['checklist_group_members'] });
            queryClient.invalidateQueries({
              queryKey: selectedGroupId && !collaborateOpenForCreate
                ? ['checklist-settlement-context', selectedGroupId]
                : ['checklist-settlement-context'],
            });
          }
        }}
        currentGroupId={collaborateOpenForCreate ? null : selectedGroupId}
        createMode={collaborateOpenForCreate}
        groupType={collaborateGroupType}
        onGroupCreated={(groupId) => {
          setSelectedGroupId(groupId);
          setCollaborateOpenForCreate(false);
          queryClient.invalidateQueries({ queryKey: ['all_ranking_groups'] });
          queryClient.invalidateQueries({ queryKey: ['checklist_group_members'] });
          queryClient.invalidateQueries({ queryKey: ['checklist-settlement-context', groupId] });
        }}
      />
    </>
  );
}
