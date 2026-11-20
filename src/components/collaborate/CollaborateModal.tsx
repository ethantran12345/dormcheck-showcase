import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { apiPost } from '@/lib/apiPost';
import { useAuth } from '@/hooks/useAuth';
import {
  AdaptiveOverlay,
  AdaptiveOverlayClose,
  AdaptiveOverlayContent,
  AdaptiveOverlayHeader,
  AdaptiveOverlayTitle,
} from '@/components/ui/adaptive-overlay';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, Mail, X, XCircle, Loader2, UserPlus, ClipboardList, Users, Link2, RefreshCw, Heart, Ban, Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/EmptyState';
import { toast } from 'sonner';
import { sanitizeOptional } from '@/lib/sanitize';
import { cn } from '@/lib/utils';
import { useCollaboration } from '@/hooks/useCollaboration';
import { DormCombobox } from '@/components/collaborate/DormCombobox';
import { buildInviteLink, useRotateInviteCode } from '@/hooks/useGroupInvite';
import { shareLink } from '@/lib/shareLink';
import {
  buildFamilyShareLink,
  useChecklistShareLinks,
  useCreateShareLink,
  useRevokeShareLink,
} from '@/hooks/useChecklistShareLink';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidCollaboratorId(id: string | null | undefined): id is string {
  return typeof id === 'string' && id.trim().length > 0 && UUID_REGEX.test(id.trim());
}

interface UserProfile {
  id: string;
  full_name?: string | null;
  avatar_url?: string | null;
}

interface SentInvitation {
  id: string;
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
}

export interface CollaborateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentGroupId: string | null;
  /** When true, always show the create-group flow even if the user already owns groups. */
  createMode?: boolean;
  /**
   * 'roommate' creates a confirmed roommate group (dorm/unit/term scoping);
   * default 'checklist' keeps the existing collaboration-group flow.
   */
  groupType?: 'checklist' | 'roommate';
  onGroupCreated?: (groupId: string) => void;
  /**
   * Pre-staged invitee (e.g. the other party of a DM opening "Confirm as
   * roommate"): seeded into the create flow's invite chips, or surfaced as a
   * ready-to-invite row when a group already exists. Identity comes from
   * public_profiles fields only.
   */
  prestagedInvitee?: UserProfile | null;
}

const DEBOUNCE_MS = 300;

/** Academic-term choices for roommate groups; first entry is the current cycle. */
export const ROOMMATE_TERM_OPTIONS = [
  { value: 'fall-2026', label: 'Fall 2026' },
  { value: 'spring-2027', label: 'Spring 2027' },
] as const;

