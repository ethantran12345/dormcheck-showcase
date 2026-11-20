import { supabase } from '@/integrations/supabase/client';

/**
 * Seller contact fields for a marketplace listing. These are no longer readable
 * directly off the marketplace_listings base table (SEC-6) - the DB revokes
 * column access and serves opt-out-masked values through the
 * marketplace_listings_contact view, which this helper reads.
 *
 * A field is null when the seller has not opted in (show_phone/show_instagram/
 * show_snapchat = false) and the caller is not the listing owner.
 */
export interface ListingContact {
  phone_number: string | null;
  instagram_handle: string | null;
  snapchat_handle: string | null;
}

const EMPTY_CONTACT: ListingContact = {
  phone_number: null,
  instagram_handle: null,
  snapchat_handle: null,
};

/** Fetch opt-out-masked contact for the given listing ids, keyed by id. */
export async function fetchListingContacts(ids: string[]): Promise<Map<string, ListingContact>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const map = new Map<string, ListingContact>();
  if (unique.length === 0) return map;

  // marketplace_listings_contact is a view not present in generated types.
  const { data, error } = await (supabase as never as typeof supabase)
    .from('marketplace_listings_contact' as never)
    .select('id, phone_number, instagram_handle, snapchat_handle')
    .in('id', unique);

  if (error || !data) return map;
  for (const row of data as unknown as Array<{ id: string } & ListingContact>) {
    map.set(row.id, {
      phone_number: row.phone_number ?? null,
      instagram_handle: row.instagram_handle ?? null,
      snapchat_handle: row.snapchat_handle ?? null,
    });
  }
  return map;
}

/**
 * Merge opt-out-masked contact into a set of listing rows. Returns new objects
 * so the shape matches what the UI previously read off the base table (with the
 * three contact fields now masked by the DB). Rows missing from the view get
 * nulled contact.
 */
export async function withListingContacts<T extends { id: string }>(rows: T[]): Promise<(T & ListingContact)[]> {
  const contacts = await fetchListingContacts(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, ...(contacts.get(r.id) ?? EMPTY_CONTACT) }));
}

/** Convenience for a single listing row (or null). */
export async function withListingContact<T extends { id: string }>(row: T | null): Promise<(T & ListingContact) | null> {
  if (!row) return null;
  const [merged] = await withListingContacts([row]);
  return merged;
}
