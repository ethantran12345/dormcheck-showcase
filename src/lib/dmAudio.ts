import { supabase } from '@/integrations/supabase/client';
import type { DmAudioMessageMetadata } from '@/types/dmMessageMeta';

export const DM_AUDIO_BUCKET = 'dm-audio';
export const MAX_DM_AUDIO_BYTES = 15 * 1024 * 1024;

/** The storage policy requires conversation/user folders in exactly this order. */
export function dmAudioPath(conversationId: string, userId: string, seed: string = crypto.randomUUID()): string {
  return `${conversationId}/${userId}/${seed}.m4a`;
}

export function audioDurationLabel(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Upload audio only after recording has stopped. The path, not a URL, goes in
 * message metadata so the private bucket's RLS is consulted for every play.
 */
export async function uploadDmAudio({
  conversationId,
  userId,
  audio,
  durationMs,
  mimeType,
}: {
  conversationId: string;
  userId: string;
  audio: Blob;
  durationMs: number;
  mimeType?: string;
}): Promise<DmAudioMessageMetadata> {
  if (!audio.size || audio.size > MAX_DM_AUDIO_BYTES) {
    throw new Error('Voice messages must be smaller than 15 MB.');
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error('Voice message duration is invalid.');
  }

  const path = dmAudioPath(conversationId, userId);
  const { error } = await supabase.storage.from(DM_AUDIO_BUCKET).upload(path, audio, {
    cacheControl: 'private, max-age=0',
    contentType: mimeType || audio.type || 'audio/mp4',
    upsert: false,
  });
  if (error) throw error;

  return {
    type: 'audio',
    path,
    durationMs: Math.round(durationMs),
    mimeType: mimeType || audio.type || 'audio/mp4',
  };
}

/** A short-lived local object URL, created only after the participant-only RLS check. */
export async function downloadDmAudio(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(DM_AUDIO_BUCKET).download(path);
  if (error) throw error;
  return URL.createObjectURL(data);
}

/** Best-effort cleanup for a sender retraction; the message deletion remains authoritative. */
export async function deleteDmAudio(path: string): Promise<void> {
  const { error } = await supabase.storage.from(DM_AUDIO_BUCKET).remove([path]);
  if (error) throw error;
}
