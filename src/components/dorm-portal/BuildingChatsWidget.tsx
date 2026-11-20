import { useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { useAdminUniversitySilo } from '@/contexts/AdminUniversityContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  useBuildingChats,
  useJoinBuildingChat,
  useCreateBuildingChat,
  type BuildingChatRow,
} from '@/hooks/useBuildingChats';
import {
  useBuildingChatLinks,
  useDeleteChatLink,
  type BuildingChatLinkRow,
} from '@/hooks/useBuildingChatLinks';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { PLATFORM_CONFIG } from '@/lib/chatPlatforms';
import { userBelongsInBuilding } from '@/lib/housing-match';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import {
  MessageCircle,
  Plus,
  Users,
  ArrowRight,
  Loader2,
  MoreHorizontal,
  ExternalLink,
  Flag,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  FULL_SCREEN_DIALOG_CONTENT_CLASS,
  FULL_SCREEN_DIALOG_HEADER_CLASS,
  FULL_SCREEN_DIALOG_BODY_CLASS,
  FULL_SCREEN_DIALOG_FOOTER_CLASS,
} from '@/lib/profileDialogClasses';
import { SubmitChatLinkModal } from './SubmitChatLinkModal';
import { ReportLinkDialog } from './ReportLinkDialog';
import { useUniversity } from '@/contexts/UniversityContext';

interface BuildingChatsWidgetProps {
  /** The master_housing.id for the building this widget represents.
   *  For merged dorms (Bouquet Gardens), this is the selectedSubBuilding.id.
   *  For non-merged dorms, this is Number(dorm.id). */
  buildingId: number | null;
  /** The residence_hall name for this building (used for display +
   *  client-side match before the RPC fires). */
  residenceHallName: string;
}

