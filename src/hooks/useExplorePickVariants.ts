import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const EXPLORE_PICK_VARIANTS_QUERY_KEY = "explore_pick_variants";

/** The variant a user chose for a saved pick (keyed by product_name in the returned map). */
export type PickVariant = {
  variantId: string | null;
  label: string | null;
  imageUrl: string | null;
  affiliateLink: string | null;
  asin: string | null;
};

type PickVariantRow = {
  product_name: string;
  variant_id: string | null;
  variant_label: string | null;
  variant_image_url: string | null;
  variant_affiliate_link: string | null;
  variant_asin: string | null;
};

async function fetchPickVariants(userId: string): Promise<Map<string, PickVariant>> {
  // explore_picks variant_* columns are not yet in the generated Supabase types
  // (types.ts lags prod), so cast the client to reach them until it's regenerated.
  const { data, error } = await (supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, val: string) => Promise<{ data: PickVariantRow[] | null; error: unknown }>;
      };
    };
  })
    .from("explore_picks")
    .select("product_name, variant_id, variant_label, variant_image_url, variant_affiliate_link, variant_asin")
    .eq("user_id", userId);

  if (error) throw error;

  const map = new Map<string, PickVariant>();
  for (const row of data ?? []) {
    // Only track picks that carry a real variant selection.
    if (!row.variant_label && !row.variant_image_url && !row.variant_id) continue;
    map.set(row.product_name, {
      variantId: row.variant_id,
      label: row.variant_label,
      imageUrl: row.variant_image_url,
      affiliateLink: row.variant_affiliate_link,
      asin: row.variant_asin,
    });
  }
  return map;
}

/** Map of product_name → chosen variant for the current user's saved picks. */
export function useExplorePickVariants(userId: string | null | undefined) {
  return useQuery({
    queryKey: [EXPLORE_PICK_VARIANTS_QUERY_KEY, userId],
    queryFn: () => fetchPickVariants(userId as string),
    enabled: Boolean(userId),
    staleTime: 30_000,
  });
}
