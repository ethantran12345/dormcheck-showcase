import { useMemo, useState } from 'react';
import { Navigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Users, UserPlus, ShieldCheck } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useAdminUniversitySilo } from '@/contexts/AdminUniversityContext';
import { apiPost } from '@/lib/apiPost';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageContainer } from '@/components/ui/page-container';
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

type AppRole = 'user' | 'university_admin' | 'superadmin';

type AdminRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: AppRole;
  university_id: string | null;
  created_at: string;
};

type InviteRow = {
  id: string;
  email: string;
  role: AppRole;
  university_id: string;
  status: string;
  created_at: string;
  expires_at: string;
  invited_by: string;
};

type UniversityRow = { id: string; name: string };

const ROLE_LABELS: Record<AppRole, string> = {
  user: 'Student',
  university_admin: 'University admin',
  superadmin: 'Superadmin',
};

async function fetchAdmins(siloFilter: string | null): Promise<AdminRow[]> {
  // p_university_id is clamped server-side: honored for superadmins (their
  // picked silo), ignored for university_admins (always own school).
  const { data, error } = await supabase.rpc('get_university_admins', {
    p_university_id: siloFilter ?? undefined,
  });
  if (error) throw error;
  return (data ?? []) as AdminRow[];
}

async function fetchPendingInvites(siloFilter: string | null): Promise<InviteRow[]> {
  let query = supabase
    .from('admin_invitations')
    .select('id, email, role, university_id, status, created_at, expires_at, invited_by')
    .eq('status', 'pending');
  // Superadmin silo filter; a university_admin is already scoped by RLS.
  if (siloFilter) query = query.eq('university_id', siloFilter);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as InviteRow[];
}

async function fetchUniversities(): Promise<UniversityRow[]> {
  const { data, error } = await supabase.from('universities').select('id, name').order('name');
  if (error) throw error;
  return (data ?? []) as UniversityRow[];
}

