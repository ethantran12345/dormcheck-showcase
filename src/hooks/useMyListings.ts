import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAnalytics } from '@/hooks/useAnalytics';
import type { MarketplacePaymentMethod } from '@/lib/marketplacePaymentMethods';
import { withListingContacts } from '@/lib/marketplaceContact';
import { toast } from 'sonner';
import { haptic } from '@/lib/haptics';
import { sanitizeText, sanitizeOptional, safeImageSrc } from '@/lib/sanitize';
import { minAvailablePrice, allItemsSold, type DraftListingItem } from '@/lib/listingItems';
import {
  isListingLiveAfterModeration,
  type ModerationDecision,
} from '@/lib/marketplaceModeration';
import type { MarketplaceListingItem } from '@/types';
import {
  SERVICE_POST_PRICE,
  isServicePostType,
  type PostType,
  type ServiceCategory,
} from '@/lib/postTypes';
import { firstUnmetSubleaseTerm, subleaseTitle } from '@/lib/subleases';
import { firstUnmetServiceDetail, serviceInsertColumns } from '@/lib/servicePosts';

/** How long the create flow waits for a moderation verdict before treating the
 *  listing as submitted-and-in-review. A clean listing clears well under this. */
const MODERATION_WAIT_MS = 8_000;

/**
 * Fire the pre-publish gate for a listing that is sitting in 'pending_review'
 * and wait a short beat for its verdict. supabase-js attaches the caller's JWT;
 * the fn verifies ownership via JWKS and flips the status via service_role. A
 * clean listing clears in ~1-2s -> 'approve'; anything else (held/rejected) or a
 * timeout/error resolves 'pending' and the listing simply stays in review. Never
 * thrown as a failure: the post or edit IS submitted either way.
 *
 * Used by create AND edit. An edit to a screened field lands the row back in
 * 'pending_review' server-side (trigger rescreen_listing_on_edit, migration
 * 20261011000000); without this call it would wait for a human instead.
 */
async function requestModerationVerdict(listingId: string): Promise<ModerationDecision> {
  try {
    const raced = await Promise.race([
      supabase.functions.invoke('moderate-listing', { body: { listing_id: listingId } }),
      new Promise<{ data: { decision: ModerationDecision } }>((resolve) =>
        setTimeout(() => resolve({ data: { decision: 'pending' } }), MODERATION_WAIT_MS),
      ),
    ]);
    const raw = (raced as { data?: { decision?: string } | null })?.data?.decision;
    if (raw === 'approve' || raw === 'hold' || raw === 'reject') return raw;
  } catch (moderationErr) {
    // Gate unreachable/misconfigured: the listing simply stays in review.
    console.error('moderate-listing invoke failed; listing stays in review:', moderationErr);
  }
  return 'pending';
}

export interface MyListing {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  price: number;
  category: string;
  status?: 'available' | 'pending' | 'sold' | 'under_review' | 'expired' | 'pending_review' | 'open' | 'claimed' | 'completed';
  /** Auto-moderation verdict (migration 20260719150000). Owner sees "In review". */
  moderation_decision?: 'approved' | 'held' | 'rejected' | null;
  /** One-line reason shown to the owner when a listing is held/rejected. */
  moderation_reason?: string | null;
  /** Array of image URLs. Use image_urls[0] for thumbnail preview. */
  image_urls?: string[] | null;
  created_at: string;
  condition: string | null;
  meetup_location: string | null;
  show_instagram: boolean;
  show_snapchat: boolean;
  show_phone?: boolean;
  instagram_handle?: string | null;
  snapchat_handle?: string | null;
  phone_number?: string | null;
  /** Multi-item listing: individually priced/sellable items tagged on the photos. */
  items?: MarketplaceListingItem[];
  /** The post-type discriminator; owner-facing surfaces branch the lifecycle on it. */
  post_type?: PostType | null;
  service_category?: string | null;
  service_date?: string | null;
  service_duration_minutes?: number | null;
  service_location?: string | null;
}

export const MARKETPLACE_CATEGORIES = [
  'Furniture',
  'Electronics',
  'Textbooks',
  'Clothing',
  'Appliances',
  'Decor',
  'Kitchen',
  'Supplies',
  'Other',
] as const;

export type MarketplaceCategory = (typeof MARKETPLACE_CATEGORIES)[number];

/** Categories shown in filter bar. */
export const MARKETPLACE_CATEGORIES_FILTER = MARKETPLACE_CATEGORIES;