export function BuildingChatsWidget({ buildingId, residenceHallName }: BuildingChatsWidgetProps) {
  const { t } = useTranslation();
  const { university } = useUniversity();
  const { user } = useAuth();
  // View-as: hide admin affordances while a superadmin previews as a student.
  const { effectiveIsAdmin: isAdmin } = useAdminUniversitySilo();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [floorInput, setFloorInput] = useState('');
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [reportDialog, setReportDialog] = useState<{
    open: boolean;
    linkId: string | null;
    label: string;
  }>({
    open: false,
    linkId: null,
    label: '',
  });
  const floorInputRef = useRef<HTMLInputElement>(null);
  const currentYear = useMemo(() => getCurrentAcademicYear(), []);

  const { data: profile } = useQuery({
    queryKey: ['profile-housing', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('current_dorm, housing_type')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  const isMatch = useMemo(() => {
    return userBelongsInBuilding({
      currentDorm: profile?.current_dorm,
      housingType: profile?.housing_type,
      residenceHall: residenceHallName,
    });
  }, [profile, residenceHallName]);

  const { chats, isLoading: chatsLoading } = useBuildingChats(isMatch ? buildingId : null);
  const joinMutation = useJoinBuildingChat();
  const createMutation = useCreateBuildingChat();

  const { links: currentLinks } = useBuildingChatLinks(isMatch ? buildingId : null, currentYear);

  const deleteMutation = useDeleteChatLink();

  if (!user) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 shadow-raised">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-primary/10 p-2 shrink-0">
            <MessageCircle className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-foreground">{t('housing:portal.chats.findFloormates')}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('housing:portal.chats.signInPrompt', { building: residenceHallName, school: university.shortName })}
            </p>
          </div>
          <Button size="sm" onClick={() => navigate('/auth')} className="shrink-0">
            {t('common:actions.signIn')}
          </Button>
        </div>
      </div>
    );
  }

  if (!buildingId || !isMatch) return null;

  const buildingWide = chats.find(c => c.floor === null) ?? null;
  const floorChats = chats.filter(c => c.floor !== null);

  const openChat = (chatId: string) => {
    navigate(`/messages?mode=groups&group=${chatId}`);
  };

  const handleJoin = async (chat: BuildingChatRow) => {
    try {
      await joinMutation.mutateAsync(chat.id);
      toast(t('housing:portal.chats.joinedChat', { name: chat.name }));
      openChat(chat.id);
    } catch (e) {
      toast.error(t('housing:portal.chats.joinError'), {
        description: (e as Error).message,
      });
    }
  };

  const handleCreateBuildingWide = async () => {
    try {
      const newId = await createMutation.mutateAsync({
        buildingId,
        residenceHallName,
      });
      toast.success(t('housing:portal.chats.createdBuildingChat', { building: residenceHallName }));
      openChat(newId);
    } catch (e) {
      toast.error(t('housing:portal.chats.createError'), {
        description: (e as Error).message,
      });
    }
  };

  const handleCreateFloor = async () => {
    const floor = floorInput.trim();
    if (!floor) return;
    try {
      const newId = await createMutation.mutateAsync({
        buildingId,
        residenceHallName,
        floor,
      });
      toast.success(t('housing:portal.chats.createdFloorChat', { floor }));
      setFloorInput('');
      setCreateOpen(false);
      openChat(newId);
    } catch (e) {
      toast.error(t('housing:portal.chats.createError'), {
        description: (e as Error).message,
      });
    }
  };

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-raised">
        {/* Header */}
        <div className="flex items-start gap-3 p-4">
          <div className="rounded-full bg-primary/10 p-2 shrink-0">
            <MessageCircle className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-foreground">{t('housing:portal.chats.heading', { building: residenceHallName })}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('housing:portal.chats.description', { school: university.shortName })}
            </p>
          </div>
        </div>

        {/* One clean list: building chat, floor chats, then shared group links. */}
        {chatsLoading ? (
          <div className="border-t border-border p-5 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
            {t('common:state.loading')}
          </div>
        ) : (
          <div className="divide-y divide-border border-t border-border">
            <ChatRow
              title={residenceHallName}
              subtitle="Building chat"
              memberCount={buildingWide?.member_count ?? 0}
              amIMember={buildingWide?.am_i_member ?? false}
              onJoin={buildingWide ? () => handleJoin(buildingWide) : undefined}
              onOpen={buildingWide && buildingWide.am_i_member ? () => openChat(buildingWide.id) : undefined}
              onCreate={!buildingWide ? handleCreateBuildingWide : undefined}
              isLoading={createMutation.isPending || joinMutation.isPending}
            />

            {floorChats.map(chat => (
              <ChatRow
                key={chat.id}
                title={`Floor ${chat.floor}`}
                subtitle="Floor chat"
                memberCount={chat.member_count}
                amIMember={chat.am_i_member}
                onJoin={() => handleJoin(chat)}
                onOpen={chat.am_i_member ? () => openChat(chat.id) : undefined}
                isLoading={createMutation.isPending || joinMutation.isPending}
              />
            ))}

            {currentLinks.map(link => (
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
                  if (!confirm(t('housing:portal.chats.confirmDeleteLink'))) return;
                  try {
                    await deleteMutation.mutateAsync(link.id);
                    toast(t('housing:portal.chats.linkDeleted'));
                  } catch (e) {
                    toast.error(t('housing:portal.chats.deleteError'), {
                      description: (e as Error).message,
                    });
                  }
                }}
              />
            ))}
          </div>
        )}

        {/* Two quiet add actions */}
        <div className="flex items-stretch border-t border-border text-sm font-medium text-primary">
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex flex-1 items-center justify-center gap-2 px-4 py-4 transition-colors hover:bg-accent"
          >
            <Plus className="h-4 w-4" />
            {t('housing:portal.chats.floorChat')}
          </button>
          <span className="w-px self-stretch bg-border" aria-hidden />
          <button
            type="button"
            onClick={() => setSubmitModalOpen(true)}
            className="flex flex-1 items-center justify-center gap-2 px-4 py-4 transition-colors hover:bg-accent"
          >
            <Plus className="h-4 w-4" />
            {t('housing:portal.chats.groupLink')}
          </button>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent
          overlayClassName="bg-black/60"
          className={cn(FULL_SCREEN_DIALOG_CONTENT_CLASS)}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            floorInputRef.current?.focus();
          }}
        >
          <DialogHeader className={FULL_SCREEN_DIALOG_HEADER_CLASS}>
            <DialogTitle>{t('housing:portal.chats.startFloorChat')}</DialogTitle>
          </DialogHeader>
          <div className={cn(FULL_SCREEN_DIALOG_BODY_CLASS, 'space-y-3')}>
            <p className="text-sm text-muted-foreground">
              {t('housing:portal.chats.startFloorChatDescription', { building: residenceHallName })}
            </p>
            <div>
              <label htmlFor="floor-input" className="block text-sm font-medium text-foreground mb-1.5">
                {t('housing:portal.chats.floorLabel')}
              </label>
              <Input
                ref={floorInputRef}
                id="floor-input"
                value={floorInput}
                onChange={e => setFloorInput(e.target.value)}
                placeholder={t('housing:portal.chats.floorPlaceholder')}
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
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={handleCreateFloor}
              disabled={!floorInput.trim() || createMutation.isPending}
              className="w-full sm:w-auto"
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {t('housing:portal.chats.creating')}
                </>
              ) : (
                t('housing:portal.chats.createFloorChat')
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
        onOpenChange={open =>
          setReportDialog(prev => ({
            ...prev,
            open,
          }))
        }
        linkId={reportDialog.linkId}
        linkLabel={reportDialog.label}
      />
    </>
  );
}

