import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { apiPost } from '@/lib/apiPost';
import { trackEventImmediate } from '@/lib/analytics';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { useChat } from '@/contexts/ChatContext';
import type { MarketplaceListing } from '@/types/marketplace';

const DM_DIVIDER = '━━━━━━━━━━━━━━━';

function listingContextMarker(listingId: string): string {
  return `[Dormcheck:listing:${listingId}]`;
}

function buildBuySellListingDmCard(listing: MarketplaceListing, itemName?: string): string {
  const rawDesc = listing.description?.trim();
  const descSnippet =
    rawDesc && rawDesc.length > 0
      ? rawDesc.length > 120
        ? `${rawDesc.slice(0, 120)}...`
        : rawDesc
      : '';
  const metaLines = [
    listing.price != null ? `💰 $${listing.price}` : '',
    listing.category ? `📦 ${listing.category}` : '',
    listing.status === 'sold' ? '❌ Sold' : '✅ Available',
  ]
    .filter(Boolean)
    .join('\n');

  return [
    itemName
      ? `Hey! I'm interested in "${itemName}" from your listing:`
      : `Hey! I'm reaching out about your listing:`,
    ``,
    DM_DIVIDER,
    `🛒 ${listing.title}`,
    descSnippet,
    ``,
    metaLines,
    DM_DIVIDER,
  ]
    .filter((line) => line !== undefined && line !== '')
    .join('\n');
}

export function useMessageSeller() {
  const { user, isAdmin } = useAuth();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { openChatWithConversation, primeKeyboard } = useChat();

  const handleMessageSeller = useCallback(
    async (listing: MarketplaceListing, itemName?: string) => {
      if (!user) {
        toast('Please sign in to message the seller');
        navigate('/auth');
        return;
      }
      if (listing.user_id === user.id) {
        toast.error("You can't message yourself");
        return;
      }

      // In-gesture: raise the iOS keyboard now so it stays up through the async lookup + nav.
      primeKeyboard();

      const me = user.id;
      const them = listing.user_id;
      const { data: existingRows } = await supabase
        .from('conversations')
        .select('id')
        .or(
          `and(participant_1.eq.${me},participant_2.eq.${them}),and(participant_1.eq.${them},participant_2.eq.${me})`
        )
        .limit(1);

      const existing = existingRows?.[0];
      const conversationAlreadyExisted = Boolean(existing?.id);
      let conversationId = existing?.id;

      if (!conversationId) {
        const p1 = me < them ? me : them;
        const p2 = me < them ? them : me;
        const { data: created, error } = await supabase
          .from('conversations')
          .insert({ participant_1: p1, participant_2: p2, initiated_by: me, status: 'pending' })
          .select('id')
          .single();
        if (error || !created?.id) {
          console.error('Create conversation error:', error);
          toast.error('Could not start conversation');
          return;
        }
        conversationId = created.id;
      }

      const marker = listingContextMarker(listing.id);
      let shouldInsertContext = true;
      if (conversationAlreadyExisted) {
        const { data: priorContextRows } = await supabase
          .from('messages')
          .select('id')
          .eq('conversation_id', conversationId)
          .or(
            `content.ilike.%${marker}%,content.ilike.%[Dormcheck:listing:${listing.id}]%`
          )
          .limit(1);
        shouldInsertContext = !priorContextRows?.length;
      }

      const contextBody = buildBuySellListingDmCard(listing, itemName);
      const contextMessage = `${contextBody}\n\n${marker}`;

      if (shouldInsertContext) {
        try {
          const { error: msgError } = await supabase.from('messages').insert({
            conversation_id: conversationId,
            sender_id: me,
            content: contextMessage,
          });
          if (msgError) throw msgError;
          // Awaited (not debounced): the mobile path navigates right after,
          // which would unmount and drop a debounced useAnalytics timer.
          await trackEventImmediate(me, isAdmin, 'message_sent', {
            conversation_id: conversationId,
            first_in_conversation: !conversationAlreadyExisted,
            listing_context: true,
            listing_id: listing.id,
            source: 'message_seller',
          });
          if (!isAdmin) {
            void apiPost('/api/notify-message-request', { conversationId }).catch(() => {});
          }
        } catch (e) {
          console.warn('[useMessageSeller] send listing context failed:', e);
        }
        void apiPost('/api/notify-marketplace-inquiry', { listingId: listing.id }).catch(() => {});
      }

      if (isMobile) {
        navigate(`/messages?conversation=${encodeURIComponent(conversationId)}`);
      } else {
        openChatWithConversation(conversationId);
      }
    },
    [user, isAdmin, isMobile, navigate, openChatWithConversation, primeKeyboard]
  );

  return { handleMessageSeller };
}
