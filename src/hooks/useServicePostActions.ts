import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { haptic } from '@/lib/haptics';
import { useTranslation } from 'react-i18next';

/**
 * The two service-post transitions, open -> claimed -> completed.
 *
 * Both go through SECURITY DEFINER RPCs (`claim_service_post`,
 * `complete_service_post`, migration 20260910000000) rather than a PostgREST
 * UPDATE. RLS cannot restrict WHICH columns an update touches, so letting a
 * claimer write the row directly would have meant widening the owner-only
 * UPDATE policy far enough to hand every peer the title, price and contact
 * columns as well. The RPCs write three columns and re-check the tenant,
 * ownership and current status server-side — the client checks in
 * src/lib/servicePosts.ts only decide whether to render a button.
 *
 * NO PAYMENTS: neither transition moves, records or references money. Claiming
 * means "I will help"; completing means "this happened", and the only thing it
 * unlocks is the EXISTING seller rating.
 */
export function useServicePostActions() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const run = useCallback(
    async (
      fn: 'claim_service_post' | 'complete_service_post',
      listingId: string,
      successMessage: string,
      onDone?: () => void,
    ) => {
      setPendingId(listingId);
      try {
        const { error } = await supabase.rpc(fn, { p_listing_id: listingId });
        if (error) {
          // The RPC's RAISE messages are already written for a student ("This
          // post is no longer open."), so they are surfaced as-is rather than
          // flattened into a generic failure.
          toast.error(error.message);
          return false;
        }
        haptic.success();
        toast.success(successMessage);
        void queryClient.invalidateQueries({ queryKey: ['marketplace_listings'] });
        onDone?.();
        return true;
      } finally {
        setPendingId(null);
      }
    },
    [queryClient],
  );

  const claim = useCallback(
    (listingId: string, onDone?: () => void) =>
      run('claim_service_post', listingId, t('marketplace:service.claimedToast'), onDone),
    [run, t],
  );

  const complete = useCallback(
    (listingId: string, onDone?: () => void) =>
      run('complete_service_post', listingId, t('marketplace:service.completedToast'), onDone),
    [run, t],
  );

  return { claim, complete, pendingId };
}
