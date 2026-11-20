/** A selectable variant (color / size / count) of an `amazon_products` row.
 *  Backed by the `amazon_product_variations` table. `price`/`imageUrl` are usually
 *  null (fall back to the parent product); the affiliate link points at the variant ASIN. */
export type ProductVariation = {
  id: string;
  productId: string;
  dimension: string;
  label: string;
  price: number | null;
  imageUrl: string | null;
  affiliateLink: string;
  asin: string | null;
  isSynthetic: boolean;
  position: number;
};
