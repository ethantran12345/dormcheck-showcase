import { studentDisplayName } from '@/lib/studentDisplayName';

/** Minimal profile fields used for marketplace seller display (from listings fetch join). */
export type MarketplaceSellerProfile = {
  full_name: string | null;
  email: string | null;
} | null;

/** Display name for listing detail: full name, then tenant-neutral fallback. */
export function getMarketplaceSellerDisplayName(profiles: MarketplaceSellerProfile): string {
  return studentDisplayName(profiles?.full_name);
}
