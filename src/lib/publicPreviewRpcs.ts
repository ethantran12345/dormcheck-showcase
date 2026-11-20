import { supabase } from '@/integrations/supabase/client';
import type { MarketplaceListing } from '@/types/marketplace';

export type MarketplacePreviewListing = {
  id: string;
  title: string;
  price: number;
  category: string;
  image_url: string | null;
};

export type MarketplacePreviewResult = {
  total_count: number;
  listings: MarketplacePreviewListing[];
};

export type SetupsPreviewResult = {
  total_count: number;
  photo_urls: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function fetchMarketplacePreview(universityId?: string): Promise<MarketplacePreviewResult> {
  // p_university_id arg cast pending types.ts regen (generated types lag prod migrations)
  const { data, error } = await supabase.rpc('get_marketplace_preview', {
    p_university_id: universityId ?? null,
  } as never);
  if (error) throw error;
  const row = asRecord(data) ?? {};
  const listingsRaw = Array.isArray(row.listings) ? row.listings : [];
  return {
    total_count: Number(row.total_count ?? 0),
    listings: listingsRaw
      .map((item) => {
        const listing = asRecord(item);
        if (!listing || typeof listing.id !== 'string') return null;
        return {
          id: listing.id,
          title: String(listing.title ?? ''),
          price: Number(listing.price ?? 0),
          category: String(listing.category ?? ''),
          image_url: typeof listing.image_url === 'string' ? listing.image_url : null,
        };
      })
      .filter((item): item is MarketplacePreviewListing => item != null),
  };
}

export async function fetchSetupsPreview(universityId?: string): Promise<SetupsPreviewResult> {
  // p_university_id arg cast pending types.ts regen (generated types lag prod migrations)
  const { data, error } = await supabase.rpc('get_setups_preview', {
    p_university_id: universityId ?? null,
  } as never);
  if (error) throw error;
  const row = asRecord(data) ?? {};
  const photoUrls = Array.isArray(row.photo_urls)
    ? row.photo_urls.filter((url): url is string => typeof url === 'string')
    : [];
  return {
    total_count: Number(row.total_count ?? 0),
    photo_urls: photoUrls,
  };
}

/** Map preview RPC listing rows to MarketplaceListing for SneakPeekBlurWall card grid. */
export function mapPreviewListingToMarketplaceListing(
  listing: MarketplacePreviewListing,
): MarketplaceListing {
  const imageUrls = listing.image_url ? [listing.image_url] : [];
  return {
    id: listing.id,
    user_id: '',
    title: listing.title,
    description: null,
    price: listing.price,
    category: listing.category,
    image_url: listing.image_url,
    image_urls: imageUrls,
    created_at: new Date(0).toISOString(),
    status: 'available',
    profiles: null,
  };
}

export async function fetchMarketplacePreviewListings(universityId?: string): Promise<MarketplaceListing[]> {
  const preview = await fetchMarketplacePreview(universityId);
  return preview.listings.map(mapPreviewListingToMarketplaceListing);
}

export type SetupPhotoTeaser = {
  id: number;
  image_url: string;
  author_name: string;
  caption: string | null;
  likes: number;
  dorm_name: string;
  created_at: string;
};

/** Negative ids mark RPC teaser rows (no setup detail fetch). */
export function mapSetupPreviewPhotos(photoUrls: string[]): SetupPhotoTeaser[] {
  return photoUrls.map((url, index) => ({
    id: -(index + 1),
    image_url: url,
    author_name: '',
    caption: null,
    likes: 0,
    dorm_name: '',
    created_at: new Date(0).toISOString(),
  }));
}

export function isSetupPreviewTeaserId(setupId: number): boolean {
  return setupId < 0;
}