export function CollaborateModal({
  open,
  onOpenChange,
  currentGroupId,
  createMode = false,
  groupType = 'checklist',
  onGroupCreated,
  prestagedInvitee = null,
}: CollaborateModalProps) {
  const { t } = useTranslation();
  const isRoommateGroup = groupType === 'roommate';
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { collaborateModalTab: activeTab, setCollaborateModalTab: setActiveTab } = useCollaboration();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState('');
  const [pendingInvites, setPendingInvites] = useState<UserProfile[]>([]);
  const [dormName, setDormName] = useState('');
  const [unitLabel, setUnitLabel] = useState('');
  const [term, setTerm] = useState<string>(ROOMMATE_TERM_OPTIONS[0].value);
  // Optional details (name/dorm/room/term/search) stay collapsed so the default
  // create flow is a single button. Power users expand to scope the group.
  const [showDetails, setShowDetails] = useState(false);

  // Hydrate on mount: fetch ALL group-member rows for current user.
  const { data: myMemberships = [], isLoading: membershipsLoading } = useQuery({
    queryKey: ['collab_my_memberships', user?.id],
    queryFn: async (): Promise<Array<{ group_id: string; status: string; role: string | null; created_at: string | null }>> => {
      if (!user?.id) return [];
      const { data: rows, error } = await supabase
        .from('ranking_group_members')
        .select('group_id, status, role, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error || !rows?.length) return [];
      return (rows ?? []).map((r: Tables<'ranking_group_members'>) => ({
        group_id: String(r.group_id),
        status: String(r.status ?? ''),
        role: r.role == null ? null : String(r.role),
        created_at: r.created_at == null ? null : String(r.created_at),
      }));
    },
    enabled: open && !!user?.id,
  });

  const ownerMembershipGroupIds = myMemberships
    .filter((m) => m.role === 'owner' && m.status === 'accepted')
    .map((m) => m.group_id);

  // Fallback: if peer model normalized roles, owner may only be represented on ranking_collaborations.owner_id.
  const { data: ownerCollaborationGroupIds = [], isLoading: ownerCollaborationLoading } = useQuery({
    queryKey: ['collab_owner_groups', user?.id],
    queryFn: async (): Promise<string[]> => {
      if (!user?.id) return [];
      const { data: owned, error } = await supabase
        .from('ranking_collaborations')
        .select('id')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false });
      if (error || !owned?.length) return [];
      return owned.map((r: Tables<'ranking_collaborations'>) => String(r.id));
    },
    enabled: open && !!user?.id,
  });

  const effectiveGroupId = createMode
    ? null
    : (currentGroupId ?? ownerMembershipGroupIds[0] ?? ownerCollaborationGroupIds[0] ?? null);

  // Shareable invite link for the active group (any member can copy; owner can reset).
  const { data: groupInvite } = useQuery({
    queryKey: ['collab_group_invite', effectiveGroupId],
    enabled: open && !!effectiveGroupId,
    queryFn: async (): Promise<{ invite_code: string | null; owner_id: string | null } | null> => {
      if (!effectiveGroupId) return null;
      const { data, error } = await supabase
        .from('ranking_collaborations')
        .select('invite_code, owner_id')
        .eq('id', effectiveGroupId)
        .maybeSingle();
      if (error) return null;
      return data
        ? { invite_code: data.invite_code ? String(data.invite_code) : null, owner_id: data.owner_id ? String(data.owner_id) : null }
        : null;
    },
  });
  const rotateInvite = useRotateInviteCode();

  const copyInviteLink = async (code: string) => {
    try {
      await navigator.clipboard.writeText(buildInviteLink(code));
      toast.success('Invite link copied', { description: 'Text it to your roommate to confirm.' });
    } catch {
      toast.error('Could not copy the link');
    }
  };

  // Primary action: open the OS share sheet (Messages, WhatsApp, ...) with the
  // invite link. On platforms without a share sheet it copies instead, so we
  // only toast on that fallback - the sheet is its own feedback.
  const handleShareInvite = async (code: string) => {
    const result = await shareLink(buildInviteLink(code), {
      title: 'Join my roommate group on DormCheck',
      text: 'Join my roommate group on DormCheck. Tap to confirm:',
    });
    if (result === 'copied') {
      toast.success('Invite link copied', { description: 'Text it to your roommate to confirm.' });
    } else if (result === 'failed') {
      toast.error('Could not share the link');
    }
  };

  // Family share links: public, token-scoped guest access to the group's
  // checklist (view + check-off only) - distinct from the roommate invite,
  // which requires an account and joins the group.
  const { data: familyLinks = [] } = useChecklistShareLinks(open ? effectiveGroupId : null);
  const createShareLink = useCreateShareLink();
  const revokeShareLink = useRevokeShareLink();

  const copyFamilyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(buildFamilyShareLink(token));
      toast.success('Family link copied', {
        description: 'Anyone with this link can see the checklist and check items off. No account needed.',
      });
    } catch {
      toast.error('Could not copy the link');
    }
  };

  const handleShareWithFamily = async () => {
    if (!effectiveGroupId) return;
    const active = familyLinks[0];
    if (active) {
      await copyFamilyLink(active.token);
      return;
    }
    createShareLink.mutate(
      { groupId: effectiveGroupId },
      {
        onSuccess: (token) => void copyFamilyLink(token),
        onError: () => toast.error('Could not create the link'),
      }
    );
  };
  const isHydrating =
    open && !createMode && !currentGroupId && (membershipsLoading || ownerCollaborationLoading);

  // Close/open hygiene: clear search inputs on close, but do NOT reset the active tab.
  useEffect(() => {
    if (open) return;
    setSearchQuery('');
    setGroupName('');
    setPendingInvites([]);
    setInvitingId(null);
    setDormName('');
    setUnitLabel('');
    setTerm(ROOMMATE_TERM_OPTIONS[0].value);
    setShowDetails(false);
  }, [open]);

  // State logic: when modal opens, default to Invite tab. Owner override removed so Invite stays default.
  useEffect(() => {
    if (!open) return;
    setActiveTab('invite');
  }, [open, setActiveTab]);

  // Seed the create flow with the pre-staged invitee (DM "Confirm as roommate").
  useEffect(() => {
    if (!open || !prestagedInvitee || !isValidCollaboratorId(prestagedInvitee.id)) return;
    if (prestagedInvitee.id === user?.id) return;
    setPendingInvites((prev) =>
      prev.some((p) => p.id === prestagedInvitee.id) ? prev : [...prev, prestagedInvitee],
    );
  }, [open, prestagedInvitee, user?.id]);

  // Realtime subscription: update UI when roommate accepts or invite is cancelled
  useEffect(() => {
    if (!open) return;
    const channel = supabase
      .channel(`collab-modal-ranking_group_members-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ranking_group_members' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['collab_sent_invitations'] });
          queryClient.invalidateQueries({ queryKey: ['collab_owner_groups'] });
          queryClient.invalidateQueries({ queryKey: ['collab_my_memberships'] });
          queryClient.invalidateQueries({ queryKey: ['all_ranking_groups'] });
          queryClient.invalidateQueries({ queryKey: ['ranking_groups'] });
          queryClient.invalidateQueries({ queryKey: ['ranking_group_members_pending'] });
          queryClient.invalidateQueries({ queryKey: ['checklist_group_members'] });
          queryClient.invalidateQueries({ queryKey: ['group_members_extended'] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [open, queryClient]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setDebouncedQuery('');
      return;
    }
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const { data: searchResults = [], isFetching: isSearchFetching } = useQuery({
    queryKey: ['profile_search_collab', debouncedQuery, user?.id],
    queryFn: async (): Promise<UserProfile[]> => {
      if (!debouncedQuery || debouncedQuery.length < 2 || !user?.id) return [];
      const { data, error } = await supabase.rpc('search_users', { search_query: debouncedQuery });
      if (error) return [];
      return (data ?? []) as UserProfile[];
    },
    enabled: debouncedQuery.length >= 2 && !!user?.id && open,
  });

  const { data: sentInvitations = [], isLoading: sentLoading } = useQuery({
    queryKey: ['collab_sent_invitations', effectiveGroupId],
    queryFn: async (): Promise<SentInvitation[]> => {
      if (!effectiveGroupId) return [];
      const { data: rows, error } = await supabase
        .from('ranking_group_members')
        .select('id, user_id')
        .eq('group_id', effectiveGroupId)
        .eq('status', 'pending')
        .eq('role', 'collaborator');
      if (error || !rows?.length) return [];
      const userIds = [...new Set(rows.map((r: Tables<'ranking_group_members'>) => r.user_id))];
      const { data: profiles } = await supabase
        .from('public_profiles')
        .select('id, full_name, avatar_url')
        .in('id', userIds);
      const profileById = new Map((profiles ?? []).map((p: UserProfile) => [String(p.id), p]));
      return rows.map((r: Tables<'ranking_group_members'>) => ({
        id: r.id,
        user_id: r.user_id,
        full_name: profileById.get(String(r.user_id))?.full_name ?? null,
        avatar_url: profileById.get(String(r.user_id))?.avatar_url ?? null,
      }));
    },
    enabled: open && !!user?.id && !!effectiveGroupId,
  });

  const isSelfInvite = (profile: UserProfile) => profile.id === user?.id;

  const filteredSearchResults = (searchResults ?? []).filter((p) => !isSelfInvite(p));

  async function sendRoommateInviteEmail(recipientUserId: string): Promise<boolean> {
    try {
      // Best-effort notification; in-app invite is the ranking_group_members row.
      const resp = await apiPost('/api/send-roommate-invite', { recipientUserId });
      if (!resp.ok) return false;
      const json = (await resp.json().catch(() => null)) as { ok?: boolean } | null;
      return !!json?.ok;
    } catch {
      return false;
    }
  }

  async function insertPendingInvite(
    groupId: string,
    inviteeUserId: string
  ): Promise<'inserted' | 'already_invited' | 'failed'> {
    const { error: insertErr } = await supabase.from('ranking_group_members').insert({
      group_id: groupId,
      user_id: inviteeUserId,
      status: 'pending',
      role: 'collaborator',
    });
    if (!insertErr) return 'inserted';
    if (insertErr.code === '23505') return 'already_invited';
    return 'failed';
  }

  const createGroupRpcArgs = () => ({
    p_group_name: sanitizeOptional(groupName),
    p_member_ids: [] as string[],
    p_group_type: groupType,
    p_dorm_name: isRoommateGroup ? (sanitizeOptional(dormName) ?? undefined) : undefined,
    p_unit_label: isRoommateGroup ? (sanitizeOptional(unitLabel) ?? undefined) : undefined,
    p_term: isRoommateGroup ? term : undefined,
  });

  const handleCreateGroup = async () => {
    if (!user?.id) return;
    setIsCreating(true);
    try {
      const inviteeIds = pendingInvites
        .filter((p) => !isSelfInvite(p) && isValidCollaboratorId(p.id))
        .map((p) => p.id);

      // Create group first, then record pending members in DB. Email is best-effort only.
      const { data: newGroupId, error: rpcErr } = await supabase.rpc(
        'create_ranking_group',
        createGroupRpcArgs()
      );

      if (rpcErr || !newGroupId) {
        const msg = (rpcErr as { message?: string })?.message ?? 'Unknown error';
        toast.error('Could not create group', { description: msg });
        return;
      }

      const groupId = String(newGroupId);

      let sentCount = 0;
      let failedCount = 0;
      let emailFailedCount = 0;

      if (inviteeIds.length > 0) {
        const inviteeProfiles = pendingInvites.filter((p) => inviteeIds.includes(p.id));
        for (const p of inviteeProfiles) {
          const insertResult = await insertPendingInvite(groupId, p.id);
          if (insertResult === 'already_invited') {
            failedCount += 1;
            continue;
          }
          if (insertResult === 'failed') {
            failedCount += 1;
            continue;
          }

          sentCount += 1;
          const emailed = await sendRoommateInviteEmail(p.id);
          if (!emailed) emailFailedCount += 1;
        }

      }

      await queryClient.invalidateQueries({ queryKey: ['all_ranking_groups'] });
      await queryClient.invalidateQueries({ queryKey: ['ranking_groups'] });
      await queryClient.invalidateQueries({ queryKey: ['collab_sent_invitations'] });
      await queryClient.invalidateQueries({ queryKey: ['collab_owner_groups'] });
      await queryClient.invalidateQueries({ queryKey: ['collab_my_memberships'] });
      await queryClient.invalidateQueries({ queryKey: ['group_dorm_rankings'] });
      await queryClient.invalidateQueries({ queryKey: ['shared_dorm_rankings'] });
      onGroupCreated?.(groupId);

      const toastMessage =
          inviteeIds.length === 0
            ? 'Group created!'
            : failedCount === 0
              ? `Group created! ${sentCount} invite${sentCount === 1 ? '' : 's'} sent.`
              : `Group created. ${sentCount} sent, ${failedCount} failed.`;
      const toastDescription =
          emailFailedCount > 0 && sentCount > 0
            ? `${emailFailedCount} invite${emailFailedCount === 1 ? '' : 's'} saved in-app, but email could not be delivered.`
            : undefined;
      if (failedCount > 0) {
        toast.error(toastMessage, { description: toastDescription });
      } else {
        toast(toastMessage, { description: toastDescription });
      }
    } catch {
      toast.error('Could not create group');
    } finally {
      setIsCreating(false);
    }
  };

  const handleInvite = async (profile: UserProfile) => {
    if (!user?.id || !isValidCollaboratorId(profile.id) || isSelfInvite(profile)) return;
    setInvitingId(profile.id);
    try {
      let emailDelivered: boolean;
      if (effectiveGroupId) {
        const insertResult = await insertPendingInvite(effectiveGroupId, profile.id);
        if (insertResult === 'already_invited') {
          toast.error('Already invited');
          return;
        }
        if (insertResult === 'failed') {
          toast.error('Could not save invite', { description: 'Please try again.' });
          return;
        }

        emailDelivered = await sendRoommateInviteEmail(profile.id);
      } else {
        const { data: newGroupId, error: rpcErr } = await supabase.rpc(
          'create_ranking_group',
          createGroupRpcArgs()
        );
        if (rpcErr || !newGroupId) {
          toast.error('Could not create group and invite', { description: (rpcErr as { message?: string })?.message });
          return;
        }
        const inviteCode = String(newGroupId);

        const insertResult = await insertPendingInvite(inviteCode, profile.id);
        if (insertResult === 'already_invited') {
          toast.error('Already invited');
          return;
        }
        if (insertResult === 'failed') {
          toast.error('Could not save invite', { description: 'Please try again.' });
          return;
        }

        onGroupCreated?.(String(newGroupId));
        emailDelivered = await sendRoommateInviteEmail(profile.id);
      }
      await queryClient.invalidateQueries({ queryKey: ['all_ranking_groups'] });
      await queryClient.invalidateQueries({ queryKey: ['ranking_groups'] });
      await queryClient.invalidateQueries({ queryKey: ['collab_sent_invitations'] });
      await queryClient.invalidateQueries({ queryKey: ['collab_owner_groups'] });
      await queryClient.invalidateQueries({ queryKey: ['collab_my_memberships'] });
      await queryClient.invalidateQueries({ queryKey: ['group_dorm_rankings'] });
      await queryClient.invalidateQueries({ queryKey: ['shared_dorm_rankings'] });
      setActiveTab('sent');

      toast.success('Invitation sent', {
        description: emailDelivered
          ? undefined
          : 'They will see it in DormCheck. Email notification could not be delivered.',
      });
    } catch {
      toast.error('Could not invite');
    } finally {
      setInvitingId(null);
    }
  };

  const handleCancelInvite = async (inv: SentInvitation) => {
    const { error } = await supabase
      .from('ranking_group_members')
      .delete()
      .eq('id', inv.id);
    if (error) {
      toast.error('Could not cancel invite');
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['collab_sent_invitations'] });
    await queryClient.invalidateQueries({ queryKey: ['all_ranking_groups'] });
    toast('Invitation cancelled');
  };

  const getInitials = (name: string | null) => {
    if (!name?.trim()) return '?';
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();
  };

  const showSearching = searchQuery.trim().length >= 2 && (debouncedQuery !== searchQuery.trim() || isSearchFetching);

  // First name of the person we'll confirm (e.g. from a DM "Confirm as roommate"),
  // used to make the primary create button concrete: "Confirm Alex & get link".
  const stagedInvitees = pendingInvites.filter((p) => !isSelfInvite(p));
  const primaryInviteeFirstName = stagedInvitees[0]?.full_name?.trim().split(/\s+/)[0] ?? null;

  const searchResultsPanel =
    searchQuery.trim().length >= 2 ? (
      <div className="max-h-[220px] overflow-y-auto rounded-xl border border-border bg-card p-2 shadow-raised">
        {showSearching ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Searching...</div>
        ) : filteredSearchResults.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No users found.</div>
        ) : (
          filteredSearchResults.map((profile) => {
            const isPending = pendingInvites.some((p) => p.id === profile.id);
            return (
              <div
                key={profile.id}
                className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/60"
              >
                <Avatar className="h-9 w-9">
                  <AvatarImage src={profile.avatar_url ?? undefined} />
                  <AvatarFallback className="bg-muted text-xs text-muted-foreground">
                    {getInitials(profile.full_name ?? null)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {profile.full_name || 'Unknown'}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isPending || isSelfInvite(profile)}
                  onClick={() => {
                    if (!isPending && !isSelfInvite(profile)) setPendingInvites((prev) => [...prev, profile]);
                  }}
                >
                  {isPending ? (
                    'Added'
                  ) : (
                    <>
                      <UserPlus className="mr-1 h-4 w-4 text-malachite-600" />
                      Invite
                    </>
                  )}
                </Button>
              </div>
            );
          })
        )}
      </div>
    ) : null;

  const pendingInviteChips =
    pendingInvites.filter((p) => !isSelfInvite(p)).length > 0 ? (
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">People to invite</p>
        <div className="flex flex-wrap gap-2">
          {pendingInvites.filter((p) => !isSelfInvite(p)).map((profile) => (
            <div
              key={profile.id}
              className="flex items-center gap-2 rounded-full border border-border bg-muted py-1 pl-2 pr-1"
            >
              <Avatar className="h-6 w-6">
                <AvatarImage src={profile.avatar_url ?? undefined} />
                <AvatarFallback className="bg-muted text-[10px] text-muted-foreground">
                  {getInitials(profile.full_name ?? null)}
                </AvatarFallback>
              </Avatar>
              <span className="max-w-[100px] truncate text-sm text-foreground">
                {profile.full_name || 'Unknown'}
              </span>
              <button
                type="button"
                onClick={() =>
                  setPendingInvites((prev) => prev.filter((p) => p.id !== profile.id))
                }
                className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Remove"
              >
                <XCircle className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    ) : null;

  const groupBenefitsBlock = (
    <div className="rounded-xl border border-border bg-card p-4 shadow-raised">
      <p className="text-sm font-semibold text-foreground">What a group gets you</p>
      <div className="mt-3 space-y-3">
        <div className="flex gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-malachite-600/10">
            <ClipboardList className="h-4 w-4 text-malachite-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Shared checklist</p>
            <p className="text-xs text-muted-foreground">
              See who is bringing what, skip the duplicates
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-malachite-600/10">
            <Users className="h-4 w-4 text-malachite-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Coordinate move-in</p>
            <p className="text-xs text-muted-foreground">
              Plan together so nothing gets double-bought
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  const sentEmptyState = (message: string) => <EmptyState icon={Mail} title={message} />;

  return (
    // side="right" keeps the mobile right-sheet byte-identical; desktop becomes a
    // centered Dialog (max-w-md). Mirrors ChecklistManageGroupSheet.
    <AdaptiveOverlay open={open} onOpenChange={onOpenChange}>
      <AdaptiveOverlayContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto bg-background p-0 [&>button[aria-label='Close']]:hidden"
        mobileClassName="sm:max-w-md"
        desktopClassName="max-h-[85vh] max-w-md"
      >
        <AdaptiveOverlayHeader className="flex shrink-0 flex-row items-center justify-between space-y-0 border-b border-border px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] text-left sm:px-6">
          <AdaptiveOverlayTitle className="text-base font-semibold text-foreground sm:text-lg">
            {isRoommateGroup ? 'Confirm your roommates' : 'Roommate groups'}
          </AdaptiveOverlayTitle>
          <AdaptiveOverlayClose className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background disabled:pointer-events-none">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </AdaptiveOverlayClose>
        </AdaptiveOverlayHeader>

        <div className="flex min-h-0 flex-1 flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 sm:px-6">
        {isHydrating ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'invite' | 'sent')} className="flex w-full flex-col">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-0 rounded-full bg-muted p-1">
            <TabsTrigger
              value="invite"
              className="rounded-full py-2.5 text-sm font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-malachite-800 data-[state=active]:shadow-raised data-[state=inactive]:text-muted-foreground"
            >
              Invite
            </TabsTrigger>
            <TabsTrigger
              value="sent"
              className="rounded-full py-2.5 text-sm font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-malachite-800 data-[state=active]:shadow-raised data-[state=inactive]:text-muted-foreground"
            >
              Sent
            </TabsTrigger>
          </TabsList>

          <TabsContent value="invite" className="mt-4 space-y-4 focus-visible:outline-none">
            {!effectiveGroupId ? (
              <>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Create your group, then share one link to confirm a roommate.
                </p>

                {pendingInviteChips}

                {/* Primary action: create the group in one tap. The invite link
                    appears right after, ready to text to a roommate. */}
                <Button
                  onClick={handleCreateGroup}
                  disabled={isCreating}
                  className="h-11 w-full"
                >
                  {isCreating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Link2 className="mr-2 h-4 w-4" />
                  )}
                  {primaryInviteeFirstName
                    ? `Confirm ${primaryInviteeFirstName} & get link`
                    : 'Create group & get invite link'}
                </Button>

                {/* Optional: name the group, scope it to a hall, or add roommates
                    by search. Collapsed by default to keep the flow to one button. */}
                <button
                  type="button"
                  onClick={() => setShowDetails((v) => !v)}
                  className="flex w-full items-center justify-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
                  aria-expanded={showDetails}
                >
                  {showDetails ? 'Hide details' : 'Name it or add roommates'}
                </button>

                {showDetails && (
                  <div className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-raised">
                    <div className="space-y-1.5">
                      <label htmlFor="collab-group-name" className="text-sm font-medium text-foreground">Group name (optional)</label>
                      <Input
                        id="collab-group-name"
                        placeholder="e.g. Tower A floor 3"
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                        className="w-full"
                      />
                    </div>
                    {isRoommateGroup && (
                      <>
                        <div className="space-y-1.5">
                          <label htmlFor="collab-dorm-name" className="text-sm font-medium text-foreground">Dorm or building (optional)</label>
                          <DormCombobox
                            id="collab-dorm-name"
                            label="Dorm or building"
                            value={dormName}
                            onChange={setDormName}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <label htmlFor="collab-unit-label" className="text-sm font-medium text-foreground">Room or unit (optional)</label>
                            <Input
                              id="collab-unit-label"
                              placeholder="e.g. B-204"
                              value={unitLabel}
                              onChange={(e) => setUnitLabel(e.target.value)}
                              className="w-full"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label htmlFor="collab-term" className="text-sm font-medium text-foreground">Term</label>
                            <Select value={term} onValueChange={setTerm}>
                              <SelectTrigger id="collab-term" className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ROOMMATE_TERM_OPTIONS.map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </>
                    )}
                    <div className="space-y-1.5">
                      <label htmlFor="collab-search-new" className="text-sm font-medium text-foreground">Search roommates</label>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="collab-search-new"
                          placeholder="Search for a roommate by name..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full pl-9"
                        />
                      </div>
                    </div>
                    {searchResultsPanel}
                  </div>
                )}

                {groupBenefitsBlock}
              </>
            ) : (
              <>
                {/* Hero: the shareable invite link. One tap to copy, then text it
                    to a roommate who confirms without searching or forms. */}
                {groupInvite?.invite_code && (
                  <div className="rounded-xl border border-malachite-600/30 bg-malachite-600/5 p-4">
                    <p className="text-sm font-semibold text-foreground">Add your roommate</p>
                    {/* Hero: one tap opens the OS share sheet with the invite link.
                        Whoever taps the link is confirmed instantly - no forms. */}
                    <Button
                      className="mt-3 h-11 w-full"
                      onClick={() => void handleShareInvite(groupInvite.invite_code!)}
                    >
                      <Share2 className="mr-2 h-4 w-4" aria-hidden />
                      Share invite link
                    </Button>
                    <div className="mt-2 flex items-center justify-center gap-4 text-xs">
                      <button
                        type="button"
                        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                        onClick={() => void copyInviteLink(groupInvite.invite_code!)}
                      >
                        <Link2 className="h-3 w-3" aria-hidden />
                        Copy link
                      </button>
                      {groupInvite.owner_id === user?.id && (
                        <button
                          type="button"
                          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground disabled:opacity-60"
                          disabled={rotateInvite.isPending}
                          onClick={() =>
                            rotateInvite.mutate(effectiveGroupId!, {
                              onSuccess: (newCode) => void copyInviteLink(newCode),
                              onError: () => toast.error('Could not reset the link'),
                            })
                          }
                        >
                          <RefreshCw className={cn('h-3 w-3', rotateInvite.isPending && 'animate-spin')} aria-hidden />
                          Reset link
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {/* Pre-staged invitee (from a DM): one-tap invite into the existing group. */}
                {prestagedInvitee &&
                isValidCollaboratorId(prestagedInvitee.id) &&
                !isSelfInvite(prestagedInvitee) &&
                !sentInvitations.some((inv) => inv.user_id === prestagedInvitee.id) ? (
                  <div className="flex items-center gap-3 rounded-xl border border-malachite-600/30 bg-malachite-600/5 p-3">
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={prestagedInvitee.avatar_url ?? undefined} />
                      <AvatarFallback className="bg-muted text-xs text-muted-foreground">
                        {getInitials(prestagedInvitee.full_name ?? null)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {prestagedInvitee.full_name || 'Unknown'}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={invitingId === prestagedInvitee.id}
                      onClick={() => handleInvite(prestagedInvitee)}
                    >
                      {invitingId === prestagedInvitee.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Mail className="mr-1 h-4 w-4 text-malachite-600" />
                          Invite
                        </>
                      )}
                    </Button>
                  </div>
                ) : null}
                {/* Primary: search a roommate and send them a real invite. */}
                <div className="space-y-1.5">
                  <label htmlFor="collab-search-add" className="text-sm font-medium text-foreground">Invite by name</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="collab-search-add"
                      placeholder="Search for a roommate by name..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9"
                    />
                  </div>
                </div>
                {searchQuery.trim().length >= 2 && (
                  <div className="max-h-[220px] overflow-y-auto rounded-xl border border-border bg-card p-2 shadow-raised">
                    {showSearching ? (
                      <div className="py-6 text-center text-sm text-muted-foreground">Searching...</div>
                    ) : filteredSearchResults.length === 0 ? (
                      <div className="py-6 text-center text-sm text-muted-foreground">No users found.</div>
                    ) : (
                      filteredSearchResults.map((profile) => (
                        <div
                          key={profile.id}
                          className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/60"
                        >
                          <Avatar className="h-9 w-9">
                            <AvatarImage src={profile.avatar_url ?? undefined} />
                            <AvatarFallback className="bg-muted text-xs text-muted-foreground">
                              {getInitials(profile.full_name ?? null)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">
                              {profile.full_name || 'Unknown'}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={invitingId === profile.id || isSelfInvite(profile)}
                            onClick={() => handleInvite(profile)}
                          >
                            {invitingId === profile.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <Mail className="mr-1 h-4 w-4 text-malachite-600" />
                                Invite
                              </>
                            )}
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Secondary: a family link for a parent to view the checklist. */}
                <div className="space-y-3 border-t border-border pt-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Sharing with family
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={createShareLink.isPending}
                      onClick={() => void handleShareWithFamily()}
                    >
                      {createShareLink.isPending ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Heart className="mr-1.5 h-3.5 w-3.5 text-malachite-600" aria-hidden />
                      )}
                      {familyLinks.length > 0 ? 'Copy parent link' : 'Add a parent (view-only)'}
                    </Button>
                    {familyLinks.length > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        disabled={revokeShareLink.isPending}
                        onClick={() =>
                          revokeShareLink.mutate(familyLinks[0].token, {
                            onSuccess: () => toast('Family link turned off'),
                            onError: () => toast.error('Could not turn off the link'),
                          })
                        }
                      >
                        <Ban className={cn('mr-1.5 h-3.5 w-3.5', revokeShareLink.isPending && 'animate-pulse')} aria-hidden />
                        Turn off link
                      </Button>
                    )}
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="sent" className="mt-4 focus-visible:outline-none">
            {!effectiveGroupId ? (
              sentEmptyState(t('roommates:collab.createGroupFirst'))
            ) : sentLoading && sentInvitations.length === 0 ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : sentInvitations.length === 0 ? (
              sentEmptyState(t('roommates:collab.noPending'))
            ) : (
              <ul className="space-y-2">
                {sentInvitations.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-3 shadow-raised sm:px-4"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarImage src={inv.avatar_url ?? undefined} />
                        <AvatarFallback className="bg-muted text-xs text-muted-foreground">
                          {getInitials(inv.full_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {inv.full_name || 'Unknown'}
                        </span>
                        <span className="mt-0.5 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
                          Pending
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                      onClick={() => handleCancelInvite(inv)}
                    >
                      <XCircle className="mr-1 h-4 w-4" />
                      <span className="hidden sm:inline">Cancel Invite</span>
                      <span className="sm:hidden">Cancel</span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
        )}
        </div>
      </AdaptiveOverlayContent>
    </AdaptiveOverlay>
  );
}
