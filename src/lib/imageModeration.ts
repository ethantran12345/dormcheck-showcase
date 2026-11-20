/**
 * Client side of the image safety screen.
 *
 * Every image upload path in the app funnels through here so a photo is checked
 * before it becomes visible to anyone else. Before 2026-08-06 only marketplace
 * listings were screened (`moderate-listing`), while the six other upload paths
 * wrote straight into public-read buckets, where an object is retrievable by URL
 * with no authentication at all.
 *
 * THE CONTRACT IS FAIL-CLOSED. `screenImageUrls` returns `approved: false` for a
 * reject, for a hold, for a transport error, for a malformed response and for a
 * timeout. There is no branch that turns "we could not check" into "publish it".
 * Callers must delete the object and abort on anything but `approved: true`;
 * `uploadAndScreen` does both for you.
 *
 * The screen needs a fetchable URL, so the object is uploaded first and screened
 * second. That is the same shape `moderate-listing` has always had (a listing
 * lands `pending_review` and flips visible on approval), and the exposure window
 * is an unguessable path that has been published nowhere.
 */
import { supabase } from '@/integrations/supabase/client';

/** Matches MAX_IMAGES in supabase/functions/_shared/omniModeration.ts. */
export const MODERATION_BATCH_SIZE = 4;

/** Longer than the function's own 15s provider abort, so a real verdict wins. */
const SCREEN_TIMEOUT_MS = 20_000;

/**
 * The surface an image belongs to. Doubles as `moderation_actions.content_type`
 * on a reject: keep in sync with CONTEXTS in
 * `supabase/functions/moderate-image/index.ts` and the CHECK in migration
 * 20260916000000.
 */
export type ImageModerationContext =
  | 'profile_photo'
  | 'dm_photo'
  | 'roommate_post_photo'
  | 'setup_photo'
  | 'business_image'
  | 'dorm_photo';

export type ImageModerationDecision = 'approve' | 'hold' | 'reject' | 'unavailable';

export interface ImageModerationResult {
  approved: boolean;
  decision: ImageModerationDecision;
  reason: string;
}

/** Thrown by `uploadAndScreen` when the image must not be published. */
export class ImageRejectedError extends Error {
  readonly decision: ImageModerationDecision;

  constructor(decision: ImageModerationDecision, message: string) {
    super(message);
    this.name = 'ImageRejectedError';
    this.decision = decision;
  }
}

const REJECT_MESSAGE = "That photo can't be used here. It was flagged by the automatic safety check.";
const UNAVAILABLE_MESSAGE =
  "We couldn't run the safety check on that photo, so it wasn't saved. Please try again.";

/** The message to show a user for a failed screen, ready for a toast. */
export function moderationMessage(result: ImageModerationResult): string {
  if (result.decision === 'reject' || result.decision === 'hold') return REJECT_MESSAGE;
  return UNAVAILABLE_MESSAGE;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function screenBatch(
  urls: string[],
  context: ImageModerationContext,
  contentId?: string,
): Promise<ImageModerationResult> {
  const failClosed: ImageModerationResult = {
    approved: false,
    decision: 'unavailable',
    reason: UNAVAILABLE_MESSAGE,
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const invoked = supabase.functions.invoke('moderate-image', {
      body: {
        image_urls: urls,
        context,
        ...(contentId ? { content_id: contentId } : {}),
      },
    });
    // A hung gateway must not hang the composer. A timeout is an unavailable
    // screen, which is a refusal, not an approval.
    const raced = await Promise.race([
      invoked,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), SCREEN_TIMEOUT_MS);
      }),
    ]);
    if (!raced) return failClosed;

    const { data, error } = raced as {
      data?: { decision?: string; reason?: string } | null;
      error?: unknown;
    };
    if (error) {
      console.error('[imageModeration] moderate-image invoke failed:', error);
      return failClosed;
    }
    const decision = data?.decision;
    if (decision === 'approve') {
      return { approved: true, decision: 'approve', reason: '' };
    }
    if (decision === 'reject' || decision === 'hold') {
      return { approved: false, decision, reason: data?.reason || REJECT_MESSAGE };
    }
    // Unrecognised payload: treat as unchecked, i.e. refuse.
    console.error('[imageModeration] unexpected moderate-image payload:', data);
    return failClosed;
  } catch (e) {
    console.error('[imageModeration] moderate-image threw:', e);
    return failClosed;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Screen already-uploaded public storage URLs. Batched to the function's cap so
 * a caller with more photos than the cap gets every one of them screened rather
 * than silently having the tail skipped.
 */
export async function screenImageUrls(
  urls: string[],
  context: ImageModerationContext,
  contentId?: string,
): Promise<ImageModerationResult> {
  const targets = urls.filter(Boolean);
  if (targets.length === 0) return { approved: true, decision: 'approve', reason: '' };

  const batches = await Promise.all(
    chunk(targets, MODERATION_BATCH_SIZE).map((batch) => screenBatch(batch, context, contentId)),
  );
  // Every batch must clear. The first refusal is the one we report.
  return batches.find((r) => !r.approved) ?? { approved: true, decision: 'approve', reason: '' };
}

/** Best-effort cleanup. A failed delete must never make the caller publish. */
export async function discardStorageObjects(bucket: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) console.error(`[imageModeration] failed to remove ${bucket} objects:`, error);
  } catch (e) {
    console.error(`[imageModeration] failed to remove ${bucket} objects:`, e);
  }
}

export interface UploadAndScreenOptions {
  bucket: string;
  path: string;
  file: File;
  context: ImageModerationContext;
  contentId?: string;
  upload?: Parameters<ReturnType<typeof supabase.storage.from>['upload']>[2];
}

/**
 * Upload one file, screen it, and return its public URL only if it passed.
 * On any refusal the object is deleted and `ImageRejectedError` is thrown, so a
 * caller that does nothing but let the error propagate is already fail-closed.
 */
export async function uploadAndScreen({
  bucket,
  path,
  file,
  context,
  contentId,
  upload,
}: UploadAndScreenOptions): Promise<string> {
  const { error: uploadErr } = await supabase.storage.from(bucket).upload(path, file, upload);
  if (uploadErr) throw uploadErr;

  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
  const publicUrl = urlData.publicUrl;

  const result = await screenImageUrls([publicUrl], context, contentId);
  if (!result.approved) {
    await discardStorageObjects(bucket, [path]);
    throw new ImageRejectedError(result.decision, moderationMessage(result));
  }
  return publicUrl;
}
