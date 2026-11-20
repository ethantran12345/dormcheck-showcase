import { supabase } from '@/integrations/supabase/client';
import type { DmPollMessageMetadata } from '@/types/dmMessageMeta';

export type DmPollVote = {
  messageId: number;
  conversationId: string;
  userId: string;
  optionIndex: number;
};

/** Validate at the client boundary; RLS repeats the option-bound check on write. */
export function makeDmPoll(question: string, options: string[]): DmPollMessageMetadata {
  const cleanQuestion = question.trim();
  const cleanOptions = options.map((option) => option.trim()).filter(Boolean);
  if (!cleanQuestion) throw new Error('A poll needs a question.');
  if (cleanOptions.length < 2 || cleanOptions.length > 8) {
    throw new Error('A poll needs between 2 and 8 options.');
  }
  if (new Set(cleanOptions.map((option) => option.toLocaleLowerCase())).size !== cleanOptions.length) {
    throw new Error('Poll options must be different.');
  }
  return { type: 'poll', question: cleanQuestion, options: cleanOptions };
}

/** Upsert is intentional: a participant changes their single current selection. */
export async function castDmPollVote(vote: DmPollVote): Promise<void> {
  const { error } = await supabase
    .from('dm_poll_votes' as never)
    .upsert({
      message_id: vote.messageId,
      conversation_id: vote.conversationId,
      user_id: vote.userId,
      option_index: vote.optionIndex,
      updated_at: new Date().toISOString(),
    } as never, { onConflict: 'message_id,user_id' });
  if (error) throw error;
}
