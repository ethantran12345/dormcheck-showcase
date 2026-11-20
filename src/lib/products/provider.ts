/**
 * Provider-agnostic product layer for Shop Essentials.
 *
 * The UI reads products, variants, and outbound affiliate URLs through a `ProductProvider`
 * adapter instead of importing Amazon helpers directly. Today everything is served by the
 * StaticProvider (reads the seeded `amazon_products` / `amazon_product_variations` data).
 * Swapping to a live API (Amazon PA-API, Walmart/Impact) is a one-file change here - the
 * component tree never touches provider internals.
 *
 * Seam:
 *   getProvider(id).search(query, filters)  -> ExploreProduct[]
 *   getProvider(id).getItem(id)             -> ExploreProduct | null
 *   getProvider(id).getVariants(productId)  -> ProductVariant[]
 *   getProvider(id).buildAffiliateUrl(x)    -> tagged outbound href
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  ExploreProduct,
  ProductProviderId,
  ProductVariant,
} from "@/types/exploreProduct";
import { isAmazonAffiliateUrl, isSafeHttpUrl, withAffiliateTag } from "@/lib/amazonAffiliateUrl";

/** Impact/Walmart publisher id (TODO: real value once the Walmart/Impact program is approved). */
const WALMART_PUBLISHER_ID = import.meta.env.VITE_WALMART_PUBLISHER_ID as string | undefined;

export interface ProductSearchFilters {
  category?: string;
  /** Free-text query (equivalent to the first `search` arg). */
  query?: string;
}

/** Anything carrying an outbound product URL - a product, a variant, or a raw link string. */
export type AffiliateUrlInput =
  | string
  | Pick<ExploreProduct, "affiliateLink">
  | Pick<ProductVariant, "url">;

export interface ProductProvider {
  readonly id: ProductProviderId;
  /** Search the catalog (query + optional filters). */
  search(query?: string, filters?: ProductSearchFilters): Promise<ExploreProduct[]>;
  /** Fetch one product by id. */
  getItem(id: string): Promise<ExploreProduct | null>;
  /** Selectable variants (size/color/count) for a product. */
  getVariants(productId: string): Promise<ProductVariant[]>;
  /** Return the outbound href with this provider's affiliate tag applied. */
  buildAffiliateUrl(input: AffiliateUrlInput): string;
}

export class NotImplementedError extends Error {
  constructor(provider: ProductProviderId, method: string) {
    super(`${provider}.${method}() is not implemented yet`);
    this.name = "NotImplementedError";
  }
}

function urlOf(input: AffiliateUrlInput): string {
  if (typeof input === "string") return input;
  if ("url" in input && input.url) return input.url;
  if ("affiliateLink" in input && input.affiliateLink) return input.affiliateLink;
  return "";
}

// --- Row shapes (generated Supabase types lag prod - widen the rows here). ---

type ProductRow = {
  id: string;
  name: string;
  price: number | string | null;
  category: string;
  is_trending: boolean | null;
  image_url: string | null;
  image_urls: string[] | null;
  affiliate_link: string;
  hearts: number | null;
  rating: number | string | null;
  review_count: number | null;
  provider?: string | null;
  variants?: unknown;
  // Variant grouping (migration 20260719120000). A row with parent_id set is a child variant
  // of another product: hidden from the grid, surfaced as an option in the parent's modal.
  parent_id?: string | null;
  variant_label?: string | null;
  variant_dimension?: string | null;
};

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

