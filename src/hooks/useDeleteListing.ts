import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { haptic } from '@/lib/haptics';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSetupMode } from '@/contexts/SetupModeContext';
import type { MarketplaceListing } from '@/types/marketplace';

export function useDeleteListing() {
  const { user, isAdmin } = useAuth();
  const { setupModeEnabled } = useSetupMode();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [deletingListingId, setDeletingListingId] = useState<string | null>(null);

  const handleDeleteListing = useCallback(
    async (listing: MarketplaceListing) => {
      if (!user) {
        toast('Please sign in to manage your listings');
        navigate('/auth');
        return;
      }

      const isOwnListing = listing.user_id === user.id;
      const canAdminDelete = setupModeEnabled && isAdmin;
      if (!isOwnListing && !canAdminDelete) {
        toast.error('You can only delete your own listings');
        return;
      }

      const confirmed = window.confirm('Delete this listing?');
      if (!confirmed) return;

      haptic.medium();
      setDeletingListingId(listing.id);
      try {
        const deleteQuery = supabase
          .from('marketplace_listings')
          .delete()
          .eq('id', listing.id);
        if (!canAdminDelete) {
          deleteQuery.eq('user_id', user.id);
        }
        const { error } = await deleteQuery;
        if (error) {
          console.error('Delete listing error:', error);
          toast.error('Unable to delete listing. Please try again.');
          return;
        }
        toast.success('Listing deleted');

        // Best-effort: purge the listing's images from storage so a deleted
        // listing doesn't orphan objects in the marketplace-images bucket.
        const imagePaths = (listing.image_urls ?? [])
          .map((url) => {
            try {
              const marker = '/marketplace-images/';
              const path = new URL(url).pathname;
              const idx = path.indexOf(marker);
              return idx === -1 ? null : path.substring(idx + marker.length);
            } catch {
              return null;
            }
          })
          .filter((p): p is string => Boolean(p));
        if (imagePaths.length > 0) {
          const { error: storageError } = await supabase.storage
            .from('marketplace-images')
            .remove(imagePaths);
          if (storageError) {
            console.error('Failed to delete listing images from storage:', storageError);
          }
        }

        await queryClient.invalidateQueries({ queryKey: ['marketplace_listings'] });
      } catch (err) {
        console.error('Unexpected error deleting listing:', err);
        toast.error('Something went wrong while deleting this listing.');
      } finally {
        setDeletingListingId(null);
      }
    },
    [user, isAdmin, setupModeEnabled, queryClient, navigate]
  );

  return { deletingListingId, handleDeleteListing };
}
