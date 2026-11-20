import { useState } from 'react';
import { Ban, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useBlockedUserIds, useBlockUser, useUnblockUser } from '@/hooks/useBlockedUsers';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface BlockUserButtonProps {
  targetUserId: string | null | undefined;
  displayName?: string | null;
  variant?: 'button' | 'menu-item';
  className?: string;
  onBlocked?: () => void;
}

export function BlockUserButton({
  targetUserId,
  displayName,
  variant = 'button',
  className,
  onBlocked,
}: BlockUserButtonProps) {
  const { user } = useAuth();
  const { isBlocked } = useBlockedUserIds();
  const blockUser = useBlockUser();
  const unblockUser = useUnblockUser();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!user?.id || !targetUserId || targetUserId === user.id) {
    return null;
  }

  const blocked = isBlocked(targetUserId);
  const pending = blockUser.isPending || unblockUser.isPending;
  const label = blocked ? 'Unblock' : 'Block';
  const personLabel = displayName?.trim() || 'this person';

  const handleUnblock = async () => {
    try {
      await unblockUser.mutateAsync(targetUserId);
      toast('Unblocked', {
        description: `You can see ${personLabel}'s content again.`,
      });
      onBlocked?.();
    } catch (err) {
      toast.error('Could not unblock', {
        description: (err as Error).message,
      });
    }
  };

  const handleBlockConfirm = async () => {
    try {
      await blockUser.mutateAsync(targetUserId);
      toast('Blocked', {
        description: `You won't see ${personLabel}'s profile, listings, or messages.`,
      });
      setConfirmOpen(false);
      onBlocked?.();
    } catch (err) {
      toast.error('Could not block', {
        description: (err as Error).message,
      });
    }
  };

  const handleAction = () => {
    if (blocked) {
      void handleUnblock();
      return;
    }
    setConfirmOpen(true);
  };

  const control =
    variant === 'menu-item' ? (
      <DropdownMenuItem
        onSelect={(e) => {
          e.preventDefault();
          handleAction();
        }}
        disabled={pending}
        className={cn(
          blocked ? 'text-foreground' : 'text-destructive focus:text-destructive',
          className,
        )}
      >
        {pending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Ban className="mr-2 h-4 w-4" />
        )}
        {label}
      </DropdownMenuItem>
    ) : (
      <Button
        type="button"
        variant="outline"
        className={cn('gap-2', className)}
        onClick={handleAction}
        disabled={pending}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Ban className="h-4 w-4" />
        )}
        {label}
      </Button>
    );

  return (
    <>
      {control}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Block this person?</AlertDialogTitle>
            <AlertDialogDescription>
              You won&apos;t see their profile, listings, or messages, and they won&apos;t be able
              to message you.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              disabled={blockUser.isPending}
              onClick={(e) => {
                e.preventDefault();
                void handleBlockConfirm();
              }}
            >
              {blockUser.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Block'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
