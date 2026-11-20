import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { Users2, Loader2, LogIn } from 'lucide-react';
import { apiPost } from '@/lib/apiPost';
import { PageContainer } from '@/components/ui/page-container';

/** Read-only group preview for invite link. No database writes on load. */
interface GroupPreview {
  id: string;
  groupName: string | null;
  ownerName: string | null;
  memberStatus: 'pending' | 'accepted' | null;
}

async function fetchGroupPreview(inviteCode: string, userId: string | undefined): Promise<GroupPreview | null> {
  if (!inviteCode?.trim()) return null;

  const code = inviteCode.trim();
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(code)) return null;

  // Read-only: SELECT group details. No writes.
  const { data: group, error: groupError } = await supabase
    .from('ranking_collaborations')
    .select('id, group_name, owner_id')
    .eq('id', code)
    .maybeSingle();

  if (groupError || !group) return null;

  const ownerId = group.owner_id;
  if (!ownerId) return { id: group.id, groupName: group.group_name ?? null, ownerName: null, memberStatus: null };

  const { data: profile } = await supabase
    .from('public_profiles')
    .select('full_name')
    .eq('id', ownerId)
    .maybeSingle();

  let memberStatus: 'pending' | 'accepted' | null = null;
  if (userId) {
    const { data: member } = await supabase
      .from('ranking_group_members')
      .select('status')
      .eq('group_id', code)
      .eq('user_id', userId)
      .maybeSingle();
    if (member?.status === 'pending' || member?.status === 'accepted') {
      memberStatus = member.status;
    }
  }

  return {
    id: group.id,
    groupName: group.group_name?.trim() || null,
    ownerName: profile?.full_name?.trim() || null,
    memberStatus,
  };
}

export default function RankingInvitePage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const [isJoining, setIsJoining] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['ranking_invite_preview', code, user?.id],
    queryFn: () => fetchGroupPreview(code ?? '', user?.id),
    enabled: !!code?.trim() && !!user,
  });

  const handleJoinGroup = async () => {
    if (!user?.id || !preview?.id || isJoining) return;
    setIsJoining(true);

    try {
      const { data: authUser } = await supabase.auth.getUser();
      if (!authUser?.user?.id || authUser.user.id !== user.id) {
        toast.error('Please sign in again.');
        return;
      }

      const { data: preCheck } = await supabase
        .from('ranking_group_members')
        .select('id, status')
        .eq('group_id', preview.id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!preCheck) {
        toast.error('This invitation has expired or was withdrawn.');
        return;
      }
      if (preCheck.status === 'accepted') {
        toast("You've already joined this group.");
        navigate('/roommates', { replace: true });
        return;
      }

      const { data: memberRows, error: memberError } = await supabase
        .from('ranking_group_members')
        .update({ status: 'accepted' })
        .eq('group_id', preview.id)
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .neq('role', 'owner')
        .select('id');

      if (memberError) {
        toast.error('Unable to join group. Please try again.');
        return;
      }

      if (!memberRows?.length) {
        const { data: recheck } = await supabase
          .from('ranking_group_members')
          .select('status')
          .eq('group_id', preview.id)
          .eq('user_id', user.id)
          .maybeSingle();
        if (recheck?.status === 'accepted') {
          toast.success('Invitation accepted');
          navigate('/roommates', { replace: true });
          return;
        }
        toast.error('This invitation has expired or was withdrawn.');
        return;
      }

      toast.success('Invitation accepted');
      // Email the group owner that you joined (push comes from the DB trigger).
      // Fire-and-forget: never block the accept on the notification.
      void apiPost('/api/notify-group-invite-accepted', { groupId: preview.id }).catch((err) =>
        console.error('notify-group-invite-accepted failed', err),
      );
      navigate('/roommates', { replace: true });
    } catch {
      toast.error('Unable to join group. Please try again.');
    } finally {
      setIsJoining(false);
    }
  };

  const handleDecline = async () => {
    if (!user?.id || !preview?.id || isDeclining) return;
    setIsDeclining(true);
    try {
      const { error } = await supabase
        .from('ranking_group_members')
        .delete()
        .eq('group_id', preview.id)
        .eq('user_id', user.id)
        .neq('role', 'owner');
      if (error) {
        toast.error('Could not decline invite');
        return;
      }
      toast('Invitation declined');
      navigate('/roommates', { replace: true });
    } finally {
      setIsDeclining(false);
    }
  };

  if (!code?.trim()) {
    return (
      <div className="min-h-screen bg-background">
        <PageContainer width="narrow" className="container px-4 py-12">
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-muted-foreground">Invalid invite link.</p>
              <Button asChild variant="outline" className="mt-4">
                <Link to="/roommates">Go to Roommates</Link>
              </Button>
            </CardContent>
          </Card>
        </PageContainer>
      </div>
    );
  }

  if (authLoading || previewLoading) {
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
              <h1 className="text-xl font-bold text-foreground">Ranking Invite</h1>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                Sign in to view and accept this collaboration invitation.
              </p>
              <Button asChild className="w-full sm:w-auto">
                <Link to={`/auth?redirect=${encodeURIComponent(`/rankings/invite/${code}`)}`}>
                  <LogIn className="h-4 w-4 mr-2" />
                  Sign In
                </Link>
              </Button>
            </CardContent>
          </Card>
        </PageContainer>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="min-h-screen bg-background">
        <PageContainer width="narrow" className="container px-4 py-12">
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-muted-foreground">This invitation has expired or the link is invalid.</p>
              <Button asChild variant="outline" className="mt-4">
                <Link to="/roommates">Go to Roommates</Link>
              </Button>
            </CardContent>
          </Card>
        </PageContainer>
      </div>
    );
  }

  if (preview.memberStatus === 'accepted') {
    return (
      <div className="min-h-screen bg-background">
        <PageContainer width="narrow" className="container px-4 py-12">
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-muted-foreground">You&apos;ve already joined this group.</p>
              <Button asChild variant="outline" className="mt-4">
                <Link to="/roommates">Go to Roommates</Link>
              </Button>
            </CardContent>
          </Card>
        </PageContainer>
      </div>
    );
  }

  if (preview.memberStatus !== 'pending') {
    return (
      <div className="min-h-screen bg-background">
        <PageContainer width="narrow" className="container px-4 py-12">
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-muted-foreground">This invitation has expired or was withdrawn.</p>
              <Button asChild variant="outline" className="mt-4">
                <Link to="/roommates">Go to Roommates</Link>
              </Button>
            </CardContent>
          </Card>
        </PageContainer>
      </div>
    );
  }

  const groupLabel = preview.groupName || 'a dorm ranking group';
  const inviterLabel = preview.ownerName || 'Someone';

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
                <h1 className="text-xl font-bold text-foreground">You&apos;ve been invited</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {inviterLabel} invited you to join
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-foreground font-medium">
              Join <span className="font-semibold text-malachite-800">{groupLabel}</span>?
            </p>
            <p className="text-sm text-muted-foreground">
              Work together on your dorm ranking list to find the perfect housing match.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                className="bg-malachite-800 hover:bg-malachite-900 text-white flex-1"
                onClick={handleJoinGroup}
                disabled={isJoining}
              >
                {isJoining ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Joining…
                  </>
                ) : (
                  'Join Group'
                )}
              </Button>
              <Button
                variant="outline"
                onClick={handleDecline}
                disabled={isDeclining}
              >
                {isDeclining ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Declining…
                  </>
                ) : (
                  'Decline'
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </PageContainer>
    </div>
  );
}
