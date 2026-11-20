import type { MarketplaceListingItem } from '@/types';

/** Shared MarketplaceListing type used by MarketplaceTab, hooks, and listing detail views. */
export interface MarketplaceListing {
  id: string;
  user_id: string;
  /** Owning tenant. Optional because the guest feed (marketplace_public) and
   *  some narrower selects do not project it; present on the authed feed, where
   *  it is what labels another school's listing and resolves the seller's
   *  verified badge. Never infer the school from the VIEWER — see
   *  VerifiedStudentBadge. */
  university_id?: string | null;
  title: string;
  description: string | null;
  price: number;
  /** First listed price, stamped immutably on insert (migration 20260719140000).
   *  When it exceeds `price`, the seller dropped the price - render it struck
   *  through next to the current price (Facebook-Marketplace style). */
  original_price?: number | null;
  category: string;
  /** @deprecated Use image_urls[0] for preview. Not fetched. */
  image_url?: string | null;
  image_urls?: string[] | null;
  created_at: string;
  status?: 'available' | 'pending' | 'sold' | 'under_review' | 'expired' | 'pending_review' | 'open' | 'claimed' | 'completed';
  /** Set by the listing-verification review flow (migration 20260712140000); renders the Verified badge. */
  verified_at?: string | null;
  profiles: {
    full_name: string | null;
    email: string | null;
    phone_number?: string | null;
  } | null;
  condition?: string | null;
  meetup_location?: string | null;
  price_negotiable?: boolean;
  payment_methods?: string[] | null;
  show_instagram?: boolean;
  show_snapchat?: boolean;
  show_phone?: boolean;
  instagram_handle?: string | null;
  snapchat_handle?: string | null;
  phone_number?: string | null;
  /** Multi-item listing: individually priced/sellable items tagged on the photos. */
  items?: MarketplaceListingItem[];
  /**
   * Post-type discriminator. A sublease carries the structured terms below and
   * is written only by a verified lister (`public.can_post_sublease()`, migration
   * 20260907000000). Everything here is structured EXCEPT house_rules /
   * additional_rules, which are the only free text on a sublease and must never
   * be rendered as a card headline.
   */
  is_sublease?: boolean | null;
  sublease_start?: string | null;
  sublease_end?: string | null;
  building_name?: string | null;
  included_utilities?: string[] | null;
  is_furnished?: boolean | null;
  has_parking?: boolean | null;
  gender_preference?: string | null;
  house_rules?: string | null;
  additional_rules?: string | null;
  /**
   * The real post-type discriminator (migration 20260910000000); `is_sublease`
   * above is a legacy mirror the DB keeps in sync. `request_help`/`offer_help`
   * carry the structured service block and run open -> claimed -> completed.
   *
   * There is deliberately no rate or amount field here: a service post's `price`
   * is 0 by DB CHECK and every surface hides the price for one.
   */
  post_type?: 'item' | 'sublease' | 'request_help' | 'offer_help' | null;
  service_category?: string | null;
  service_date?: string | null;
  service_duration_minutes?: number | null;
  service_location?: string | null;
  service_notes?: string | null;
  claimed_by?: string | null;
}
