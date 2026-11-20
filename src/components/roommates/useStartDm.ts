import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { supabase } from '@/integrations/supabase/client';
import { useAdminUniversitySilo } from '@/contexts/AdminUniversityContext';
import { useChat } from '@/contexts/ChatContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from 'sonner';
import { apiPost } from '@/lib/apiPost';

export function useStartDm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { openChatWithConversation } = useChat();
  // View-as: admin DM affordances follow the previewed role.
  const { effectiveIsAdmin: isAdmin } = useAdminUniversitySilo();

  return useCallback(
    async (targetUserId: string, me: string) => {
      if (!targetUserId || targetUserId === me) return;
      const them = targetUserId;
      const { data: existingRows } = await supabase
        .from('conversations')
        .select('id')
        .or(
          `and(participant_1.eq.${me},participant_2.eq.${them}),and(participant_1.eq.${them},participant_2.eq.${me})`
        )
        .limit(1);
      const existing = existingRows?.[0];
      if (existing?.id) {
        if (isMobile) {
          navigate(`/messages?conversation=${encodeURIComponent(existing.id)}`);
        } else {
          openChatWithConversation(existing.id);
        }
        return;
      }
      const p1 = me < them ? me : them;
      const p2 = me < them ? them : me;
      const { data: created, error } = await supabase
        .from('conversations')
        .insert({
          participant_1: p1,
          participant_2: p2,
          initiated_by: me,
          status: 'pending',
        })
        .select('id')
        .single();
      if (error) {
        console.error('[FindingRoommates] create conversation', error);
        toast.error(t('roommates:finding.couldNotStartConversation'));
        return;
      }
      if (!isAdmin) {
        void apiPost('/api/notify-message-request', { conversationId: created.id }).catch((e) => console.warn('[FindingRoommates] notify-message-request', e));
      }
      if (isMobile) {
        navigate(`/messages?conversation=${encodeURIComponent(created.id)}`);
      } else {
        openChatWithConversation(created.id);
      }
    },
    [isAdmin, isMobile, navigate, openChatWithConversation, t]
  );
}