export const MARKETPLACE_CONDITIONS = ['New', 'Like New', 'Good', 'Fair'] as const;

export interface ListingForm {
  title: string;
  description: string;
  price: string;
  category: MarketplaceCategory;
  /** Up to 5 images. Replaces single imageFile for new flow. */
  imageFiles: File[];
  /** Legacy single file (optional, for backward compat). */
  imageFile?: File | null;
  /** Existing listing primary image URL. */
  imageUrl?: string | null;
  /** Existing listing all image URLs (when supported). */
  imageUrls?: string[] | null;
  /** Unified gallery for edit: URLs + new files in display order. When set, used instead of imageFiles for update. */
  listingImages?: Array<{ type: 'url'; url: string } | { type: 'file'; file: File }>;
  /** Item condition: New, Like New, Good, Fair. */
  condition?: string;
  /** Campus landmark or meetup location for handoff. */
  meetup_location?: string;
  /** Whether to display seller Instagram on the listing. */
  show_instagram?: boolean;
  /** Whether to display seller Snapchat on the listing. */
  show_snapchat?: boolean;
  /** Seller Instagram handle (stored on listing at submit). */
  instagram_handle?: string;
  /** Seller Snapchat handle (stored on listing at submit). */
  snapchat_handle?: string;
  /** Seller phone number (stored on listing at submit). */
  phone_number?: string;
  /** Whether to display seller phone number on the listing. */
  show_phone?: boolean;
  /** Whether the seller is open to negotiating price. */
  price_negotiable?: boolean;
  /** Accepted payment types: zelle, venmo, cash. */
  payment_methods?: MarketplacePaymentMethod[];
  /**
   * Multi-item listing: items tagged on the photos, each with its own name and
   * price. When non-empty the listing price is derived (min available item
   * price, shown as "From $X") and the form price field is ignored.
   */
  items?: DraftListingItem[];
  /**
   * Which post type composed this form. Drives the single discriminator column
   * (`is_sublease`) and which of the sublease columns below are written.
   * Absent = `item`, so every existing caller is unchanged.
   */
  post_type?: PostType;
  /** Sublease terms — structured only. See src/lib/subleases.ts for the rule. */
  sublease_start?: string | null;
  sublease_end?: string | null;
  /**
   * Optional registry enrichment — the `public.buildings` row whose address the
   * lister accepted from autocomplete. Never required and never what pins.
   */
  building_id?: string | null;
  /** THE ADDRESS, and the required "where" of a sublease. Also its stored title. */
  building_name?: string | null;
  /**
   * Geocoded from `building_name` at submit, on BOTH the create and the edit
   * path, and written by nothing else. A sublease pins iff these are set, and the
   * composer refuses the post when the geocode comes back null — see
   * `geocodeSubleaseAddress()`.
   */
  latitude?: number | null;
  longitude?: number | null;
  included_utilities?: string[] | null;
  is_furnished?: boolean | null;
  has_parking?: boolean | null;
  gender_preference?: string | null;
  /** The only free text on a sublease. Rendered last, never as a headline. */
  house_rules?: string | null;
  additional_rules?: string | null;
  /**
   * Service terms — structured only, and deliberately WITHOUT a rate, deposit
   * or amount field. See src/lib/servicePosts.ts for why that absence is the
   * rule and not an oversight.
   */
  service_category?: ServiceCategory | null;
  service_date?: string | null;
  service_duration_minutes?: number | null;
  service_location?: string | null;
  service_notes?: string | null;
  /**
   * The tutoring academic-integrity acknowledgement. TRANSIENT — there is no
   * such column and `serviceInsertColumns()` names its columns explicitly, so
   * this cannot reach the row. It gates submit, and the terms it acknowledges
   * render on the listing itself for the reader too.
   */
  service_integrity_ack?: boolean;
}

/** Columns fetched for listing items (child table has no contact columns; SEC-6 unaffected). */
const LISTING_ITEM_COLUMNS = 'id, listing_id, name, price, status, x, y, photo_index';

function validateItems(items: DraftListingItem[]): string | null {
  for (const item of items) {
    if (!item.name.trim()) return 'Every item needs a name';
    if (Number.isNaN(item.price) || item.price < 0) return 'Every item needs a valid price';
  }
  return null;
}