export function ChatRow({
  title,
  subtitle,
  memberCount,
  amIMember: _amIMember,
  onJoin,
  onOpen,
  onCreate,
  isLoading,
}: {
  title: string;
  subtitle: string;
  memberCount: number;
  amIMember: boolean;
  onJoin?: () => void;
  onOpen?: () => void;
  onCreate?: () => void;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 items-center gap-3 px-5 py-3">
      <div className="rounded-lg bg-muted p-2 shrink-0">
        <Users className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <p className="text-sm font-medium text-foreground truncate">{title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {subtitle}{memberCount > 0 && ` · ${memberCount} ${t(memberCount === 1 ? 'housing:portal.chats.memberSingular' : 'housing:portal.chats.memberPlural')}`}
        </p>
      </div>
      <div className="flex shrink-0 items-center">
        {onOpen ? (
          <Button size="sm" variant="ghost" onClick={onOpen} disabled={isLoading} className="text-primary">
            {t('common:actions.open')} <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        ) : onJoin ? (
          <Button size="sm" onClick={onJoin} disabled={isLoading}>
            {t('housing:portal.chats.join')}
          </Button>
        ) : onCreate ? (
          <Button size="sm" variant="outline" onClick={onCreate} disabled={isLoading}>
            {t('housing:portal.chats.startChat')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function ExternalLinkRow({
  link,
  isAdmin,
  currentUserId,
  onReport,
  onDelete,
  isArchive = false,
}: {
  link: BuildingChatLinkRow;
  isAdmin: boolean;
  currentUserId: string | null;
  onReport?: () => void;
  onDelete?: () => void;
  isArchive?: boolean;
}) {
  const { t } = useTranslation();
  const config = PLATFORM_CONFIG[link.platform];
  const Icon = config.icon;

  const canDelete = !isArchive && (isAdmin || (currentUserId != null && link.submitted_by === currentUserId));
  const showMenu = !isArchive && (Boolean(onReport) || canDelete);

  const title = link.label ?? `${config.label} group`;
  const subtitle = [t('housing:portal.chats.submittedBy', { name: link.submitter_display_name }), link.floor ? t('housing:portal.chats.floorLabel') + ` ${link.floor}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex min-w-0 items-center gap-3 px-5 py-3">
      <div className={cn('rounded-lg bg-muted p-2 shrink-0')}>
        <Icon className={cn('h-4 w-4', config.iconClass)} />
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <p className="text-sm font-medium text-foreground truncate">{title}</p>
        <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant={isArchive ? 'ghost' : 'outline'} asChild disabled={isArchive}>
          <a href={link.url} target="_blank" rel="noopener noreferrer" aria-label={t('housing:portal.chats.openLinkAriaLabel', { title, platform: config.label })}>
            {t('common:actions.open')} <ExternalLink className="h-3 w-3 ml-1" />
          </a>
        </Button>
        {showMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">{t('common:actions.actions')}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onReport && (
                <DropdownMenuItem onClick={onReport}>
                  <Flag className="h-4 w-4 mr-2" />
                  {t('housing:portal.report.reportButton')}
                </DropdownMenuItem>
              )}
              {canDelete && onDelete && (
                <DropdownMenuItem onClick={onDelete} className="text-red-600 focus:text-red-700">
                  <Trash2 className="h-4 w-4 mr-2" />
                  {t('common:actions.delete')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
