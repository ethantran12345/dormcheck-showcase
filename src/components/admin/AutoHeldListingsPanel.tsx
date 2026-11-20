import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, ShieldAlert, CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { logAdminAction } from '@/lib/adminAudit';
import { apiPost } from '@/lib/apiPost';
import { safeImageSrc } from '@/lib/sanitize';
import {
  discardHeldListingImages,
  releaseHeldListingImages,
  signHeldListingImages,
} from '@/lib/heldListingImages';

/**
 * Admin "Auto-held" panel: the small set of marketplace listings the pre-publish
 * auto-moderator could not clear (status='under_review' + moderation_decision
 * in held|rejected). Backed by admin_list_held_listings (SECURITY DEFINER,
 * admin-only, university-clamped for non-superadmins - migration 20260719150000).
 *
 * Actions route through the same owner-or-admin UPDATE path the Reports Queue
 * uses (migration 20260709044443 - admins bypass guard_listing_status_change),
 * so the admin_audit_log still records the moderation:
 *   Approve       -> status 'available'  (goes live; leaves the queue)
 *   Reject/Remove -> status 'expired' + moderation_decision 'rejected'
 *                    (stays hidden from the feed, leaves the queue, row kept for audit)
 *
 * Photos (A2, 20261013000000): a held or rejected listing's photos live in the
 * private images-held bucket, so the cover is a short-lived signed URL from the
 * held-listing-images function. Approve RELEASES them back to their public paths
 * first and does not approve if that fails; Remove discards them afterwards.
 */

interface HeldListing {
  listing_id: string;
  title: string | null;
  price: number | null;
  image_urls: string[] | null;
  owner_id: string;
  owner_name: string | null;
  moderation_decision: 'held' | 'rejected' | null;
  moderation_reason: string | null;
  moderation_categories: string[] | null;
  moderated_at: string | null;
  created_at: string | null;
}

const HELD_LISTINGS_KEY = 'admin-auto-held-listings';
const HELD_IMAGES_KEY = 'admin-held-listing-images';
// Signed URLs live 300s (HELD_SIGNED_URL_TTL_SECONDS); refetch well before that.
const SIGNED_URL_STALE_MS = 4 * 60_000;

function HeldCover({ listing, enabled }: { listing: HeldListing; enabled: boolean }) {
  const signed = useQuery({
    queryKey: [HELD_IMAGES_KEY, listing.listing_id],
    queryFn: () => signHeldListingImages(listing.listing_id),
    enabled,
    staleTime: SIGNED_URL_STALE_MS,
    gcTime: SIGNED_URL_STALE_MS,
    refetchInterval: SIGNED_URL_STALE_MS,
    retry: false,
  });
  // A listing held before photos moved privately still has its public URL.
  const src =
    safeImageSrc(signed.data?.[0]?.url ?? '') ||
    (signed.isSuccess && listing.image_urls?.[0] ? safeImageSrc(listing.image_urls[0]) : null);
  return src ? (
    <img src={src} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
  ) : (
    <div className="h-16 w-16 shrink-0 rounded-lg bg-stone-100" aria-hidden />
  );
}

