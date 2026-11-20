import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import type { ChatPlatform } from '@/lib/chatPlatforms';

export type BuildingChatLinkRow = {
  id: string;
  building_id: number;
  floor: string | null;
  platform: ChatPlatform;
  url: string;
  label: string | null;
  submitted_by: string | null;
  submitter_display_name: string;
  academic_year: string;
  created_at: string;
  report_count: number;
};

/**
 * Fetch external chat links for a building. Defaults to current
 * academic year; pass a year string to fetch archive.
 */
export function useBuildingChatLinks(buildingId: number | null, year?: string) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const query = useQuery({
    queryKey: ['building-chat-links', buildingId, year ?? 'current', userId],
    queryFn: async (): Promise<BuildingChatLinkRow[]> => {
      if (!buildingId || !userId) return [];

      const { data, error } = await supabase.rpc('get_building_chat_links', {
        b_id: buildingId,
        year: year ?? null,
      });

      if (error) throw error;

      // Re-widen nullable columns since Supabase RPC generator types
      // them as non-null. Runtime values can still be null.
      return (data ?? []).map((row): BuildingChatLinkRow => ({
        id: row.id,
        building_id: row.building_id,
        floor: row.floor,
        platform: row.platform as ChatPlatform,
        url: row.url,
        label: row.label,
        submitted_by: row.submitted_by,
        submitter_display_name: row.submitter_display_name,
        academic_year: row.academic_year,
        created_at: row.created_at,
        report_count: row.report_count,
      }));
    },
    enabled: !!buildingId && !!userId,
    staleTime: 30_000,
  });

  return {
    links: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}

/**
 * Submit a new chat link. Server-side checks: dorm-match (via RLS),
 * URL regex (via CHECK), academic_year = current (via RLS).
 */
export function useSubmitChatLink() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      buildingId: number;
      platform: ChatPlatform;
      url: string;
      floor?: string | null;
      label?: string | null;
    }): Promise<string> => {
      if (!user?.id) throw new Error('Not signed in');

      const { data, error } = await supabase
        .from('building_chat_links')
        .insert({
          building_id: params.buildingId,
          platform: params.platform,
          url: params.url.trim(),
          floor: params.floor?.trim() || null,
          label: params.label?.trim() || null,
          submitted_by: user.id,
          academic_year: getCurrentAcademicYear(),
        })
        .select('id')
        .single();

      if (error) {
        // 23514 = check_violation (URL or other constraint)
        if (error.code === '23514') {
          throw new Error('That link doesn\'t look like a valid invite URL for the selected platform.');
        }
        throw error;
      }
      if (!data) throw new Error('Could not submit link');
      return data.id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['building-chat-links'] });
    },
  });
}

/**
 * Delete a chat link. RLS enforces submitter-or-admin.
 */
export function useDeleteChatLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (linkId: string): Promise<void> => {
      const { error } = await supabase
        .from('building_chat_links')
        .delete()
        .eq('id', linkId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['building-chat-links'] });
    },
  });
}

/**
 * Report a chat link. RLS enforces dorm-match for the building.
 * Returns success if already reported (idempotent).
 */
export function useReportChatLink() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { linkId: string; reason?: string }): Promise<void> => {
      if (!user?.id) throw new Error('Not signed in');

      const { error } = await supabase
        .from('building_chat_link_reports')
        .insert({
          link_id: params.linkId,
          reporter_id: user.id,
          reason: params.reason?.trim() || null,
        });

      if (error) {
        // 23505 = unique violation = already reported (idempotent success)
        if (error.code === '23505') return;
        throw error;
      }
    },
    onSuccess: () => {
      // Invalidate so report_count refreshes
      queryClient.invalidateQueries({ queryKey: ['building-chat-links'] });
    },
  });
}
