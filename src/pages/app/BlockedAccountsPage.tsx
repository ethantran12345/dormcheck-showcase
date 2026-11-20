import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Ban, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useMyBlockedUsers, useUnblockUser } from '@/hooks/useBlockedUsers';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarImage } from '@/components/ui/avatar';
import { ProfileAvatarFallback } from '@/components/profile/ProfileAvatarFallback';
import { safeImageSrc } from '@/lib/sanitize';
import { PageContainer } from '@/components/ui/page-container';

const PROFILE_TAB_HREF = '/profile';

export default function BlockedAccountsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: blockedUsers = [], isLoading, error } = useMyBlockedUsers();
  const unblockUser = useUnblockUser();
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  const goToProfile = () => navigate(PROFILE_TAB_HREF);

  const handleUnblock = async (targetId: string, displayName: string) => {
    setUnblockingId(targetId);
    try {
      await unblockUser.mutateAsync(targetId);
      toast('Unblocked', {
        description: `You can see ${displayName}'s content again.`,
      });
    } catch (err) {
      toast.error('Could not unblock', {
        description: (err as Error).message,
      });
    } finally {
      setUnblockingId(null);
    }
  };

  if (!user) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <p className="text-sm text-muted-foreground mb-4">Sign in to manage blocked accounts.</p>
        <Button onClick={() => navigate('/auth')}>Sign in</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 pt-6 pb-24 sm:px-6 sm:pt-8">
      <PageContainer width="prose">
        <header className="mb-6 flex items-center gap-2 sm:gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={goToProfile}
            aria-label="Back to profile"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Blocked accounts</h1>
        </header>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            Loading…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
            Could not load blocked accounts: {(error as Error).message}
          </div>
        ) : blockedUsers.length === 0 ? (
          <Card className="rounded-xl border-border p-12 text-center">
            <Ban className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" strokeWidth={1.5} />
            <p className="text-sm font-medium text-foreground">You haven&apos;t blocked anyone.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {blockedUsers.map((blocked) => (
              <Card
                key={blocked.id}
                className="flex items-center gap-3 rounded-xl border-border p-4"
              >
                <Avatar className="h-11 w-11 shrink-0">
                  {blocked.avatarUrl ? (
                    <AvatarImage
                      src={safeImageSrc(blocked.avatarUrl) ?? undefined}
                      alt={blocked.fullName}
                    />
                  ) : null}
                  <ProfileAvatarFallback size="sm" name={blocked.fullName} />
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{blocked.fullName}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={unblockingId === blocked.id}
                  onClick={() => void handleUnblock(blocked.id, blocked.fullName)}
                >
                  {unblockingId === blocked.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'Unblock'
                  )}
                </Button>
              </Card>
            ))}
          </div>
        )}
      </PageContainer>
    </div>
  );
}