function formatPrice(value: number | null): string {
  if (value == null) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function AutoHeldListingsPanel({
  siloUniversityId,
  enabled,
  universityId,
}: {
  /** Superadmin silo filter passed to the RPC; null lets the RPC clamp by role. */
  siloUniversityId: string | null;
  enabled: boolean;
  universityId: string | null;
}) {
  const queryClient = useQueryClient();
  const [actioningId, setActioningId] = useState<string | null>(null);

  const heldQuery = useQuery({
    queryKey: [HELD_LISTINGS_KEY, siloUniversityId],
    queryFn: async (): Promise<HeldListing[]> => {
      // admin_list_held_listings: SECURITY DEFINER, admin-only (migration 20260719150000).
      const { data, error } = await supabase.rpc('admin_list_held_listings', {
        p_university_id: siloUniversityId,
      });
      if (error) throw error;
      return (data ?? []) as HeldListing[];
    },
    enabled,
    staleTime: 15_000,
  });

  const actionMutation = useMutation({
    mutationFn: async ({
      listing,
      action,
    }: {
      listing: HeldListing;
      action: 'approve' | 'reject';
    }): Promise<void> => {
      // Photos first: a listing must never go live with its photos still private.
      if (action === 'approve') await releaseHeldListingImages(listing.listing_id);
      const patch =
        action === 'approve'
          ? { status: 'available', moderation_decision: 'approved' }
          : { status: 'expired', moderation_decision: 'rejected' };
      // .select() so an RLS zero-row no-op surfaces as an error, not a false success
      // (relies on the owner-or-admin UPDATE policy, migration 20260709044443).
      const { data: updated, error } = await supabase
        .from('marketplace_listings')
        .update(patch)
        .eq('id', listing.listing_id)
        .select('id');
      if (error) throw error;
      if (!updated || updated.length === 0) {
        throw new Error('Listing was not updated (missing admin permission or already actioned).');
      }
      if (action === 'reject') await discardHeldListingImages(listing.listing_id);
      await logAdminAction(
        action === 'approve' ? 'restore_listing' : 'delete_content',
        'marketplace_listing',
        listing.listing_id,
        universityId,
      );
      // Seller-trust email, fire-and-forget (the moderation write already landed).
      void apiPost('/api/notify-listing-status', {
        listingId: listing.listing_id,
        action: action === 'approve' ? 'approved' : 'rejected',
      }).catch((err) => console.error('notify-listing-status failed', err));
    },
    onMutate: ({ listing }) => setActioningId(listing.listing_id),
    onSettled: () => {
      setActioningId(null);
      void queryClient.invalidateQueries({ queryKey: [HELD_LISTINGS_KEY] });
    },
    onSuccess: (_data, { action }) => {
      toast(action === 'approve' ? 'Listing approved' : 'Listing removed', {
        description:
          action === 'approve'
            ? 'It is now live in the marketplace.'
            : 'It stays hidden from the feed.',
      });
    },
    onError: (e: Error) => {
      toast.error('Could not update listing', { description: e.message });
    },
  });

  if (heldQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-stone-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
        Loading auto-held listings…
      </div>
    );
  }

  if (heldQuery.error) {
    return (
      <div className="m-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Could not load auto-held listings: {(heldQuery.error as Error).message}
      </div>
    );
  }

  const listings = heldQuery.data ?? [];

  if (listings.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-16 text-center text-stone-500">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-stone-100">
          <ShieldAlert className="h-6 w-6 text-stone-400" aria-hidden />
        </div>
        <p className="font-medium text-stone-700">Nothing held</p>
        <p className="mt-1 max-w-xs text-sm">
          The auto-moderator is clearing the marketplace. Listings it can't resolve show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <ul className="mx-auto flex max-w-3xl flex-col gap-3">
        {listings.map((listing) => {
          const busy = actioningId === listing.listing_id && actionMutation.isPending;
          return (
            <li
              key={listing.listing_id}
              className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-3 shadow-raised sm:flex-row"
            >
              <div className="flex min-w-0 flex-1 gap-3">
                <HeldCover listing={listing} enabled={enabled} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium text-stone-900">
                      {listing.title || 'Untitled listing'}
                    </p>
                    <span className="text-sm font-semibold text-stone-600">
                      {formatPrice(listing.price)}
                    </span>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                        listing.moderation_decision === 'rejected'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-amber-100 text-amber-800',
                      )}
                    >
                      {listing.moderation_decision === 'rejected' ? 'Auto-rejected' : 'Auto-held'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-stone-500">
                    {listing.owner_name || listing.owner_id.slice(0, 8)}
                  </p>
                  {listing.moderation_reason?.trim() && (
                    <p className="mt-1 text-sm text-stone-700">{listing.moderation_reason.trim()}</p>
                  )}
                  {listing.moderation_categories && listing.moderation_categories.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {listing.moderation_categories.map((cat) => (
                        <span
                          key={cat}
                          className="inline-flex items-center rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600"
                        >
                          {cat}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-2 sm:flex-col sm:justify-center">
                <Button
                  size="sm"
                  className="gap-1.5 bg-malachite-800 text-white hover:bg-malachite-900"
                  disabled={busy}
                  onClick={() => actionMutation.mutate({ listing, action: 'approve' })}
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-red-700 hover:text-red-800"
                  disabled={busy}
                  onClick={() => actionMutation.mutate({ listing, action: 'reject' })}
                >
                  <XCircle className="h-3.5 w-3.5" aria-hidden />
                  Remove
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
