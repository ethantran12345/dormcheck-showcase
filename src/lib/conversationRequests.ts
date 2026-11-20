import { supabase } from '@/integrations/supabase/client';
import { apiPost } from '@/lib/apiPost';

export async function acceptConversationRequest(conversationId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('conversations')
    .update({ status: 'accepted', last_message: null })
    .eq('id', conversationId);
  if (error) {
    console.error('[conversationRequests] accept failed:', error);
    return { error: error.message };
  }
  void apiPost('/api/notify-message-request-accepted', { conversationId }).catch((e) => console.warn('[conversationRequests] notify failed:', e));
  return { error: null };
}

export async function declineConversationRequest(conversationId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('conversations').delete().eq('id', conversationId);
  if (error) {
    console.error('[conversationRequests] decline failed:', error);
    return { error: error.message };
  }
  return { error: null };
}