export function useMyListings(userId: string | undefined) {
  const queryClient = useQueryClient();
  const { trackAction } = useAnalytics();
  const [listings, setListings] = useState<MyListing[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const hasLoadedOnce = useRef(false);

  const fetchListings = useCallback(async () => {
    if (!userId) {
      hasLoadedOnce.current = false;
      setListings([]);
      return;
    }
    if (!hasLoadedOnce.current) {
      setIsLoading(true);
    }
    try {
      const { data, error } = await supabase
        .from('marketplace_listings')
        // moderation_decision/moderation_reason back the owner "In review" chip
        // (migration 20260719150000). The cast below reconciles the joined-select
        // row with the hand-rolled MyListing shape (narrower status/decision unions).
        // post_type: the owner-facing widgets must know which lifecycle a row
        // runs, or a service post reads as a $0 item with a "Mark sold" button
        // that the DB's status CHECK would reject anyway.
        .select(`id, user_id, title, description, price, category, image_urls, created_at, status, moderation_decision, moderation_reason, condition, meetup_location, show_instagram, show_snapchat, show_phone, post_type, service_category, service_date, service_duration_minutes, service_location, items:marketplace_listing_items(${LISTING_ITEM_COLUMNS})`)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      // Contact fields come from the opt-out-masked view (SEC-6); owner sees own.
      setListings(await withListingContacts((data as unknown as MyListing[]) ?? []));
    } catch (e) {
      const err = e as { message?: string; details?: string; hint?: string };
      console.error('Failed to fetch my listings:', e);
      console.error('Supabase error details:', { message: err?.message, details: err?.details, hint: err?.hint });
      if (typeof err?.message === 'string' && /column\s+["']?image_urls["']?\s+does not exist/i.test(err.message)) {
        console.error('The image_urls column is missing on marketplace_listings. Re-run the migration: supabase/migrations/20260216000001_marketplace_listings_image_urls.sql');
      }
      toast.error('Failed to load your listings');
      if (!hasLoadedOnce.current) {
        setListings([]);
      }
    } finally {
      setIsLoading(false);
      hasLoadedOnce.current = true;
    }
  }, [userId]);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  const createListing = async (
    form: ListingForm,
    onSuccess?: () => void
  ): Promise<boolean> => {
    if (!userId) {
      toast.error('Sign in to create a listing');
      return false;
    }
    // A sublease has no title INPUT — its title is its building name, so the
    // headline is a structured value at the data layer and not by review. See
    // src/lib/subleases.ts.
    const isSublease = form.post_type === 'sublease';
    const isService = isServicePostType(form.post_type ?? 'item');
    const title = isSublease ? subleaseTitle(form) : form.title.trim();
    if (!title) {
      toast.error(isSublease ? 'Enter the building' : 'Enter a title');
      return false;
    }
    // Name the field that is actually unmet. The composer already blocks submit
    // with the same three messages (MarketplaceCreate `blocked.sublease*`); this
    // is the hook-layer backstop for any other caller, and it used to collapse
    // all three reasons into the dates one.
    const unmetSubleaseTerm = isSublease ? firstUnmetSubleaseTerm(form) : null;
    if (unmetSubleaseTerm) {
      toast.error(
        unmetSubleaseTerm === 'building'
          ? 'Add the building you are subletting'
          : unmetSubleaseTerm === 'range'
            ? 'The end date has to come after the start date'
            : 'Add a start and end date'
      );
      return false;
    }
    const items = form.items ?? [];
    const itemError = validateItems(items);
    if (itemError) {
      toast.error(itemError);
      return false;
    }
    // Multi-item listings derive the card price from items ("From $X"). A
    // service post has no price input at all and is pinned at SERVICE_POST_PRICE
    // (0) — the DB holds it there too, so there is no path that prices one.
    const price = isService
      ? SERVICE_POST_PRICE
      : items.length > 0
        ? minAvailablePrice(items)!
        : parseFloat(form.price);
    if (Number.isNaN(price) || price < 0) {
      toast.error('Enter a valid price');
      return false;
    }
    const unmetServiceDetail = isService ? firstUnmetServiceDetail(form) : null;
    if (unmetServiceDetail) {
      toast.error(
        unmetServiceDetail === 'pastDate'
          ? 'Pick a date that has not passed'
          : unmetServiceDetail === 'notesLength'
            ? 'Shorten the note a little'
            : 'Pick what kind of help this is'
      );
      return false;
    }
    const paymentMethods = form.payment_methods ?? [];
    // Rent is not settled through a marketplace handoff, so a sublease is not
    // asked for payment methods and must not be rejected for having none.
    if (!isSublease && !isService && paymentMethods.length === 0) {
      toast.error('Select at least one payment method');
      return false;
    }

    try {
      const imageUrls: string[] = [];
      // Map reordered gallery (imageFiles) to URLs in display order
      const files = form.imageFiles?.length ? form.imageFiles : (form.imageFile ? [form.imageFile] : []);
      for (const file of files) {
        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
        const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('marketplace-images')
          .upload(path, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: file.type || (ext === 'png' ? 'image/png' : 'image/jpeg'),
          });
        if (uploadErr) throw uploadErr;
        const { data: urlData } = supabase.storage
          .from('marketplace-images')
          .getPublicUrl(path);
        imageUrls.push(urlData.publicUrl);
      }
      const userProvidedUrl = form.imageUrl ? safeImageSrc(form.imageUrl) : null;
      const finalUrls = imageUrls.length > 0 ? imageUrls : (userProvidedUrl ? [userProvidedUrl] : []);

      const igHandle = sanitizeOptional(form.instagram_handle);
      const scHandle = sanitizeOptional(form.snapchat_handle);
      const phone = sanitizeOptional(form.phone_number);

      const { data: inserted, error } = await supabase
        .from('marketplace_listings')
        .insert({
          user_id: userId,
          title,
          description: sanitizeOptional(form.description),
          price,
          category: form.category,
          image_urls: finalUrls,
          // Pre-publish gate: land hidden, then moderate-listing flips it to
          // 'available' (approved) or leaves it 'under_review' (held/rejected).
          // The feed only shows available|pending, so it never surfaces early.
          status: 'pending_review',
          condition: sanitizeOptional(form.condition),
          // Item-shaped handoff fields, dropped for a service post. The composer
          // stops rendering them (schema.showsHandoffDetails), but a draft saved
          // in the item flow and reopened as a Request Help still carries the
          // values — and NO PAYMENTS means a service row must not carry a
          // negotiable-price marker even invisibly.
          meetup_location: isService ? null : sanitizeOptional(form.meetup_location),
          show_instagram: form.show_instagram ?? false,
          show_snapchat: form.show_snapchat ?? false,
          show_phone: form.show_phone ?? false,
          price_negotiable: isService ? false : (form.price_negotiable ?? false),
          payment_methods: paymentMethods,
          instagram_handle: igHandle || null,
          snapchat_handle: scHandle || null,
          phone_number: phone || null,
          // The real discriminator (migration 20260910000000). Always written,
          // so an item row is explicit rather than relying on the column
          // default; a trigger mirrors it onto the legacy is_sublease boolean.
          post_type: form.post_type ?? 'item',
          is_sublease: isSublease,
          // Structured sublease terms. All null for an item, which is exactly
          // what the column defaults already were.
          ...(isSublease
            ? {
                sublease_start: form.sublease_start || null,
                sublease_end: form.sublease_end || null,
                // The ADDRESS the student typed — sanitized like any other user
                // prose, and written because subleaseTitle() copies it into
                // `title`. `building_id` rides along only when they took an
                // autocomplete suggestion; nothing downstream requires it.
                building_id: form.building_id || null,
                building_name: sanitizeOptional(form.building_name) || null,
                // Geocoded from that address by the composer before this call.
                // A sublease reaches here only with coordinates: the composer
                // refuses the post when `geocodeSubleaseAddress()` returns null,
                // which is what keeps an implausible match — a Pittsburgh street
                // resolving to Lancashire, England — out of the table entirely.
                latitude: form.latitude ?? null,
                longitude: form.longitude ?? null,
                included_utilities: form.included_utilities ?? [],
                is_furnished: form.is_furnished ?? false,
                has_parking: form.has_parking ?? false,
                gender_preference: form.gender_preference || 'any',
                // The only free text on a sublease — sanitized like any other
                // user prose, and rendered last by every surface that shows it.
                house_rules: sanitizeOptional(form.house_rules) || null,
                additional_rules: sanitizeOptional(form.additional_rules) || null,
              }
            : {}),
          // Structured service terms + the pinned zero price. Empty object for
          // every non-service type, which the shape CHECK requires.
          ...serviceInsertColumns(form.post_type ?? 'item', form),
        })
        .select('id')
        .single();

      if (error) throw error;

      if (items.length > 0) {
        const { error: itemsError } = await supabase
          .from('marketplace_listing_items')
          .insert(items.map(item => ({
            listing_id: inserted.id,
            name: sanitizeText(item.name),
            price: item.price,
            status: item.status,
            x: item.x,
            y: item.y,
            photo_index: item.photo_index,
          })));
        if (itemsError) {
          // Best-effort rollback so a half-created listing doesn't linger.
          await supabase.from('marketplace_listings').delete().eq('id', inserted.id).eq('user_id', userId);
          throw itemsError;
        }
      }

      // Pre-publish auto-moderation: fire the gate now that the listing (and its
      // items) exist.
      const decision = await requestModerationVerdict(inserted.id);

      // Profile sync: if user typed new handles different from profile, upsert to profiles
      const { data: profile } = await supabase
        .from('profiles')
        .select('instagram_username, snapchat_username, phone_number')
        .eq('id', userId)
        .maybeSingle();
      const updates: Record<string, string | null> = {};
      if (igHandle && (profile?.instagram_username ?? '').trim() !== igHandle) {
        updates.instagram_username = igHandle;
      }
      if (scHandle && (profile?.snapchat_username ?? '').trim() !== scHandle) {
        updates.snapchat_username = scHandle;
      }
      if (phone && (profile?.phone_number ?? '').trim() !== phone) {
        updates.phone_number = phone;
      }
      if (Object.keys(updates).length > 0) {
        await supabase.from('profiles').upsert({ id: userId, ...updates }, { onConflict: 'id' });
      }

      await trackAction('listing_created', {
        listing_id: inserted.id,
        category: form.category,
        price,
        item_count: items.length,
        image_count: finalUrls.length,
      });
      if (isListingLiveAfterModeration(decision)) {
        toast.success('Listing posted');
      } else {
        // Held/rejected or no verdict yet: submitted, awaiting review. Framed as
        // success (it posted) - never as an error implying the post failed.
        toast.success('Submitted for review', {
          description: "We're checking your listing - it'll go live once it clears.",
        });
      }
      haptic.light();
      await fetchListings();
      await queryClient.invalidateQueries({ queryKey: ['marketplace_listings'] });
      onSuccess?.();
      return true;
    } catch (e) {
      const err = e as { code?: string; message?: string; details?: string; hint?: string };
      console.error('Create listing error:', e);
      console.error('Supabase error details:', { message: err?.message, details: err?.details, hint: err?.hint });
      if (typeof err?.message === 'string' && /column\s+["']?image_urls["']?\s+does not exist/i.test(err.message)) {
        console.error('The image_urls column is missing on marketplace_listings. Re-run the migration: supabase/migrations/20260216000001_marketplace_listings_image_urls.sql');
      }
      console.error('Supabase Insert Error:', e);
      toast.error('Unable to create listing', { description: err?.message || 'Unknown error occurred' });
      return false;
    }
  };

  const updateListing = async (
    id: string,
    form: ListingForm,
    onSuccess?: () => void
  ): Promise<boolean> => {
    if (!userId) return false;
    const title = sanitizeText(form.title);
    if (!title) {
      toast.error('Enter a title');
      return false;
    }
    const items = form.items ?? [];
    const itemError = validateItems(items);
    if (itemError) {
      toast.error(itemError);
      return false;
    }
    const price = items.length > 0 ? minAvailablePrice(items)! : parseFloat(form.price);
    if (Number.isNaN(price) || price < 0) {
      toast.error('Enter a valid price');
      return false;
    }
    // A sublease has no payment methods and never did: rent is not settled
    // through a marketplace handoff, and `POST_TYPE_SCHEMAS.sublease` sets
    // `requiresPaymentMethods: false` on the create path for the same reason.
    // Without this branch the edit path refused every sublease save.
    const isSublease = form.post_type === 'sublease';
    const paymentMethods = form.payment_methods ?? [];
    if (!isSublease && paymentMethods.length === 0) {
      toast.error('Select at least one payment method');
      return false;
    }

    try {
      const imageUrls: string[] = [];
      // Map reordered gallery (listingImages or imageFiles) to URLs in display order.
      // Named galleryItems so it can't shadow the listing `items` above (the child
      // rows) - shadowing here once silently wiped items on every update.
      const galleryItems = form.listingImages?.length
        ? form.listingImages
        : (form.imageFiles?.length ? form.imageFiles.map((f) => ({ type: 'file' as const, file: f })) : form.imageFile ? [{ type: 'file' as const, file: form.imageFile }] : []);
      for (const item of galleryItems) {
        if (item.type === 'url') {
          const safe = safeImageSrc(item.url);
          if (safe) imageUrls.push(safe);
        } else {
          const file = item.file;
          const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
          const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const { error: uploadErr } = await supabase.storage
            .from('marketplace-images')
            .upload(path, file, {
              cacheControl: '3600',
              upsert: false,
              contentType: file.type || (ext === 'png' ? 'image/png' : 'image/jpeg'),
            });
          if (uploadErr) throw uploadErr;
          const { data: urlData } = supabase.storage
            .from('marketplace-images')
            .getPublicUrl(path);
          imageUrls.push(urlData.publicUrl);
        }
      }
      const userProvidedUrl = form.imageUrl ? safeImageSrc(form.imageUrl) : null;
      const finalUrls = imageUrls.length > 0 ? imageUrls : (userProvidedUrl ? [userProvidedUrl] : []);
      const igHandle = sanitizeOptional(form.instagram_handle);
      const scHandle = sanitizeOptional(form.snapchat_handle);
      const phone = sanitizeOptional(form.phone_number);

      const { data: updatedRow, error } = await supabase
        .from('marketplace_listings')
        .update({
          title,
          description: sanitizeOptional(form.description),
          price,
          category: form.category,
          image_urls: finalUrls,
          condition: sanitizeOptional(form.condition),
          meetup_location: sanitizeOptional(form.meetup_location),
          show_instagram: form.show_instagram ?? false,
          show_snapchat: form.show_snapchat ?? false,
          show_phone: form.show_phone ?? false,
          price_negotiable: form.price_negotiable ?? false,
          payment_methods: paymentMethods,
          instagram_handle: igHandle || null,
          snapchat_handle: scHandle || null,
          phone_number: phone || null,
          // Sublease terms, and ONLY on a sublease — spreading them
          // unconditionally would write six nulls over every item edit.
          //
          // `latitude`/`longitude` are in here because an edited address has to
          // move the pin. The create path geocoding and the edit path not
          // geocoding is the failure this restores from: it leaves a listing
          // advertising one address and pinned at another, which is worse than
          // either being wrong on its own. The caller re-geocodes before calling
          // and refuses the save on a null, exactly as the composer does.
          ...(isSublease
            ? {
                building_id: form.building_id || null,
                building_name: sanitizeOptional(form.building_name) || null,
                latitude: form.latitude ?? null,
                longitude: form.longitude ?? null,
                sublease_start: form.sublease_start || null,
                sublease_end: form.sublease_end || null,
                included_utilities: form.included_utilities ?? [],
                is_furnished: form.is_furnished ?? false,
                has_parking: form.has_parking ?? false,
                gender_preference: form.gender_preference || 'any',
                house_rules: sanitizeOptional(form.house_rules) || null,
                additional_rules: sanitizeOptional(form.additional_rules) || null,
              }
            : {}),
        })
        .eq('id', id)
        .eq('user_id', userId)
        // The status that LANDED, not the one we sent: a changed photo, title,
        // description or category sends a live listing back to 'pending_review'
        // server-side (rescreen_listing_on_edit, 20261011000000).
        .select('status')
        .maybeSingle();

      if (error) throw error;
      const landedStatus = (updatedRow as { status?: string } | null)?.status;

      // Diff-upsert child items by id (never delete-and-reinsert, which would
      // wipe per-item sold status).
      const { data: existingItems, error: existingErr } = await supabase
        .from('marketplace_listing_items')
        .select('id')
        .eq('listing_id', id);
      if (existingErr) throw existingErr;
      const keptIds = new Set(items.filter(i => i.id).map(i => i.id as string));
      const removedIds = (existingItems ?? []).map(r => r.id).filter(existingId => !keptIds.has(existingId));

      if (removedIds.length > 0) {
        const { error: delErr } = await supabase
          .from('marketplace_listing_items')
          .delete()
          .in('id', removedIds);
        if (delErr) throw delErr;
      }
      for (const item of items.filter(i => i.id)) {
        const { error: updErr } = await supabase
          .from('marketplace_listing_items')
          .update({
            name: sanitizeText(item.name),
            price: item.price,
            status: item.status,
            x: item.x,
            y: item.y,
            photo_index: item.photo_index,
          })
          .eq('id', item.id as string)
          .eq('listing_id', id);
        if (updErr) throw updErr;
      }
      const newItems = items.filter(i => !i.id);
      if (newItems.length > 0) {
        const { error: insErr } = await supabase
          .from('marketplace_listing_items')
          .insert(newItems.map(item => ({
            listing_id: id,
            name: sanitizeText(item.name),
            price: item.price,
            status: item.status,
            x: item.x,
            y: item.y,
            photo_index: item.photo_index,
          })));
        if (insErr) throw insErr;
      }

      // Profile sync: if user typed new handles different from profile, upsert to profiles
      const { data: profile } = await supabase
        .from('profiles')
        .select('instagram_username, snapchat_username, phone_number')
        .eq('id', userId)
        .maybeSingle();
      const updates: Record<string, string | null> = {};
      if (igHandle && (profile?.instagram_username ?? '').trim() !== igHandle) {
        updates.instagram_username = igHandle;
      }
      if (scHandle && (profile?.snapchat_username ?? '').trim() !== scHandle) {
        updates.snapchat_username = scHandle;
      }
      if (phone && (profile?.phone_number ?? '').trim() !== phone) {
        updates.phone_number = phone;
      }
      if (Object.keys(updates).length > 0) {
        await supabase.from('profiles').upsert({ id: userId, ...updates }, { onConflict: 'id' });
      }

      // Item names are screened too: an added or renamed item sends a live
      // listing back to review server-side (rescreen_listing_on_item_change,
      // 20261012000000) AFTER the parent update above returned its status, so
      // read the status the row ended on. A failed read falls back to what the
      // parent update reported; the edit is saved either way.
      const { data: finalRow } = await supabase
        .from('marketplace_listings')
        .select('status')
        .eq('id', id)
        .maybeSingle();
      const finalStatus = (finalRow as { status?: string } | null)?.status ?? landedStatus;

      // A screened change put the listing back in review: run the same gate the
      // create flow runs, now that the row and its items are final.
      const decision: ModerationDecision = finalStatus === 'pending_review'
        ? await requestModerationVerdict(id)
        : 'approve';
      if (isListingLiveAfterModeration(decision)) {
        toast.success('Listing updated');
      } else {
        toast.success('Changes submitted for review', {
          description: "We're checking your edit - your listing will show again once it clears.",
        });
      }
      await fetchListings();
      await queryClient.invalidateQueries({ queryKey: ['marketplace_listings'] });
      onSuccess?.();
      return true;
    } catch (e) {
      const err = e as { code?: string; message?: string; details?: string; hint?: string };
      console.error('Update listing error:', e);
      console.error('Supabase error details:', { message: err?.message, details: err?.details, hint: err?.hint });
      if (typeof err?.message === 'string' && /column\s+["']?image_urls["']?\s+does not exist/i.test(err.message)) {
        console.error('The image_urls column is missing on marketplace_listings. Re-run the migration: supabase/migrations/20260216000001_marketplace_listings_image_urls.sql');
      }
      // rescreen_listing_on_edit refuses screened edits on a sold/pending/expired
      // listing (re-screening would silently un-sell it). Its message is written
      // for the student, so show it rather than the generic failure.
      if (err?.code === '23514' && typeof err.message === 'string' && err.message.startsWith('Relist this listing')) {
        toast.error(err.message);
        return false;
      }
      toast.error('Unable to update listing. Please try again.');
      return false;
    }
  };

  const deleteListing = async (id: string, onSuccess?: () => void): Promise<boolean> => {
    if (!userId) return false;
    try {
      const { error } = await supabase
        .from('marketplace_listings')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;
      toast.success('Listing deleted');
      await fetchListings();
      onSuccess?.();
      return true;
    } catch (e) {
      console.error('Delete listing error:', e);
      toast.error('Unable to delete listing. Please try again.');
      return false;
    }
  };

  /**
   * Toggle one item of a multi-item listing, then derive the parent row:
   * all items sold -> listing 'sold'; any item relisted -> listing 'available';
   * price is always recomputed as the min available item price ("From $X").
   * The parent write also keeps the existing marketplace_listings realtime
   * channel + ['marketplace_listings'] invalidation sufficient.
   */
  const setItemStatus = async (
    itemId: string,
    listingId: string,
    status: 'available' | 'sold',
    onSuccess?: () => void
  ): Promise<boolean> => {
    if (!userId) return false;
    try {
      const { error } = await supabase
        .from('marketplace_listing_items')
        .update({ status })
        .eq('id', itemId)
        .eq('listing_id', listingId);
      if (error) throw error;

      const { data: siblings, error: sibErr } = await supabase
        .from('marketplace_listing_items')
        .select('id, price, status')
        .eq('listing_id', listingId);
      if (sibErr) throw sibErr;

      const itemRows = (siblings ?? []) as Pick<MarketplaceListingItem, 'id' | 'price' | 'status'>[];
      const derivedStatus = allItemsSold(itemRows) ? 'sold' : 'available';
      const derivedPrice = minAvailablePrice(itemRows);
      const parentUpdate: { status: string; price?: number } = { status: derivedStatus };
      if (derivedPrice !== null) parentUpdate.price = derivedPrice;

      const { error: parentErr } = await supabase
        .from('marketplace_listings')
        .update(parentUpdate)
        .eq('id', listingId)
        .eq('user_id', userId);
      if (parentErr) throw parentErr;

      if (status === 'sold') {
        await trackAction('handoff_completed', { listing_id: listingId, item_id: itemId, scope: 'item' });
        if (derivedStatus === 'sold') {
          // Last item just sold - the whole listing is handed off.
          await trackAction('handoff_completed', { listing_id: listingId, scope: 'listing' });
        }
      }
      toast.success(status === 'sold' ? 'Item marked as sold' : 'Item relisted');
      await fetchListings();
      await queryClient.invalidateQueries({ queryKey: ['marketplace_listings'] });
      onSuccess?.();
      return true;
    } catch (e) {
      console.error('Set item status error:', e);
      toast.error(status === 'sold' ? 'Unable to mark item as sold. Please try again.' : 'Unable to relist item. Please try again.');
      return false;
    }
  };

  const markItemSold = (itemId: string, listingId: string, onSuccess?: () => void) =>
    setItemStatus(itemId, listingId, 'sold', onSuccess);

  const relistItem = (itemId: string, listingId: string, onSuccess?: () => void) =>
    setItemStatus(itemId, listingId, 'available', onSuccess);

  const markAsSold = async (id: string, onSuccess?: () => void): Promise<boolean> => {
    if (!userId) return false;
    try {
      const { error } = await supabase
        .from('marketplace_listings')
        .update({ status: 'sold' })
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;
      // Bulk semantics: selling the listing sells every item in it.
      const { error: itemsErr } = await supabase
        .from('marketplace_listing_items')
        .update({ status: 'sold' })
        .eq('listing_id', id);
      if (itemsErr) throw itemsErr;
      await trackAction('handoff_completed', { listing_id: id, scope: 'listing' });
      toast.success('Listing marked as sold');
      await fetchListings();
      await queryClient.invalidateQueries({ queryKey: ['marketplace_listings'] });
      onSuccess?.();
      return true;
    } catch (e) {
      console.error('Mark as sold error:', e);
      toast.error('Unable to mark as sold. Please try again.');
      return false;
    }
  };

  /**
   * Seller promised the item to a buyer but the handoff hasn't happened yet.
   * Items are untouched (unlike sold, which bulk-sells them); the feed keeps
   * showing the listing with a Pending badge. Requires the 'pending' status
   * CHECK (migration 20260731030000).
   */
  const markAsPending = async (id: string, onSuccess?: () => void): Promise<boolean> => {
    if (!userId) return false;
    try {
      const { error } = await supabase
        .from('marketplace_listings')
        .update({ status: 'pending' })
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;
      toast.success('Listing marked as pending');
      await fetchListings();
      await queryClient.invalidateQueries({ queryKey: ['marketplace_listings'] });
      onSuccess?.();
      return true;
    } catch (e) {
      console.error('Mark as pending error:', e);
      toast.error('Unable to mark as pending. Please try again.');
      return false;
    }
  };

  const relistListing = async (id: string, onSuccess?: () => void): Promise<boolean> => {
    if (!userId) return false;
    try {
      const { error } = await supabase
        .from('marketplace_listings')
        .update({ status: 'available' })
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;
      // Bulk semantics: relisting the listing relists every item in it.
      const { error: itemsErr } = await supabase
        .from('marketplace_listing_items')
        .update({ status: 'available' })
        .eq('listing_id', id);
      if (itemsErr) throw itemsErr;
      toast.success('Listing relisted');
      await fetchListings();
      await queryClient.invalidateQueries({ queryKey: ['marketplace_listings'] });
      onSuccess?.();
      return true;
    } catch (e) {
      console.error('Relist error:', e);
      toast.error('Unable to relist. Please try again.');
      return false;
    }
  };

  return {
    listings,
    isLoading,
    refetch: fetchListings,
    createListing,
    updateListing,
    deleteListing,
    markAsSold,
    markAsPending,
    relistListing,
    markItemSold,
    relistItem,
  };
}
