import { supabase } from '@/integrations/supabase/client';
import { apiPost } from '@/lib/apiPost';

/**
 * Get existing conversation between two users, or create one with status = 'pending' and initiated_by = currentUserId.
 * Returns conversation id or null on error.
 */
export async function getOrCreateConversation(
  currentUserId: string,
  otherUserId: string,
  shouldNotify: boolean = true
): Promise<string | null> {
  if (currentUserId === otherUserId) return null;
  const me = currentUserId;
  const them = otherUserId;

  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .or(
      `and(participant_1.eq.${me},participant_2.eq.${them}),and(participant_1.eq.${them},participant_2.eq.${me})`
    )
    .limit(1);

  if (existing?.[0]?.id) return existing[0].id;

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
    console.error('[getOrCreateConversation] insert error:', error);
    return null;
  }
  const convId = created?.id ?? null;
  if (convId && shouldNotify) {
    void apiPost('/api/notify-message-request', { conversationId: convId }).catch((e) => console.warn('[getOrCreateConversation] notify-message-request failed:', e));
  }
  return convId;
}
