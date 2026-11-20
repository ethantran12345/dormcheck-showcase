import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const MARKETPLACE_ALERTS_QUERY_KEY = 'marketplace_alerts';
/** Server-enforced cap (trg_marketplace_alerts_before_insert). */
export const MAX_MARKETPLACE_ALERTS = 10;

export interface MarketplaceAlert {
  id: string;
  user_id: string;
  name: string;
  /** Empty array = any category. */
  categories: string[];
  min_price: number | null;
  max_price: number | null;
  keywords: string | null;
  enabled: boolean;
  created_at: string;
}

export interface MarketplaceAlertInput {
  name: string;
  categories: string[];
  min_price: number | null;
  max_price: number | null;
  keywords: string | null;
}

const alertsTable = () => supabase.from('marketplace_alerts');

export function useMarketplaceAlerts(userId: string | undefined) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [MARKETPLACE_ALERTS_QUERY_KEY, userId] });

  const { data: alerts = [], isLoading } = useQuery({
    queryKey: [MARKETPLACE_ALERTS_QUERY_KEY, userId],
    queryFn: async (): Promise<MarketplaceAlert[]> => {
      const { data, error } = await alertsTable()
        .select('id, user_id, name, categories, min_price, max_price, keywords, enabled, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as unknown as MarketplaceAlert[]) ?? [];
    },
    enabled: Boolean(userId),
    staleTime: 60_000,
  });

  const createAlert = useMutation({
    mutationFn: async (input: MarketplaceAlertInput) => {
      const { error } = await alertsTable().insert({ ...input, user_id: userId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const updateAlert = useMutation({
    mutationFn: async ({ id, ...patch }: Partial<MarketplaceAlertInput> & { id: string; enabled?: boolean }) => {
      const { error } = await alertsTable().update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const deleteAlert = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await alertsTable().delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { alerts, isLoading, createAlert, updateAlert, deleteAlert };
}
