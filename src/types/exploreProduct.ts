/** Retail source for a Shop Essentials product. Extensible union - to add a provider,
 *  extend this union, add an adapter in `src/lib/products/provider.ts`, and allow the value
 *  in the `amazon_products.provider` column. */
export type ProductProviderId = "amazon" | "walmart";

/** A selectable variant (size / color / count) of a product, normalized across providers.
 *  `providerItemId` is the provider's SKU id (Amazon ASIN or Walmart item id); `price`/
 *  `imageUrl` fall back to the parent product when null. Backed today by the
 *  `amazon_products.variants` jsonb, or mapped from the `amazon_product_variations` table. */
export type ProductVariant = {
  id: string;
  /** Human label, e.g. "Twin XL / Blue". */
  label: string;
  imageUrl: string | null;
  /** Formatted price string (e.g. "$39.99"); empty when unknown. */
  price: string;
  priceValue: number;
  /** Provider SKU id: Amazon ASIN or Walmart item id. Null for synthesized / unknown. */
  providerItemId: string | null;
  /** Outbound product URL (tag applied via `getProvider(...).buildAffiliateUrl`). */
  url: string;
};

/** Shop Essentials explore product (maps to `amazon_products` + UI fields). Provider-agnostic:
 *  `provider` names the retail source; Amazon-specific fields (`hearts`) stay optional so a
 *  future Walmart row need not populate them. */
export type ExploreProduct = {
  id: string;
  name: string;
  price: string;
  priceValue: number;
  rating: number;
  reviews: number;
  category: string;
  trending: boolean;
  imageUrl: string | null;
  /** Extra angle photos from the listing (gallery). `null`/empty falls back to `[imageUrl]`. */
  imageUrls: string[] | null;
  affiliateLink: string;
  /** Which retail provider backs this row. Defaults to 'amazon'. */
  provider: ProductProviderId;
  /** Inline selectable variants (size/color/count) when denormalized on the row; else fetch
   *  via `getProvider(provider).getVariants(id)`. */
  variants?: ProductVariant[];
  /** Amazon "saves" count. Optional (provider-specific). */
  hearts?: number;
};
