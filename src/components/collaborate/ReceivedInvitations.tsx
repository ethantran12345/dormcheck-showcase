import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Inbox, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/EmptyState';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { apiPost } from '@/lib/apiPost';
import { Tables } from '@/integrations/supabase/types';

export interface ReceivedInvitation {
  id: string;
  group_id: string;
  owner_id: string;
  owner_name: string | null;
  owner_avatar_url: string | null;
  group_name: string | null;
  group_type: string | null;
  dorm_name: string | null;
  term: string | null;
  status: string;
}

function formatTerm(term: string | null): string | null {
  if (!term?.trim()) return null;
  const [season, year] = term.split('-');
  if (!season || !year) return term;
  return `${season[0].toUpperCase()}${season.slice(1)} ${year}`;
}

/** e.g. "Bouquet Gardens · Fall 2026" - null when a roommate invite has no scoping. */
function roommateScopeLabel(inv: ReceivedInvitation): string | null {
  if (inv.group_type !== 'roommate') return null;
  const parts = [inv.dorm_name?.trim(), formatTerm(inv.term)].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

interface ReceivedInvitationsProps {
  open?: boolean;
  onAccept?: (groupId: string) => void;
  onDecline?: (groupId: string) => void;
  /** When 'banner', renders a compact alert row and returns null when empty. No header. */
  variant?: 'full' | 'banner';
  /** Applied to the outer wrapper when variant is 'banner' and invites exist. */
  wrapperClassName?: string;
}

export function ReceivedInvitations({
  open = true,
  onAccept,
  onDecline,
  variant = 'full',
  wrapperClassName,
}: ReceivedInvitationsProps) {
  const { t } = useTranslation();
  const { user, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const { data: received = [], isLoading } = useQuery({
    queryKey: ['ranking_group_members_pending', user?.id],
    staleTime: 60_000,
    queryFn: async (): Promise<ReceivedInvitation[]> => {
      if (!user?.id) return [];
      const { data: rows, error } = await supabase
        .from('ranking_group_members')
        .select(`
          group_id,
          status,
          role,
          ranking_collaborations!inner (
            id,
            group_name,
            owner_id,
            group_type,
            dorm_name,
            term
          )
        `);
      if (error) {
        if (import.meta.env.DEV) {
          console.error('[ReceivedInvitations] ranking_group_members pending fetch:', error.message, error.code);
        }
        return [];
      }
      type RankingMemberRow = Omit<Tables<'ranking_group_members'>, 'ranking_collaborations'> & {
        ranking_collaborations: Tables<'ranking_collaborations'> | null;
      };
      const pendingRows = (rows ?? []).filter((r) => {
        const row = r as unknown as RankingMemberRow;
        return (
          row?.group_id &&
          row?.ranking_collaborations &&
          String(row.ranking_collaborations?.owner_id ?? '') !== user.id &&
          row.status === 'pending' &&
          row.role !== 'owner'
        );
      });
      if (!pendingRows.length) return [];

      // owner_id has no FK to profiles, so the owner profile cannot be embedded.
      const ownerIds = Array.from(
        new Set(
          pendingRows
            .map((r) => {
              const row = r as unknown as RankingMemberRow;
              return row.ranking_collaborations?.owner_id ? String(row.ranking_collaborations.owner_id) : '';
            })
            .filter(Boolean),
        ),
      );
      const profileById = new Map<string, { full_name?: string | null; avatar_url?: string | null }>();
      if (ownerIds.length) {
        const { data: ownerProfiles } = await supabase
          .from('public_profiles')
          .select('id, full_name, avatar_url')
          .in('id', ownerIds);
        (ownerProfiles ?? []).forEach((p) => {
          const profile = p as unknown as { id: string; full_name: string | null; avatar_url: string | null };
          profileById.set(String(profile.id), profile);
        });
      }

      return pendingRows.map((r) => {
        const row = r as unknown as RankingMemberRow;
        const gid = String(row.group_id);
        const collab = row.ranking_collaborations;
        const ownerId = collab?.owner_id ? String(collab.owner_id) : '';
        const ownerProfile = profileById.get(ownerId);
        return {
          id: gid,
          group_id: gid,
          owner_id: ownerId,
          owner_name: ownerProfile?.full_name ?? null,
          owner_avatar_url: ownerProfile?.avatar_url ?? null,
          group_name: (collab?.group_name ?? '')?.trim() || null,
          group_type: (collab?.group_type ?? null) as string | null,
          dorm_name: (collab?.dorm_name ?? null) as string | null,
          term: (collab?.term ?? null) as string | null,
          status: row.status ?? 'pending',
        };
      });
    },
    enabled: !!user?.id && open && !authLoading,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(500 * 2 ** attemptIndex, 2000),
  });

  const handleAccept = async (inv: ReceivedInvitation) => {
    if (!user?.id) return;
    if (inv.owner_id === user.id) return;
    const { data: preCheck } = await supabase
      .from('ranking_group_members')
      .select('id, status')
      .eq('group_id', inv.group_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!preCheck) {
      toast.error('This invitation has expired or was withdrawn.');
      return;
    }
    if (preCheck.status === 'accepted') {
      toast("You've already joined this group.");
      onAccept?.(inv.group_id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ranking_group_members_pending', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['all_ranking_groups'] }),
        queryClient.invalidateQueries({ queryKey: ['checklist_group_members'] }),
        queryClient.invalidateQueries({ queryKey: ['group_members_extended'] }),
      ]);
      return;
    }
    const { data: memberResult, error: memberError } = await supabase
      .from('ranking_group_members')
      .update({ status: 'accepted' })
      .eq('group_id', inv.group_id)
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .neq('role', 'owner')
      .select('id');
    if (memberError) {
      toast.error('Unable to join group. Please try again.');
      return;
    }
    if (!memberResult?.length) {
      const { data: recheck } = await supabase
        .from('ranking_group_members')
        .select('status')
        .eq('group_id', inv.group_id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (recheck?.status === 'accepted') {
        toast.success('Invitation accepted');
      } else {
        toast.error('This invitation has expired or was withdrawn.');
      }
    } else {
      toast.success('Invitation accepted');
      // Email the group owner that you joined (push comes from the DB trigger).
      // Fire-and-forget: never block the accept on the notification.
      void apiPost('/api/notify-group-invite-accepted', { groupId: inv.group_id }).catch((err) =>
        console.error('notify-group-invite-accepted failed', err),
      );
    }
    onAccept?.(inv.group_id);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['ranking_group_members_pending', user.id] }),
      queryClient.invalidateQueries({ queryKey: ['all_ranking_groups'] }),
      queryClient.invalidateQueries({ queryKey: ['checklist_group_members'] }),
      queryClient.invalidateQueries({ queryKey: ['group_members_extended'] }),
      queryClient.invalidateQueries({ queryKey: ['shared_dorm_rankings'] }),
      queryClient.invalidateQueries({ queryKey: ['group_dorm_rankings'] }),
    ]);
  };

  const handleDecline = async (inv: ReceivedInvitation) => {
    if (!user?.id || inv.owner_id === user.id) return;
    const { error } = await supabase
      .from('ranking_group_members')
      .delete()
      .eq('group_id', inv.group_id)
      .eq('user_id', user.id)
      .neq('role', 'owner');
    if (error) {
      toast.error('Could not decline invite');
      return;
    }
    onDecline?.(inv.group_id);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['ranking_group_members_pending', user?.id] }),
      queryClient.invalidateQueries({ queryKey: ['all_ranking_groups'] }),
    ]);
    toast('Invitation declined');
  };

  function getInitials(name: string | null) {
    if (!name?.trim()) return '?';
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
  }

  if (!open) return null;

  if (variant === 'banner') {
    if (received.length === 0) return null;
    return (
      <div className={cn('w-full bg-background', wrapperClassName)}>
        <div className="space-y-3 mb-4">
        {received.map((inv) => {
          const ownerName = inv.owner_name ?? 'Someone';
          const groupLabel = inv.group_name?.trim() || 'a group';
          return (
            <div
              key={inv.id}
              className="rounded-xl border border-malachite-600/30 bg-malachite-600/5 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <Avatar className="h-10 w-10 shrink-0 rounded-full border-2 border-background">
                  <AvatarImage src={inv.owner_avatar_url ?? undefined} />
                  <AvatarFallback className="bg-malachite-600/20 text-malachite-800 text-sm font-semibold">
                    {getInitials(ownerName)}
                  </AvatarFallback>
                </Avatar>
                <p className="text-sm text-foreground">
                  {inv.group_type === 'roommate'
                    ? `${ownerName} wants to confirm you as a roommate`
                    : `${ownerName} invited you to collaborate on ${groupLabel}`}
                  {roommateScopeLabel(inv) ? (
                    <span className="block text-xs text-muted-foreground">{roommateScopeLabel(inv)}</span>
                  ) : null}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2 sm:pl-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => handleDecline(inv)}
                >
                  Decline
                </Button>
                <Button
                  size="sm"
                  className="bg-malachite-800 hover:bg-malachite-900 text-white"
                  onClick={() => handleAccept(inv)}
                >
                  Accept
                </Button>
              </div>
            </div>
          );
        })}
        </div>
      </div>
    );
  }

  if (isLoading && received.length === 0) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (received.length === 0) {
    return <EmptyState icon={Inbox} title={t('roommates:collab.noPending')} />;
  }

  return (
    <ul className="space-y-3">
      {received.map((inv) => {
        const ownerName = inv.owner_name ?? 'Someone';
        const groupLabel = inv.group_name?.trim() || 'a group';
        return (
          <li
            key={inv.id}
            className="rounded-xl border border-malachite-600/30 bg-malachite-600/5 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <Avatar className="h-10 w-10 shrink-0 border-2 border-background">
                <AvatarImage src={inv.owner_avatar_url ?? undefined} />
                <AvatarFallback className="bg-malachite-600/20 text-malachite-800 text-sm font-semibold">
                  {getInitials(ownerName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {inv.group_type === 'roommate'
                    ? `${ownerName} wants to confirm you as a roommate`
                    : `${ownerName} invited you to ${groupLabel}`}
                </p>
                {roommateScopeLabel(inv) ? (
                  <p className="text-xs text-muted-foreground">{roommateScopeLabel(inv)}</p>
                ) : null}
                <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded dark:bg-amber-950/40 dark:text-amber-300">Pending</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => handleDecline(inv)}
              >
                Decline
              </Button>
              <Button size="sm" className="bg-malachite-800 hover:bg-malachite-900 text-white" onClick={() => handleAccept(inv)}>
                Accept
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
