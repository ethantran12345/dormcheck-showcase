import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ChevronDown, Loader2, Plus } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAdminUniversitySilo } from '@/contexts/AdminUniversityContext';
import {
  useBuildingChats,
  useJoinBuildingChat,
  useCreateBuildingChat,
  type BuildingChatRow,
} from '@/hooks/useBuildingChats';
import { useBuildingChatLinks, useDeleteChatLink } from '@/hooks/useBuildingChatLinks';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { PLATFORM_CONFIG } from '@/lib/chatPlatforms';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  FULL_SCREEN_DIALOG_CONTENT_CLASS,
  FULL_SCREEN_DIALOG_HEADER_CLASS,
  FULL_SCREEN_DIALOG_BODY_CLASS,
  FULL_SCREEN_DIALOG_FOOTER_CLASS,
} from '@/lib/profileDialogClasses';
import { ChatRow, ExternalLinkRow } from '@/components/dorm-portal/BuildingChatsWidget';
import { SubmitChatLinkModal } from '@/components/dorm-portal/SubmitChatLinkModal';
import { ReportLinkDialog } from '@/components/dorm-portal/ReportLinkDialog';

interface DormCommunityTabProps {
  buildingId: number;
  residenceHallName: string;
}

/**
 * Community tab of the Your Dorm hub: the in-app building and floor chats are
 * the primary path; external group links (Snapchat, GroupMe, and more) are a
 * secondary bridge tucked into a disclosure.
 */