export default function TeamPage() {
  const { user, isAdmin, isSuperAdmin, universityId, isLoading: authLoading, profileLoaded } = useAuth();
  // effectiveIsSuperAdmin drives PRESENTATION only (columns, dropdowns, copy,
  // revoke rails) so the view-as POV matches a real university_admin's page;
  // data fetching + the invite API keep the REAL role.
  const { siloUniversityId, effectiveIsSuperAdmin } = useAdminUniversitySilo();
  const queryClient = useQueryClient();

  const siloFilter = isSuperAdmin ? siloUniversityId : null;
  const enabled = !authLoading && !!user && isAdmin === true && (!isSuperAdmin || !!siloUniversityId);
  const adminsQuery = useQuery({ queryKey: ['admin-team', siloUniversityId], queryFn: () => fetchAdmins(siloFilter), enabled, staleTime: 30_000 });
  const invitesQuery = useQuery({ queryKey: ['admin-team-invites', siloUniversityId], queryFn: () => fetchPendingInvites(siloFilter), enabled, staleTime: 30_000 });
  const universitiesQuery = useQuery({ queryKey: ['universities'], queryFn: fetchUniversities, enabled, staleTime: 300_000 });

  const universityName = useMemo(() => {
    const map = new Map((universitiesQuery.data ?? []).map((u) => [u.id, u.name]));
    return (id: string | null) => (id ? map.get(id) ?? 'Unknown school' : 'No school set');
  }, [universitiesQuery.data]);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<AppRole>('university_admin');
  const [inviteUniversityId, setInviteUniversityId] = useState<string>('');
  // Superadmin invites default to the silo they're working in.
  const effectiveInviteUniversity = isSuperAdmin
    ? inviteUniversityId || siloUniversityId || universitiesQuery.data?.[0]?.id || ''
    : universityId ?? '';

  const inviteMutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await apiPost('/api/admin-invite', {
        email: email.trim(),
        role: isSuperAdmin ? inviteRole : 'university_admin',
        universityId: effectiveInviteUniversity,
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; status?: string };
      if (!res.ok) throw new Error(body.error || 'Failed to send invitation');
      return body.status ?? 'invited';
    },
    onSuccess: (status) => {
      setInviteEmail('');
      const message =
        status === 'granted'
          ? 'Admin access granted. They already had an account, so it takes effect right away.'
          : status === 'resent'
            ? 'Invitation resent with a fresh 14-day window.'
            : 'Invitation sent. Access is applied automatically when they sign in.';
      toast.success(message);
      void queryClient.invalidateQueries({ queryKey: ['admin-team'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-team-invites'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Revoke admin access
  const [revokeTarget, setRevokeTarget] = useState<AdminRow | null>(null);
  const revokeMutation = useMutation({
    mutationFn: async (target: AdminRow) => {
      const { error } = await supabase.rpc('set_admin_role', {
        p_target_id: target.id,
        p_new_role: 'user',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Admin access revoked.');
      void queryClient.invalidateQueries({ queryKey: ['admin-team'] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to revoke access'),
  });

  // Cancel a pending invite
  const cancelInviteMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not yet in generated types (migration 20260721000000)
      const { error } = await (supabase as any).rpc('revoke_admin_invitation', { p_invite_id: inviteId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Invitation canceled.');
      void queryClient.invalidateQueries({ queryKey: ['admin-team-invites'] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to cancel invitation'),
  });

  if (authLoading || !profileLoaded) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!user || !isAdmin) {
    return <Navigate to="/" replace />;
  }

  const admins = adminsQuery.data ?? [];
  const invites = invitesQuery.data ?? [];

  return (
    <div className="min-h-screen bg-background">
      <PageContainer width="wide" className="px-4 sm:px-6 py-6 pb-16 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-malachite-600/15 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5 text-malachite-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Team</h1>
            <p className="text-sm text-muted-foreground">
              {effectiveIsSuperAdmin
                ? 'All DormCheck admins across schools. Invite, revoke, and review recent changes.'
                : 'Admins for your school. Invite teammates and manage access.'}
            </p>
          </div>
        </div>

        {/* Invite */}
        <section className="rounded-xl border border-border bg-card shadow-raised p-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-malachite-600" aria-hidden="true" />
            Invite an admin
          </h2>
          <form
            className="flex flex-col sm:flex-row gap-3 sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (!inviteEmail.trim() || inviteMutation.isPending) return;
              inviteMutation.mutate(inviteEmail);
            }}
          >
            <div className="flex-1 space-y-1">
              <Label htmlFor="invite-email">School email</Label>
              <Input
                id="invite-email"
                type="email"
                required
                placeholder="name@pitt.edu"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            {effectiveIsSuperAdmin && (
              <div className="space-y-1">
                <Label htmlFor="invite-role">Role</Label>
                <select
                  id="invite-role"
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as AppRole)}
                >
                  <option value="university_admin">University admin</option>
                  <option value="superadmin">Superadmin</option>
                </select>
              </div>
            )}
            {effectiveIsSuperAdmin && (universitiesQuery.data?.length ?? 0) > 1 && (
              <div className="space-y-1">
                <Label htmlFor="invite-university">School</Label>
                <select
                  id="invite-university"
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={effectiveInviteUniversity}
                  onChange={(e) => setInviteUniversityId(e.target.value)}
                >
                  {(universitiesQuery.data ?? []).map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
            )}
            <Button
              type="submit"
              disabled={inviteMutation.isPending || !inviteEmail.trim()}
              className="bg-malachite-800 hover:bg-malachite-900 text-white"
            >
              {inviteMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                'Send invite'
              )}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            Invitees sign in with their school email and admin access is applied automatically. Invitations expire after 14 days.
          </p>
        </section>

        {/* Current admins */}
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-foreground">Current admins</h2>
            <span className="text-xs text-muted-foreground">{admins.length} total</span>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-raised overflow-hidden">
            {adminsQuery.isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading admins" />
              </div>
            ) : adminsQuery.isError ? (
              <div className="px-4 py-6 text-center text-sm text-foreground">Couldn't load the admin list.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Admin</th>
                      <th className="px-4 py-3 font-medium">Role</th>
                      {effectiveIsSuperAdmin && <th className="px-4 py-3 font-medium">School</th>}
                      <th className="px-4 py-3 font-medium">Since</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {admins.length === 0 ? (
                      <tr>
                        <td colSpan={effectiveIsSuperAdmin ? 5 : 4} className="px-4 py-6 text-center text-sm text-muted-foreground">
                          No admins yet.
                        </td>
                      </tr>
                    ) : (
                      admins.map((row) => {
                        const isSelf = row.id === user.id;
                        const canRevoke = !isSelf && (effectiveIsSuperAdmin || row.role !== 'superadmin');
                        return (
                          <tr key={row.id}>
                            <td className="px-4 py-3">
                              <div className="text-foreground font-medium">{row.full_name || 'Unnamed'}</div>
                              <div className="text-xs text-muted-foreground">{row.email}</div>
                            </td>
                            <td className="px-4 py-3 text-foreground">
                              <span className="inline-flex items-center gap-1">
                                {row.role === 'superadmin' && (
                                  <ShieldCheck className="w-3.5 h-3.5 text-malachite-600" aria-hidden="true" />
                                )}
                                {ROLE_LABELS[row.role]}
                              </span>
                            </td>
                            {effectiveIsSuperAdmin && (
                              <td className="px-4 py-3 text-foreground">{universityName(row.university_id)}</td>
                            )}
                            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                              {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {isSelf ? (
                                <span className="text-xs text-muted-foreground">You</span>
                              ) : canRevoke ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => setRevokeTarget(row)}
                                >
                                  Revoke access
                                </Button>
                              ) : (
                                <span className="text-xs text-muted-foreground">Protected</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* Pending invitations */}
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-foreground">Pending invitations</h2>
            <span className="text-xs text-muted-foreground">{invites.length} pending</span>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-raised overflow-hidden">
            {invitesQuery.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" aria-label="Loading invitations" />
              </div>
            ) : invitesQuery.isError ? (
              <div className="px-4 py-6 text-center text-sm text-foreground">Couldn't load invitations.</div>
            ) : invites.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">No pending invitations.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Email</th>
                      <th className="px-4 py-3 font-medium">Role</th>
                      {effectiveIsSuperAdmin && <th className="px-4 py-3 font-medium">School</th>}
                      <th className="px-4 py-3 font-medium">Expires</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {invites.map((invite) => (
                      <tr key={invite.id}>
                        <td className="px-4 py-3 text-foreground">{invite.email}</td>
                        <td className="px-4 py-3 text-foreground">{ROLE_LABELS[invite.role]}</td>
                        {effectiveIsSuperAdmin && (
                          <td className="px-4 py-3 text-foreground">{universityName(invite.university_id)}</td>
                        )}
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                          {formatDistanceToNow(new Date(invite.expires_at), { addSuffix: true })}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => inviteMutation.mutate(invite.email)}
                            disabled={inviteMutation.isPending}
                          >
                            Resend
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => cancelInviteMutation.mutate(invite.id)}
                            disabled={cancelInviteMutation.isPending}
                          >
                            Cancel
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <AlertDialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke admin access?</AlertDialogTitle>
              <AlertDialogDescription>
                {revokeTarget?.full_name || revokeTarget?.email || 'This admin'} will lose access to the admin
                console immediately. Their student account is not affected. This action is recorded in the audit log.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep access</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  if (revokeTarget) revokeMutation.mutate(revokeTarget);
                  setRevokeTarget(null);
                }}
              >
                Revoke access
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageContainer>
    </div>
  );
}
