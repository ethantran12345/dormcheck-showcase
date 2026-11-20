import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ProductVariation } from "@/types/productVariation";

export const PRODUCT_VARIATIONS_QUERY_KEY = "product_variations";

type VariationRow = {
  id: string;
  product_id: string;
  dimension: string;
  label: string;
  price: number | string | null;
  image_url: string | null;
  affiliate_link: string;
  asin: string | null;
  is_synthetic: boolean;
  position: number;
};

/** A sibling `amazon_products` row (the parent itself or a child variant). */
type SiblingRow = {
  id: string;
  name: string;
  price: number | string | null;
  image_url: string | null;
  affiliate_link: string;
  parent_id: string | null;
  variant_label: string | null;
  variant_dimension: string | null;
};

/** Best-effort ASIN from an Amazon /dp/ link (null for amzn.to short links etc.). */
function asinFromLink(link: string | null | undefined): string | null {
  if (!link) return null;
  const m = link.match(/\/dp\/([A-Z0-9]{10})/i) ?? link.match(/\/gp\/product\/([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : null;
}

/** Sibling-group variants: parent (id = productId) + its children (parent_id = productId),
 *  mapped to the variation shape. Parent leads so the SKU shown on the card is selectable.
 *  Returns [] for a product with no children (no dropdown). */
async function fetchGroupVariants(productId: string): Promise<ProductVariation[]> {
  const { data, error } = await (supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        or: (f: string) => Promise<{ data: SiblingRow[] | null; error: unknown }>;
      };
    };
  })
    .from("amazon_products")
    .select("id, name, price, image_url, affiliate_link, parent_id, variant_label, variant_dimension")
    .or(`id.eq.${productId},parent_id.eq.${productId}`);
  if (error) throw error;

  // Keep the parent plus only children that carry a variant_label (a labelled option).
  // Children without one are hidden de-duplicates, not selectable variants.
  const rows = (data ?? []).filter(
    (r) => r.id === productId || (r.variant_label && r.variant_label.trim())
  );
  if (rows.length < 2) return [];

  const dimension =
    rows.find((r) => r.variant_dimension && r.variant_dimension.trim())?.variant_dimension?.trim() ||
    "Option";

  return rows
    // Parent first, then children ascending by price.
    .sort((a, b) => {
      if (a.id === productId) return -1;
      if (b.id === productId) return 1;
      return Number(a.price ?? 0) - Number(b.price ?? 0);
    })
    .map((r, i) => ({
      id: r.id,
      productId,
      dimension,
      label: (r.variant_label && r.variant_label.trim()) || r.name,
      price: r.price != null ? Number(r.price) : null,
      imageUrl: r.image_url,
      affiliateLink: r.affiliate_link,
      asin: asinFromLink(r.affiliate_link),
      isSynthetic: false,
      position: i,
    }));
}

async function fetchVariations(productId: string): Promise<ProductVariation[]> {
  // `amazon_product_variations` is not yet in the generated Supabase types, so we
  // cast the client to reach the table until `types.ts` is regenerated.
  const { data, error } = await (supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, val: string) => {
          order: (col: string, opts: { ascending: boolean }) => Promise<{ data: VariationRow[] | null; error: unknown }>;
        };
      };
    };
  })
    .from("amazon_product_variations")
    .select("*")
    .eq("product_id", productId)
    .order("position", { ascending: true });

  if (error) throw error;

  const curated = (data ?? []).map((r) => ({
    id: r.id,
    productId: r.product_id,
    dimension: r.dimension,
    label: r.label,
    price: r.price != null ? Number(r.price) : null,
    imageUrl: r.image_url,
    affiliateLink: r.affiliate_link,
    asin: r.asin,
    isSynthetic: r.is_synthetic,
    position: r.position,
  }));
  if (curated.length > 0) return curated;

  // No curated variation rows: fall back to the variant group (parent + child products).
  return fetchGroupVariants(productId);
}

/** Fetches the selectable variants for one product. Runs only when a productId is
 *  present and `enabled` (e.g. the detail modal is open). */
export function useProductVariations(productId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: [PRODUCT_VARIATIONS_QUERY_KEY, productId],
    queryFn: () => fetchVariations(productId as string),
    enabled: Boolean(productId) && enabled,
    staleTime: 5 * 60_000,
  });
}
