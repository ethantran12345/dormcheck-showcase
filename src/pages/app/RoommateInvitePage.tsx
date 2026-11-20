import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { useInvitePreview, useJoinViaInvite } from '@/hooks/useGroupInvite';
import { Users2, Loader2, LogIn } from 'lucide-react';
import { PageContainer } from '@/components/ui/page-container';

function MessageCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <PageContainer width="narrow" className="container px-4 py-12">
        <Card>
          <CardContent className="pt-6 text-center space-y-4">{children}</CardContent>
        </Card>
      </PageContainer>
    </div>
  );
}

/**
 * Shareable roommate-group invite landing page (Phase 1 reachable).
 * Unlike /rankings/invite, joining does not require a pre-existing pending
 * member row - anyone signed in with the link (same university, not blocked)
 * can confirm via the join_group_via_invite RPC.
 */
export default function RoommateInvitePage() {
  const { t } = useTranslation();
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const { data: preview, isLoading: previewLoading, isError } = useInvitePreview(code);
  const join = useJoinViaInvite();
  const [joinError, setJoinError] = useState<string | null>(null);

  const handleJoin = async () => {
    if (!code || join.isPending) return;
    setJoinError(null);
    try {
      await join.mutateAsync(code.trim());
      toast.success(t('roommates:invite.confirmedAsRoommates'));
      // Land on the Roommate Hub - the payoff moment where the new "us" shows up.
      navigate('/roommates/us', { replace: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('blocked')) {
        setJoinError(t('roommates:invite.cantJoinGroup'));
      } else if (msg.includes('wrong_university')) {
        setJoinError(t('roommates:invite.differentUniversity'));
      } else if (msg.includes('invalid_code')) {
        setJoinError(t('roommates:invite.invalidCode'));
      } else {
        setJoinError(t('roommates:invite.unableToJoin'));
      }
    }
  };

  if (authLoading || (user && previewLoading)) {
    return (
      <div className="min-h-screen bg-background">
        <PageContainer width="narrow" className="container px-4 py-12 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </PageContainer>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <PageContainer width="narrow" className="container px-4 py-12">
          <Card>
            <CardHeader>
              <h1 className="text-xl font-bold text-foreground">{t('roommates:invite.title')}</h1>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                {t('roommates:invite.signInMessage')}
              </p>
              <Button asChild className="w-full sm:w-auto bg-malachite-800 hover:bg-malachite-900 text-white">
                <Link to={`/auth?redirect=${encodeURIComponent(`/roommates/invite/${code ?? ''}`)}`}>
                  <LogIn className="h-4 w-4 mr-2" />
                  {t('roommates:invite.signIn')}
                </Link>
              </Button>
            </CardContent>
          </Card>
        </PageContainer>
      </div>
    );
  }

  if (isError || !preview) {
    return (
      <MessageCard>
        <p className="text-muted-foreground">{t('roommates:invite.invalidCodeMessage')}</p>
        <Button asChild variant="outline">
          <Link to="/my-home">{t('roommates:invite.goHome')}</Link>
        </Button>
      </MessageCard>
    );
  }

  if (preview.caller_status === 'accepted') {
    return (
      <MessageCard>
        <p className="text-muted-foreground">{t('roommates:invite.alreadyInGroup')}</p>
        <Button asChild variant="outline">
          <Link to="/my-home">{t('roommates:invite.goHome')}</Link>
        </Button>
      </MessageCard>
    );
  }

  const isRoommateGroup = preview.group_type === 'roommate';
  const groupLabel =
    preview.group_name?.trim() ||
    (isRoommateGroup ? 'their roommate group' : 'their group');
  const inviterLabel = preview.owner_name?.trim() || 'A student';

  return (
    <div className="min-h-screen bg-background">
      <PageContainer width="narrow" className="container px-4 py-12">
        <Card className="border-malachite-600/30 bg-malachite-600/5">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-malachite-600/20">
                <Users2 className="h-6 w-6 text-malachite-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">
                  {isRoommateGroup ? t('roommates:invite.confirmRoommates') : t('roommates:invite.youveBeenInvited')}
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {t('roommates:invite.invitedYouToJoin', { inviter: inviterLabel, group: groupLabel })}
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {preview.dorm_name && (
              <p className="text-foreground font-medium">
                {t('roommates:invite.livingIn', { dorm: preview.dorm_name })}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              {isRoommateGroup
                ? t('roommates:invite.roommateGroupDescription')
                : t('roommates:invite.collaborationGroupDescription')}
              {preview.member_count > 0 && ` ${t('roommates:invite.memberCount', { count: preview.member_count })}`}
            </p>
            {joinError && <p className="text-sm text-destructive">{joinError}</p>}
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                data-testid="roommate-invite-join-button"
                className="bg-malachite-800 hover:bg-malachite-900 text-white flex-1"
                onClick={() => void handleJoin()}
                disabled={join.isPending}
              >
                {join.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t('roommates:invite.joining')}
                  </>
                ) : (
                  t('roommates:invite.joinGroup')
                )}
              </Button>
              <Button asChild variant="outline">
                <Link to="/my-home">{t('roommates:invite.notNow')}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </PageContainer>
    </div>
  );
}
