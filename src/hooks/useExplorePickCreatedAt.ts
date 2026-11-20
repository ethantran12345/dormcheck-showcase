import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const EXPLORE_PICK_CREATED_AT_QUERY_KEY = "explore_pick_created_at";

type PickCreatedRow = {
  product_name: string;
  created_at: string;
};

async function fetchPickCreatedAt(userId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("explore_picks")
    .select("product_name, created_at")
    .eq("user_id", userId);

  if (error) throw error;

  const map = new Map<string, string>();
  for (const row of (data ?? []) as PickCreatedRow[]) {
    if (row.product_name && row.created_at) map.set(row.product_name, row.created_at);
  }
  return map;
}

/**
 * Map of product_name → the timestamp the pick was first saved (`explore_picks.created_at`).
 * Powers the "Added to checklist" archive's date label. Keyed on `product_name`, matching
 * `useExplorePickVariants`.
 */
export function useExplorePickCreatedAt(userId: string | null | undefined) {
  return useQuery({
    queryKey: [EXPLORE_PICK_CREATED_AT_QUERY_KEY, userId],
    queryFn: () => fetchPickCreatedAt(userId as string),
    enabled: Boolean(userId),
    staleTime: 30_000,
  });
}
