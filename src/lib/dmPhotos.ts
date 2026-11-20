import { uploadAndScreen } from '@/lib/imageModeration';
import { supabase } from '@/integrations/supabase/client';

export const DM_PHOTOS_BUCKET = 'dm-photos';

/**
 * Object path for a chat photo. The FIRST SEGMENT MUST BE THE UPLOADER'S UID —
 * the storage RLS policy (migration 20260825000000) compares it against
 * `auth.uid()`, so any other shape is rejected by the server, not just by
 * convention here. The random suffix keeps the public URL unguessable.
 */
export function dmPhotoPath(userId: string, file: File, seed: string): string {
  // `name.split('.').pop()` returns the WHOLE name when there is no dot, which
  // would produce `seed.IMG_0001` and a MIME the bucket rejects. A camera
  // capture often arrives with no extension at all, so fall back to the type.
  const dotted = file.name.includes('.') ? file.name.split('.').pop() : '';
  const fromType = file.type?.split('/')[1];
  const ext = (dotted || fromType || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  return `${userId}/${seed}.${ext}`;
}

/** Reads the intrinsic size so the bubble can reserve the box before decode. */
export async function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Upload a chat photo and screen it BEFORE it can become a message.
 *
 * PRODUCT DECISION 2026-08-06 (Ethan): the screen BLOCKS the send. The handoff
 * proposed screening asynchronously and revoking on a reject, which costs no
 * latency, but a recipient who has already seen or saved an image cannot be
 * un-shown it, so after-the-fact revocation does not undo the harm. DMs are also
 * the worst path to leave open: person-to-person, invisible to any moderation
 * queue, and `dm-photos` is public-read, so an object is fetchable by URL with no
 * auth. The cost is roughly a second on top of an upload the user already waits
 * through; ChatPanel never paints the bubble optimistically, so nothing has to be
 * rolled back on screen.
 *
 * Throws on reject, on hold and on an unavailable screen, and deletes the object
 * it uploaded. The caller shows the message and sends nothing.
 */
export async function uploadDmPhoto(userId: string, file: File, seed: string): Promise<string> {
  return uploadAndScreen({
    bucket: DM_PHOTOS_BUCKET,
    path: dmPhotoPath(userId, file, seed),
    file,
    context: 'dm_photo',
    contentId: userId,
    upload: {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'image/jpeg',
    },
  });
}

/** Remove an uploaded photo when the message row could not be committed. */
export async function deleteDmPhoto(path: string): Promise<void> {
  const { error } = await supabase.storage.from(DM_PHOTOS_BUCKET).remove([path]);
  if (error) throw error;
}