export function DormCommunityTab({ buildingId, residenceHallName }: DormCommunityTabProps) {
  const { user } = useAuth();
  // View-as: admin chat affordances follow the previewed role.
  const { effectiveIsAdmin: isAdmin } = useAdminUniversitySilo();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [floorInput, setFloorInput] = useState('');
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const [reportDialog, setReportDialog] = useState<{ open: boolean; linkId: string | null; label: string }>(
    { open: false, linkId: null, label: '' },
  );
  const currentYear = useMemo(() => getCurrentAcademicYear(), []);

  const { chats, isLoading: chatsLoading } = useBuildingChats(buildingId);
  const joinMutation = useJoinBuildingChat();
  const createMutation = useCreateBuildingChat();
  const { links } = useBuildingChatLinks(buildingId, currentYear);
  const deleteMutation = useDeleteChatLink();

  const buildingWide = chats.find((c) => c.floor === null) ?? null;
  const floorChats = chats.filter((c) => c.floor !== null);

  const openChat = (chatId: string) => {
    navigate(`/messages?mode=groups&group=${chatId}`);
  };

  const handleJoin = async (chat: BuildingChatRow) => {
    try {
      await joinMutation.mutateAsync(chat.id);
      toast(`Joined "${chat.name}"`);
      openChat(chat.id);
    } catch (e) {
      toast.error('Could not join chat', { description: (e as Error).message });
    }
  };

  const handleCreateBuildingWide = async () => {
    try {
      const newId = await createMutation.mutateAsync({ buildingId, residenceHallName });
      toast.success(`Created ${residenceHallName} chat`);
      openChat(newId);
    } catch (e) {
      toast.error('Could not create chat', { description: (e as Error).message });
    }
  };

  const handleCreateFloor = async () => {
    const floor = floorInput.trim();
    if (!floor) return;
    try {
      const newId = await createMutation.mutateAsync({ buildingId, residenceHallName, floor });
      toast.success(`Created Floor ${floor} chat`);
      setFloorInput('');
      setCreateOpen(false);
      openChat(newId);
    } catch (e) {
      toast.error('Could not create chat', { description: (e as Error).message });
    }
  };

  if (chatsLoading) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
        Loading chats
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="divide-y divide-border rounded-xl border border-border">
        <ChatRow
          title={residenceHallName}
          subtitle="Building chat"
          memberCount={buildingWide?.member_count ?? 0}
          amIMember={buildingWide?.am_i_member ?? false}
          onJoin={buildingWide && !buildingWide.am_i_member ? () => handleJoin(buildingWide) : undefined}
          onOpen={buildingWide && buildingWide.am_i_member ? () => openChat(buildingWide.id) : undefined}
          onCreate={!buildingWide ? handleCreateBuildingWide : undefined}
          isLoading={createMutation.isPending || joinMutation.isPending}
        />
        {floorChats.map((chat) => (
          <ChatRow
            key={chat.id}
            title={`Floor ${chat.floor}`}
            subtitle="Floor chat"
            memberCount={chat.member_count}
            amIMember={chat.am_i_member}
            onJoin={!chat.am_i_member ? () => handleJoin(chat) : undefined}
            onOpen={chat.am_i_member ? () => openChat(chat.id) : undefined}
            isLoading={createMutation.isPending || joinMutation.isPending}
          />
        ))}
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex w-full items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent"
        >
          <Plus className="h-4 w-4" />
          Start a floor chat
        </button>
      </div>

      <Collapsible open={linksOpen} onOpenChange={setLinksOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-lg bg-muted/60 px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted"
          >
            <span>
              Or join an existing group chat (Snapchat, GroupMe, and more)
              {links.length > 0 ? ` · ${links.length}` : ''}
            </span>
            <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', linksOpen && 'rotate-180')} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 rounded-xl border border-border">
            {links.length > 0 ? (
              <div className="divide-y divide-border">
                {links.map((link) => (
                  <ExternalLinkRow
                    key={link.id}
                    link={link}
                    isAdmin={isAdmin}
                    currentUserId={user?.id ?? null}
                    onReport={() =>
                      setReportDialog({
                        open: true,
                        linkId: link.id,
                        label: link.label ?? PLATFORM_CONFIG[link.platform].label + ' group',
                      })
                    }
                    onDelete={async () => {
                      if (!confirm('Delete this link?')) return;
                      try {
                        await deleteMutation.mutateAsync(link.id);
                        toast('Link deleted');
                      } catch (e) {
                        toast.error('Could not delete', { description: (e as Error).message });
                      }
                    }}
                  />
                ))}
              </div>
            ) : (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                No shared group links yet for {residenceHallName}.
              </p>
            )}
            <button
              type="button"
              onClick={() => setSubmitModalOpen(true)}
              className="flex w-full items-center justify-center gap-2 border-t border-border px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent"
            >
              <Plus className="h-4 w-4" />
              Share a group link
            </button>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent overlayClassName="bg-black/60" className={cn(FULL_SCREEN_DIALOG_CONTENT_CLASS)}>
          <DialogHeader className={FULL_SCREEN_DIALOG_HEADER_CLASS}>
            <DialogTitle>Start a floor chat</DialogTitle>
          </DialogHeader>
          <div className={cn(FULL_SCREEN_DIALOG_BODY_CLASS, 'space-y-3')}>
            <p className="text-sm text-muted-foreground">
              Create a chat just for your floor in {residenceHallName}.
            </p>
            <div>
              <label htmlFor="hub-floor-input" className="mb-1.5 block text-sm font-medium text-foreground">
                Floor
              </label>
              <Input
                id="hub-floor-input"
                value={floorInput}
                onChange={(e) => setFloorInput(e.target.value)}
                placeholder="e.g. 9, 9A, B2"
                maxLength={20}
              />
            </div>
          </div>
          <DialogFooter className={cn(FULL_SCREEN_DIALOG_FOOTER_CLASS, 'gap-2')}>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={createMutation.isPending}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateFloor}
              disabled={!floorInput.trim() || createMutation.isPending}
              className="w-full sm:w-auto"
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating
                </>
              ) : (
                'Create floor chat'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SubmitChatLinkModal
        open={submitModalOpen}
        onOpenChange={setSubmitModalOpen}
        buildingId={buildingId}
        residenceHallName={residenceHallName}
      />

      <ReportLinkDialog
        open={reportDialog.open}
        onOpenChange={(open) => setReportDialog((prev) => ({ ...prev, open }))}
        linkId={reportDialog.linkId}
        linkLabel={reportDialog.label}
      />
    </div>
  );
}
