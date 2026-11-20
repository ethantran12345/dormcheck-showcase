import { useQuery } from "@tanstack/react-query";
import type { ExploreProduct } from "@/types/exploreProduct";
import { getProvider } from "@/lib/products/provider";

export const AMAZON_PRODUCTS_QUERY_KEY = ["amazon_products"] as const;

// Reads through the provider seam (`getProvider(...).search()`) rather than importing Supabase
// directly, so swapping Amazon to PA-API - or adding Walmart - is a change in provider.ts alone.
async function fetchAmazonProducts(): Promise<ExploreProduct[]> {
  return getProvider("amazon").search();
}

export function useAmazonProducts() {
  return useQuery({
    queryKey: AMAZON_PRODUCTS_QUERY_KEY,
    queryFn: fetchAmazonProducts,
  });
}

export function useAmazonProductsForModal() {
  return useQuery({
    queryKey: AMAZON_PRODUCTS_QUERY_KEY,
    queryFn: fetchAmazonProducts,
    staleTime: 60_000,
  });
}
