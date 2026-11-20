import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GroupInvitePreview {
  group_id: string;
  group_name: string | null;
  group_type: string;
  dorm_name: string | null;
  owner_name: string | null;
  member_count: number;
  caller_status: string | null;
}

/** Shareable link for a group's invite code. */
export function buildInviteLink(inviteCode: string): string {
  const base = (import.meta.env.VITE_SITE_URL as string | undefined) || window.location.origin;
  return `${base.replace(/\/$/, '')}/roommates/invite/${inviteCode}`;
}

/** Minimal pre-join preview via SECURITY DEFINER RPC (same-university only). */
export function useInvitePreview(code: string | undefined) {
  const { user } = useAuth();
  const trimmed = code?.trim() ?? '';
  const valid = UUID_REGEX.test(trimmed);
  return useQuery({
    queryKey: ['group-invite-preview', trimmed, user?.id],
    enabled: !!user && valid,
    queryFn: async (): Promise<GroupInvitePreview | null> => {
      const { data, error } = await supabase.rpc('get_group_invite_preview', {
        p_code: trimmed,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row as GroupInvitePreview | undefined) ?? null;
    },
  });
}

export function useJoinViaInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: string): Promise<string> => {
      const { data, error } = await supabase.rpc('join_group_via_invite', { p_code: code });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['group-invite-preview'] });
      void qc.invalidateQueries({ queryKey: ['roommate-group'] });
    },
  });
}

export function useRotateInviteCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (groupId: string): Promise<string> => {
      const { data, error } = await supabase.rpc('rotate_group_invite_code', {
        p_group_id: groupId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['group-invite-preview'] });
      void qc.invalidateQueries({ queryKey: ['roommate-group'] });
    },
  });
}
