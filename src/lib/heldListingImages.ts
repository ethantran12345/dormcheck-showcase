import { supabase } from '@/integrations/supabase/client';

/**
 * Admin access to a held marketplace listing's photos (A2, 20261013000000).
 *
 * moderate-listing moves a held or rejected listing's photos into the private
 * `images-held` bucket; the `held-listing-images` Edge Function is the only way to
 * see, release or discard them. These wrappers are what the Auto-held panel calls.
 */
export interface SignedHeldImage {
  /** The marketplace-images path the photo returns to on approve. */
  path: string;
  /** Short-lived signed URL, absolute against this client's Supabase origin. */
  url: string;
}

/** The function returns origin-relative signed paths; resolve them here. */
export function absoluteSignedUrl(relative: string, origin: string): string | null {
  if (!relative.startsWith('/storage/v1/object/sign/images-held/')) return null;
  return `${origin.replace(/\/$/, '')}${relative}`;
}

type HeldAction = 'sign' | 'release' | 'discard';

async function invokeHeld<T>(listingId: string, action: HeldAction): Promise<T> {
  const { data, error } = await supabase.functions.invoke('held-listing-images', {
    body: { listing_id: listingId, action },
  });
  if (error) throw error;
  return data as T;
}

export async function signHeldListingImages(listingId: string): Promise<SignedHeldImage[]> {
  const data = await invokeHeld<{ images?: SignedHeldImage[] }>(listingId, 'sign');
  const origin = String(import.meta.env?.VITE_SUPABASE_URL ?? '');
  const out: SignedHeldImage[] = [];
  for (const img of Array.isArray(data?.images) ? data.images : []) {
    const url = absoluteSignedUrl(String(img?.url ?? ''), origin);
    if (url) out.push({ path: String(img.path ?? ''), url });
  }
  return out;
}

/**
 * Move the photos back to their public paths. Throws on any failure, so the
 * caller does not approve a listing whose photos are still private.
 */
export async function releaseHeldListingImages(listingId: string): Promise<number> {
  const data = await invokeHeld<{ released?: number }>(listingId, 'release');
  return data?.released ?? 0;
}

/** Delete the held photos after a reject. Best-effort: logged, never thrown. */
export async function discardHeldListingImages(listingId: string): Promise<void> {
  try {
    await invokeHeld(listingId, 'discard');
  } catch (e) {
    console.error('[heldListingImages] discard failed:', e);
  }
}
