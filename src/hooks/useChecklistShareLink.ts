import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const rpc = supabase.rpc.bind(supabase);

export interface SharedChecklistItem {
  id: string;
  item: string;
  category: string | null;
  status: 'need' | 'bought' | 'packed';
  is_checked: boolean;
  estimated_price: number | null;
  link: string | null;
  link_title: string | null;
  link_image: string | null;
  order_index: number | null;
  assignee_name: string | null;
}

export interface SharedChecklist {
  group_name: string | null;
  owner_first_name: string | null;
  can_check: boolean;
  items: SharedChecklistItem[];
}

export interface ChecklistShareLink {
  id: string;
  token: string;
  label: string | null;
  revoked: boolean;
  created_at: string;
}

/** Public family share link for a checklist share token. */
export function buildFamilyShareLink(token: string): string {
  const base = (import.meta.env.VITE_SITE_URL as string | undefined) || window.location.origin;
  return `${base.replace(/\/$/, '')}/checklist/shared/${token}`;
}

/** Guest fetch of one group's checklist via its share token (anon-callable RPC). */
export function useSharedChecklist(token: string | undefined) {
  const trimmed = token?.trim() ?? '';
  return useQuery({
    queryKey: ['shared-checklist', trimmed],
    enabled: !!trimmed,
    retry: false,
    queryFn: async (): Promise<SharedChecklist | null> => {
      const { data, error } = await rpc('get_shared_checklist', { p_token: trimmed });
      if (error) throw error;
      return (data as SharedChecklist | null) ?? null;
    },
  });
}

/** Guest status update on one item, scoped by the share token. */
export function useSetSharedItemStatus(token: string | undefined) {
  const qc = useQueryClient();
  const trimmed = token?.trim() ?? '';
  return useMutation({
    mutationFn: async ({ itemId, status }: { itemId: string; status: 'need' | 'bought' | 'packed' }) => {
      const { error } = await rpc('set_shared_item_status', {
        p_token: trimmed,
        p_item_id: itemId,
        p_status: status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['shared-checklist', trimmed] });
    },
  });
}

/** Active (non-revoked) share links for a group; RLS scopes to accepted members. */
export function useChecklistShareLinks(groupId: string | null | undefined) {
  return useQuery({
    queryKey: ['checklist-share-links', groupId],
    enabled: !!groupId,
    queryFn: async (): Promise<ChecklistShareLink[]> => {
      const { data, error } = await supabase
        .from('checklist_share_links')
        .select('id, token, label, revoked, created_at')
        .eq('group_id', groupId!)
        .eq('revoked', false)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateShareLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, label }: { groupId: string; label?: string }): Promise<string> => {
      const { data, error } = await rpc('create_checklist_share_link', {
        p_group_id: groupId,
        p_label: label ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['checklist-share-links'] });
    },
  });
}

export function useRevokeShareLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) => {
      const { error } = await rpc('revoke_checklist_share_link', { p_token: token });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['checklist-share-links'] });
    },
  });
}