function formatPrice(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** Coerce a `variants` jsonb blob into the neutral ProductVariant[] shape. */
function parseVariantsJson(raw: unknown): ProductVariant[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const parsed = raw
    .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
    .map((v): ProductVariant => {
      const priceValueRaw = Number(v.priceValue ?? v.price_value ?? 0);
      const priceValue = Number.isFinite(priceValueRaw) ? priceValueRaw : 0;
      const imageUrl =
        typeof v.imageUrl === "string" ? v.imageUrl : typeof v.image_url === "string" ? v.image_url : null;
      const providerItemId =
        typeof v.providerItemId === "string"
          ? v.providerItemId
          : typeof v.provider_item_id === "string"
            ? v.provider_item_id
            : null;
      return {
        id: String(v.id ?? ""),
        label: String(v.label ?? ""),
        imageUrl,
        price: typeof v.price === "string" ? v.price : formatPrice(priceValue),
        priceValue,
        providerItemId,
        url: typeof v.url === "string" ? v.url : "",
      };
    })
    .filter((v) => v.id && v.label);
  return parsed.length > 0 ? parsed : undefined;
}

/** `amazon_products` row -> neutral ExploreProduct. Shared by every static read path. */
export function mapProductRow(row: ProductRow): ExploreProduct {
  const numericPrice = Number(row.price ?? 0);
  const safePrice = Number.isFinite(numericPrice) ? numericPrice : 0;
  const rawImageUrls = row.image_urls;
  const imageUrls =
    Array.isArray(rawImageUrls) && rawImageUrls.length > 0
      ? rawImageUrls.filter((u): u is string => typeof u === "string" && u.trim().length > 0)
      : null;
  const provider: ProductProviderId = row.provider === "walmart" ? "walmart" : "amazon";
  return {
    id: row.id,
    name: row.name,
    price: formatPrice(safePrice),
    priceValue: safePrice,
    category: row.category,
    trending: Boolean(row.is_trending),
    imageUrl: row.image_url,
    imageUrls: imageUrls && imageUrls.length > 0 ? imageUrls : null,
    affiliateLink: row.affiliate_link,
    provider,
    variants: parseVariantsJson(row.variants),
    hearts: row.hearts ?? 0,
    rating: Number(row.rating ?? 0) || 0,
    reviews: row.review_count ?? 0,
  };
}

/** Best-effort ASIN from an Amazon /dp/ link (null for amzn.to short links etc.). */
function asinFromLink(link: string | null | undefined): string | null {
  if (!link) return null;
  const m = link.match(/\/dp\/([A-Z0-9]{10})/i) ?? link.match(/\/gp\/product\/([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : null;
}

/** A child `amazon_products` row (parent_id set) -> neutral ProductVariant. The child keeps its
 *  own full row; `variant_label` is its option name (falls back to the product name). */
function childRowToVariant(row: ProductRow): ProductVariant {
  const numericPrice = Number(row.price ?? 0);
  const priceValue = Number.isFinite(numericPrice) ? numericPrice : 0;
  return {
    id: row.id,
    label: (row.variant_label && row.variant_label.trim()) || row.name,
    imageUrl: row.image_url,
    price: formatPrice(priceValue),
    priceValue,
    providerItemId: asinFromLink(row.affiliate_link),
    url: row.affiliate_link,
  };
}

/** `amazon_product_variations` row -> neutral ProductVariant. */
function mapVariationRow(r: VariationRow): ProductVariant {
  const priceValueRaw = r.price != null ? Number(r.price) : NaN;
  const priceValue = Number.isFinite(priceValueRaw) ? priceValueRaw : 0;
  return {
    id: r.id,
    label: r.label,
    imageUrl: r.image_url,
    price: r.price != null && Number.isFinite(priceValueRaw) ? formatPrice(priceValue) : "",
    priceValue,
    providerItemId: r.asin,
    url: r.affiliate_link,
  };
}

// --- Static reads over today's seeded Supabase data (what actually runs now). ---

async function staticSearch(query?: string, filters?: ProductSearchFilters): Promise<ExploreProduct[]> {
  const { data, error } = await supabase
    .from("amazon_products")
    .select("*")
    .order("is_trending", { ascending: false })
    .order("review_count", { ascending: false, nullsFirst: false });
  if (error) throw error;

  const raw = (data ?? []) as unknown as ProductRow[];

  // Variant grouping: child rows (parent_id set) are hidden from the grid and folded into their
  // parent's `variants` list so the whole family collapses to a single card. Children are sorted
  // by price so the cheapest option leads the picker.
  const childrenByParent = new Map<string, ProductRow[]>();
  for (const row of raw) {
    if (!row.parent_id) continue;
    const list = childrenByParent.get(row.parent_id) ?? [];
    list.push(row);
    childrenByParent.set(row.parent_id, list);
  }

  let rows = raw
    .filter((row) => !row.parent_id)
    .map((row) => {
      const product = mapProductRow(row);
      // Only children carrying a `variant_label` are selectable variants; a child without one
      // is a hidden de-duplicate (kept off the grid via parent_id, not shown as an option).
      const kids = (childrenByParent.get(row.id) ?? []).filter(
        (k) => k.variant_label && k.variant_label.trim()
      );
      if (kids.length > 0) {
        const childVariants = kids
          .map(childRowToVariant)
          .sort((a, b) => a.priceValue - b.priceValue);
        product.variants = [...(product.variants ?? []), ...childVariants];
      }
      return product;
    });

  const q = (query ?? filters?.query ?? "").trim().toLowerCase();
  const category = filters?.category?.trim();
  if (category && category !== "All") rows = rows.filter((p) => p.category === category);
  if (q) rows = rows.filter((p) => p.name.toLowerCase().includes(q));
  return rows;
}

async function staticGetItem(id: string): Promise<ExploreProduct | null> {
  const { data, error } = await supabase.from("amazon_products").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? mapProductRow(data as unknown as ProductRow) : null;
}

async function staticGetVariants(productId: string): Promise<ProductVariant[]> {
  // Live source this pass = the amazon_product_variations table (feeds the detail modal),
  // mapped to the neutral shape. Falls back to the amazon_products.variants jsonb - the
  // provider-agnostic store (seeded for the next handoff / where non-Amazon providers keep theirs).
  const { data, error } = await (
    supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (
            col: string,
            val: string
          ) => {
            order: (
              col: string,
              opts: { ascending: boolean }
            ) => Promise<{ data: VariationRow[] | null; error: unknown }>;
          };
        };
      };
    }
  )
    .from("amazon_product_variations")
    .select("*")
    .eq("product_id", productId)
    .order("position", { ascending: true });
  if (error) throw error;

  const fromTable = (data ?? []).map(mapVariationRow);
  if (fromTable.length > 0) return fromTable;

  // Variant grouping: children in `amazon_products` (parent_id = productId) are variants too.
  const { data: childRows, error: childErr } = await supabase
    .from("amazon_products")
    .select("*")
    .eq("parent_id", productId);
  if (childErr) throw childErr;
  const fromChildren = ((childRows ?? []) as unknown as ProductRow[])
    .filter((r) => r.variant_label && r.variant_label.trim())
    .map(childRowToVariant)
    .sort((a, b) => a.priceValue - b.priceValue);
  if (fromChildren.length > 0) return fromChildren;

  const item = await staticGetItem(productId);
  return item?.variants ?? [];
}

/**
 * StaticProvider - reads today's seeded Supabase data. This is the implementation that
 * actually runs; AmazonProvider currently delegates its reads here.
 */
export const StaticProvider: ProductProvider = {
  id: "amazon",
  search: staticSearch,
  getItem: staticGetItem,
  getVariants: staticGetVariants,
  buildAffiliateUrl: (input) => withAffiliateTag(urlOf(input)),
};

/**
 * AmazonProvider - Amazon adapter. Reads delegate to the static seed data until the Amazon
 * Product Advertising API (PA-API) is wired in; affiliate tagging is live (dormcheck-20).
 */
export const AmazonProvider: ProductProvider = {
  id: "amazon",
  // TODO(PA-API): replace with PA-API SearchItems (keyword + BrowseNode filters).
  search: staticSearch,
  // TODO(PA-API): replace with PA-API GetItems by ASIN.
  getItem: staticGetItem,
  // TODO(PA-API): replace with PA-API GetVariations for the parent ASIN.
  getVariants: staticGetVariants,
  buildAffiliateUrl: (input) => withAffiliateTag(urlOf(input)),
};

/**
 * WalmartProvider - stub. Reads throw until the Walmart Affiliate / Impact API is approved
 * (sales-gated). Only affiliate tagging is stubbed out with the Impact publisher-id path.
 */
export const WalmartProvider: ProductProvider = {
  id: "walmart",
  // TODO(walmart): Walmart Affiliate/Impact catalog search.
  search: () => Promise.reject(new NotImplementedError("walmart", "search")),
  // TODO(walmart): Walmart item lookup by item id.
  getItem: () => Promise.reject(new NotImplementedError("walmart", "getItem")),
  // TODO(walmart): Walmart variant lookup.
  getVariants: () => Promise.reject(new NotImplementedError("walmart", "getVariants")),
  buildAffiliateUrl: (input) => {
    const url = urlOf(input);
    if (!isSafeHttpUrl(url)) return url;
    // TODO(Impact): swap for the real Impact deep-link format once the program is live.
    try {
      const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
      if (WALMART_PUBLISHER_ID) u.searchParams.set("publisherId", WALMART_PUBLISHER_ID);
      return u.toString();
    } catch {
      return url;
    }
  },
};

// --- Registry + factory ---

export const DEFAULT_PROVIDER_ID: ProductProviderId = "amazon";

const REGISTRY: Record<ProductProviderId, ProductProvider> = {
  // 'amazon' resolves to the Amazon adapter, which currently backs onto StaticProvider.
  amazon: AmazonProvider,
  walmart: WalmartProvider,
};

/** Resolve the adapter for a provider id (defaults to Amazon). */
export function getProvider(id?: ProductProviderId | null): ProductProvider {
  return REGISTRY[id ?? DEFAULT_PROVIDER_ID] ?? REGISTRY[DEFAULT_PROVIDER_ID];
}

/** Best-effort provider inference for a raw outbound link that carries no provider field
 *  (e.g. a checklist item link). Defaults to Amazon, matching legacy `withAffiliateTag`. */
export function detectProviderFromUrl(url: string | null | undefined): ProductProviderId {
  // TODO(walmart): detect walmart.com / goto.walmart.com hosts once Walmart links ship.
  if (isAmazonAffiliateUrl(url)) return "amazon";
  return DEFAULT_PROVIDER_ID;
}

/** Provider-agnostic outbound tagger for a raw link. Pass `providerId` when known; otherwise
 *  it is inferred from the URL. For Amazon this equals `withAffiliateTag` (identical output). */
export function buildAffiliateUrl(link: string, providerId?: ProductProviderId): string {
  return getProvider(providerId ?? detectProviderFromUrl(link)).buildAffiliateUrl(link);
}
