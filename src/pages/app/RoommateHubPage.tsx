import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  CalendarDays,
  ClipboardList,
  Link2,
  Loader2,
  RefreshCw,
  Users,
  Users2,
  Wallet,
} from 'lucide-react';
import { Link } from 'react-router';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/EmptyState';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useCollaboration } from '@/hooks/useCollaboration';
import { useDorms } from '@/hooks/useDorms';
import { useRoommateGroup } from '@/hooks/useRoommateGroup';
import { useRoommateGroupChecklist } from '@/hooks/useRoommateGroupChecklist';
import { buildInviteLink, useRotateInviteCode } from '@/hooks/useGroupInvite';
import { computeChecklistReadiness, getInitials } from '@/components/checklist/checklistHelpers';
import { CollaborateModal, ROOMMATE_TERM_OPTIONS } from '@/components/collaborate/CollaborateModal';
import { OurDormPicksCard } from '@/components/roommates/OurDormPicksCard';
import { cn } from '@/lib/utils';
import { PageContainer } from '@/components/ui/page-container';

function termLabel(term: string | null): string | null {
  if (!term) return null;
  return ROOMMATE_TERM_OPTIONS.find((o) => o.value === term)?.label ?? term;
}

function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Roommate Hub - the persistent home of the confirmed roommate group
 * ("co-pilot, not matcher"). Every card ties back to a move-in decision:
 * shared checklist readiness, shared spend, the group's dorm picks
 * (read-only under Phase 1), and move-in day. Route: /roommates/us, gated
 * on showConfirmedRoommates (NOT the discovery showRoommates flag).
 */
