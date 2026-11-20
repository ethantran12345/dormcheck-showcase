import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';

export type ShareLinkResult = 'shared' | 'copied' | 'failed';

/**
 * Share a URL through the platform's native/OS share sheet, falling back to the
 * clipboard where no share sheet exists (most desktop browsers).
 *
 * One place for the URL-sharing logic that was previously re-implemented inline
 * (see `saveDocumentPages.ts` for Capacitor Share, `checklistPdf.ts` for the
 * Web Share API). Returns how the link was delivered so callers can toast only
 * on the clipboard fallback - when the OS sheet opens, that IS the feedback.
 *
 * User-cancelled sheets are reported as `'shared'`: dismissing the sheet is a
 * deliberate no-op, not an error worth surfacing.
 */
export async function shareLink(
  url: string,
  opts: { title?: string; text?: string } = {},
): Promise<ShareLinkResult> {
  const { title, text } = opts;

  // Native iOS/Android: always route through the Capacitor Share plugin.
  if (Capacitor.isNativePlatform()) {
    try {
      await Share.share({ title, text, url });
      return 'shared';
    } catch (err) {
      if (isCancellation(err)) return 'shared';
      return copyToClipboard(url);
    }
  }

  // Web with the Web Share API (mobile Safari/Chrome): open the OS share sheet.
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (err) {
      if (isCancellation(err)) return 'shared';
      return copyToClipboard(url);
    }
  }

  // No share sheet (most desktop browsers): copy the link instead.
  return copyToClipboard(url);
}

async function copyToClipboard(url: string): Promise<ShareLinkResult> {
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** The user dismissing the share sheet rejects with an AbortError - not a real failure. */
function isCancellation(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  const name = (err as { name?: string } | null)?.name;
  const message = (err as { message?: string } | null)?.message?.toLowerCase() ?? '';
  return name === 'AbortError' || message.includes('cancel') || message.includes('abort');
}
