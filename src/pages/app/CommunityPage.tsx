import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Building2, DoorOpen, Loader2, LogOut, MessageCircle, Users } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  useCommunityRooms,
  useJoinCommunityRoom,
  useLeaveCommunityRoom,
} from '@/hooks/useCommunityRooms';
import { useGroupConversations } from '@/hooks/useGroupConversations';
import type { BuildingChatRow } from '@/hooks/useBuildingChats';
import { GroupChatPanel } from '@/components/messages/GroupChatPanel';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { PageContainer } from '@/components/ui/page-container';

/**
 * Community: the permanent home of the rooms a resident belongs to - their
 * building room, their floor room, and the other floors in their building.
 * Browsing is scoped to the resident's own building; the chat surface itself
 * is the shared GroupChatPanel, never forked.
 */
export default function CommunityPage() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const {
    building,
    myFloor,
    buildingRoom,
    floorRoom,
    otherFloorRooms,
    isLoading,
    error,
    refetch,
  } = useCommunityRooms();
  const { communityGroups } = useGroupConversations();
  const joinMutation = useJoinCommunityRoom();
  const leaveMutation = useLeaveCommunityRoom();
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);

  const unreadByRoom = new Map(communityGroups.map((g) => [g.id, g.isUnread]));
  const activeGroup = communityGroups.find((g) => g.id === activeRoomId) ?? null;

  const handleJoin = async (room: BuildingChatRow) => {
    try {
      await joinMutation.mutateAsync(room.id);
      toast(t('messaging:community.joinedToast', { room: room.name }));
      setActiveRoomId(room.id);
    } catch (e) {
      toast.error(t('messaging:community.joinError'), {
        description: (e as Error).message,
      });
    }
  };

  const handleLeave = async (room: BuildingChatRow) => {
    try {
      await leaveMutation.mutateAsync(room.id);
      if (activeRoomId === room.id) setActiveRoomId(null);
      toast(t('messaging:community.leftToast', { room: room.name }));
    } catch (e) {
      toast.error(t('messaging:community.leaveError'), {
        description: (e as Error).message,
      });
    }
  };

  const renderRoomCard = (room: BuildingChatRow, subtitle?: string) => {
    const isUnread = unreadByRoom.get(room.id) ?? false;
    return (
      <Card
        key={room.id}
        className="flex items-center gap-3 rounded-xl border-border p-4"
      >
        <div className="shrink-0 rounded-full bg-muted p-2" aria-hidden>
          {room.floor === null ? (
            <Building2 className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} />
          ) : (
            <DoorOpen className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground">{room.name}</h3>
            {isUnread && (
              <span
                className="h-2 w-2 shrink-0 rounded-full bg-foreground"
                role="status"
                aria-label={t('messaging:community.unread')}
              />
            )}
          </div>
          {subtitle && <p className="text-xs font-medium text-muted-foreground">{subtitle}</p>}
          <p className="truncate text-xs text-muted-foreground">
            {room.last_message ?? t('messaging:community.noMessagesYet')}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <Users className="mr-1 inline h-3 w-3" aria-hidden />
            {t('messaging:group.memberCount', { count: room.member_count })}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {room.am_i_member ? (
            <>
              <Button
                size="sm"
                onClick={() => setActiveRoomId(room.id)}
                aria-label={t('messaging:community.openRoomAria', { room: room.name })}
              >
                <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden />
                {t('messaging:community.open')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                disabled={leaveMutation.isPending}
                onClick={() => void handleLeave(room)}
                aria-label={t('messaging:community.leaveRoomAria', { room: room.name })}
              >
                <LogOut className="mr-1.5 h-4 w-4" aria-hidden />
                {t('messaging:community.leave')}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={joinMutation.isPending}
              onClick={() => void handleJoin(room)}
              aria-label={t('messaging:community.joinRoomAria', { room: room.name })}
            >
              {joinMutation.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {t('messaging:community.join')}
            </Button>
          )}
        </div>
      </Card>
    );
  };

  // An open room takes over the pane (mobile-first full surface, same as the
  // Messages thread view).
  if (activeRoomId) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
        <GroupChatPanel
          activeGroupId={activeRoomId}
          activeGroup={activeGroup}
          isMobile={isMobile}
          onBack={() => setActiveRoomId(null)}
        />
      </div>
    );
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-1 flex-col max-w-full bg-background')}>
      <PageContainer as="header" width="content" className="shrink-0 bg-background px-4 py-3 md:px-8 md:py-4">
        {Capacitor.isNativePlatform() ? (
          <h1 className="mb-1 truncate pr-28 text-2xl font-semibold leading-tight text-foreground">
            {t('messaging:community.title')}
          </h1>
        ) : (
          <h1 className="text-2xl font-semibold leading-tight text-foreground">
            {t('messaging:community.title')}
          </h1>
        )}
        <p className="text-sm text-muted-foreground">{t('messaging:community.subtitle')}</p>
      </PageContainer>

      <PageContainer as="main" id="main-content" width="content" className="flex-1 min-h-0 space-y-6 overflow-y-auto px-4 pb-24 md:px-8">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground" role="status">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" aria-hidden />
            {t('messaging:community.loading')}
          </div>
        ) : error ? (
          <Card className="rounded-xl border-border p-6 text-center">
            <p className="text-sm font-medium text-foreground">{t('messaging:community.errorTitle')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('messaging:community.errorBody')}</p>
            <Button size="sm" className="mt-3" onClick={() => refetch()}>
              {t('messaging:community.retry')}
            </Button>
          </Card>
        ) : !building ? (
          <Card className="rounded-xl border-border p-6 text-center">
            <Building2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" strokeWidth={1.5} aria-hidden />
            <p className="text-sm font-medium text-foreground">{t('messaging:community.noHousingTitle')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('messaging:community.noHousingBody')}</p>
            <Button asChild size="sm" className="mt-3">
              <Link to="/my-home">{t('messaging:community.noHousingCta')}</Link>
            </Button>
          </Card>
        ) : (
          <>
            <section aria-labelledby="community-building-heading">
              <h2
                id="community-building-heading"
                className="mb-2 text-xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground"
              >
                {t('messaging:community.yourBuilding')}
              </h2>
              {buildingRoom ? (
                renderRoomCard(buildingRoom)
              ) : (
                <p className="text-sm text-muted-foreground">{t('messaging:community.provisioning')}</p>
              )}
            </section>

            <section aria-labelledby="community-floor-heading">
              <h2
                id="community-floor-heading"
                className="mb-2 text-xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground"
              >
                {t('messaging:community.yourFloor')}
              </h2>
              {floorRoom ? (
                renderRoomCard(floorRoom, t('messaging:community.floorLabel', { floor: myFloor }))
              ) : myFloor ? (
                <p className="text-sm text-muted-foreground">{t('messaging:community.provisioning')}</p>
              ) : (
                <div className="rounded-xl border border-dashed border-border p-4">
                  <p className="text-sm text-muted-foreground">
                    {t('messaging:community.noFloorBody')}{' '}
                    <Link to="/my-home" className="font-semibold text-foreground underline">
                      {t('messaging:community.noFloorCta')}
                    </Link>
                  </p>
                </div>
              )}
            </section>

            {otherFloorRooms.length > 0 && (
              <section aria-labelledby="community-other-heading">
                <h2
                  id="community-other-heading"
                  className="mb-2 text-xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground"
                >
                  {t('messaging:community.otherFloors')}
                </h2>
                <div className="space-y-3">{otherFloorRooms.map((room) => renderRoomCard(room))}</div>
              </section>
            )}
          </>
        )}
      </PageContainer>
    </div>
  );
}