export default function RoommateHubPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { setActiveChecklistGroupId } = useCollaboration();
  const { roommateGroup, isLoading } = useRoommateGroup(user?.id);

  // Deep link from the My Home setup step / glance card: /roommates/us?confirm=1
  // opens the "Confirm your roommates" flow right here (never on Shop Essentials).
  useEffect(() => {
    if (searchParams.get('confirm') !== '1') return;
    setConfirmOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('confirm');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const { items: groupItems, isLoading: itemsLoading } = useRoommateGroupChecklist(roommateGroup?.groupId);
  const { dorms } = useDorms();
  const rotateInvite = useRotateInviteCode();

  const readiness = useMemo(
    () => computeChecklistReadiness(groupItems, user?.id),
    [groupItems, user?.id],
  );

  // Shared spend = priced group items someone already bought or packed.
  const sharedSpend = useMemo(
    () =>
      groupItems.reduce((sum, i) => {
        const s = i.status ?? (i.is_checked ? 'packed' : 'need');
        return s === 'bought' || s === 'packed' ? sum + (Number(i.estimated_price) || 0) : sum;
      }, 0),
    [groupItems],
  );

  const groupDorm = useMemo(() => {
    const name = (roommateGroup?.dormName ?? '').trim().toLowerCase();
    if (!name) return null;
    return dorms.find((d) => d.name.trim().toLowerCase() === name) ?? null;
  }, [dorms, roommateGroup?.dormName]);

  const { data: myMoveInDate } = useQuery({
    queryKey: ['roommate-hub-my-move-in', user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<string | null> => {
      const { data } = await supabase
        .from('profiles')
        .select('move_in_date')
        .eq('id', user!.id)
        .maybeSingle();
      return (data?.move_in_date as string | null) ?? null;
    },
  });

  const copyInviteLink = async (code: string) => {
    try {
      await navigator.clipboard.writeText(buildInviteLink(code));
      toast.success(t('roommates:hub.inviteLinkCopied'));
    } catch {
      toast.error(t('roommates:hub.inviteLinkCopyFailed'));
    }
  };

  const openGroupChecklist = () => {
    if (!roommateGroup) return;
    setActiveChecklistGroupId(roommateGroup.groupId);
    navigate('/checklist');
  };

  // Rendered in every non-loading branch so the confirm flow is reachable
  // whether or not the viewer already has a group.
  const confirmModal = (
    <CollaborateModal
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      currentGroupId={roommateGroup?.groupId ?? null}
      createMode={!roommateGroup}
      groupType="roommate"
      onGroupCreated={() => {
        void queryClient.invalidateQueries({ queryKey: ['roommate-group'] });
      }}
    />
  );

  if (isLoading) {
    return (
      <main id="main-content" className="min-h-screen bg-background">
        <PageContainer width="content" className="container flex items-center justify-center px-4 py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </PageContainer>
      </main>
    );
  }

  if (!roommateGroup || roommateGroup.members.length < 2) {
    return (
      <main id="main-content" className="min-h-screen bg-background">
        <PageContainer width="content" className="container px-4 py-16">
          <Card>
            <CardContent className="pt-6">
              <EmptyState
                icon={Users2}
                title={t('roommates:hub.emptyTitle')}
                description={t('roommates:hub.emptyState')}
                action={
                  <Button
                    className="bg-malachite-800 text-white hover:bg-malachite-900"
                    onClick={() => setConfirmOpen(true)}
                  >
                    {t('roommates:hub.emptyStateCta')}
                  </Button>
                }
              />
            </CardContent>
          </Card>
        </PageContainer>
        {confirmModal}
      </main>
    );
  }

  const scopeLine = [roommateGroup.dormName, roommateGroup.unitLabel, termLabel(roommateGroup.term)]
    .filter(Boolean)
    .join(' · ');
  const isOwner = roommateGroup.ownerId === user?.id;
  const officialDay = formatDay(groupDorm?.moveInDate ?? null);
  const myDay = formatDay(myMoveInDate ?? null);

  return (
    <main id="main-content" className="min-h-screen bg-background">
      <PageContainer width="content" className="container space-y-4 px-4 pb-16 pt-14 sm:pt-16">
        <div className="flex items-center justify-end gap-2 md:hidden">
          <Link
            to="/roommates"
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-malachite-600 bg-card px-3 py-2 text-sm font-semibold leading-none text-malachite-800 dark:text-malachite-300"
          >
            <Users className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t('misc:nav.browseProfiles')}
          </Link>
        </div>
        {/* Header: who "us" is + invite link controls */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex -space-x-2">
              {roommateGroup.members.slice(0, 4).map((m) => (
                <Avatar key={m.id} className="h-10 w-10 border-2 border-background ring-1 ring-border">
                  <AvatarImage src={m.avatar_url ?? undefined} />
                  <AvatarFallback className="bg-muted text-xs text-muted-foreground">
                    {getInitials(m.full_name)}
                  </AvatarFallback>
                </Avatar>
              ))}
            </span>
            {roommateGroup.members.length > 4 ? (
              <span className="text-xs font-medium text-muted-foreground">
                +{roommateGroup.members.length - 4}
              </span>
            ) : null}
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold text-foreground">
                {roommateGroup.groupName?.trim() || t('roommates:hub.title')}
              </h1>
              {scopeLine ? (
                <p className="truncate text-sm text-muted-foreground">{scopeLine}</p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {roommateGroup.inviteCode ? (
              <Button size="sm" variant="outline" onClick={() => void copyInviteLink(roommateGroup.inviteCode!)}>
                <Link2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                {t('roommates:hub.copyInviteLink')}
              </Button>
            ) : null}
            {roommateGroup.inviteCode && isOwner ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                disabled={rotateInvite.isPending}
                onClick={() =>
                  rotateInvite.mutate(roommateGroup.groupId, {
                    onSuccess: (newCode) => void copyInviteLink(newCode),
                    onError: () => toast.error(t('roommates:hub.inviteLinkResetFailed')),
                  })
                }
              >
                <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', rotateInvite.isPending && 'animate-spin')} aria-hidden />
                {t('roommates:hub.resetInviteLink')}
              </Button>
            ) : null}
          </div>
        </div>

        {/* Shared checklist readiness */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-malachite-600/10">
              <ClipboardList className="h-4 w-4 text-malachite-600" aria-hidden />
            </div>
            <h2 className="text-sm font-semibold text-foreground">{t('roommates:hub.checklistCardTitle')}</h2>
          </CardHeader>
          <CardContent className="space-y-3">
            {itemsLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold text-foreground">
                    {t('roommates:hub.percentReady', { pct: readiness.readiness })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t('roommates:hub.stillNeeded', { count: readiness.needCount })}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-valuenow={readiness.readiness}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={t('roommates:hub.checklistCardTitle')}
                  className="h-2 w-full overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full rounded-full bg-malachite-600 transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, readiness.readiness))}%` }}
                  />
                </div>
              </>
            )}
            <Button size="sm" variant="outline" onClick={openGroupChecklist}>
              {t('roommates:hub.openChecklist')}
            </Button>
          </CardContent>
        </Card>

        {/* Shared costs (display only - settlement stays in the checklist; DormCheck never processes payments) */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-malachite-600/10">
              <Wallet className="h-4 w-4 text-malachite-600" aria-hidden />
            </div>
            <h2 className="text-sm font-semibold text-foreground">{t('roommates:hub.costsCardTitle')}</h2>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {sharedSpend > 0
                ? t('roommates:hub.sharedSpend', { amount: Math.round(sharedSpend) })
                : t('roommates:hub.sharedSpendEmpty')}
            </p>
            <Button size="sm" variant="outline" onClick={openGroupChecklist}>
              {t('roommates:hub.openSplit')}
            </Button>
          </CardContent>
        </Card>

        {/* Our dorm picks - the group's dorm ranking, editable in place
            (drag-to-rank moved here from the housing explore Rankings tab) */}
        <OurDormPicksCard
          groupId={roommateGroup.groupId}
          memberIds={roommateGroup.members.map((m) => m.id)}
        />


        {/* Move-in day */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-malachite-600/10">
              <CalendarDays className="h-4 w-4 text-malachite-600" aria-hidden />
            </div>
            <h2 className="text-sm font-semibold text-foreground">{t('roommates:hub.moveInCardTitle')}</h2>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {officialDay ? (
              <p className="text-sm text-foreground">
                {t('roommates:hub.officialMoveIn', { day: officialDay })}
              </p>
            ) : null}
            <p className="text-sm text-muted-foreground">
              {myDay
                ? t('roommates:hub.yourArrival', { day: myDay })
                : t('roommates:hub.yourArrivalNotSet')}
            </p>
          </CardContent>
        </Card>
      </PageContainer>
      {confirmModal}
    </main>
  );
}
