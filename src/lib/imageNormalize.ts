import { toast } from 'sonner';
import i18n from '@/i18n';

/**
 * Every picked or dropped image passes through here before upload (A3, 2026-10-12).
 *
 * WHY. An HEIC upload stored as-is renders as a broken image on every browser but
 * Safari, so a student on Chrome sees someone's listing, avatar or DM photo as a
 * blank box. iOS native pickers already hand us JPEG (Capacitor Camera re-encodes)
 * and iOS Safari's file input transcodes too; the HEIC files that reach us come
 * from a desktop file picker or a drag-and-drop of a raw `.heic`.
 *
 * WHAT. Non-HEIC files pass straight through, untouched and without loading
 * anything. A HEIC file lazily loads `heicConvert` and is re-encoded to JPEG; if
 * this browser cannot decode it, ONE clear toast says so and the file is dropped
 * (`null`), which every caller already treats like a cancelled pick.
 */

const HEIC_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);

export function isHeic(file: Pick<File, 'name' | 'type'>): boolean {
  const type = (file.type || '').toLowerCase();
  if (HEIC_TYPES.has(type)) return true;
  // Chrome and Firefox report an empty type for .heic files they cannot read.
  return (!type || type === 'application/octet-stream') && /\.(heic|heif)$/i.test(file.name || '');
}

/** Normalize a batch; refused files are dropped and the toast is shown once. */
export async function normalizeImageFiles(files: File[]): Promise<File[]> {
  if (!files.some(isHeic)) return files;
  let refused = false;
  const out: File[] = [];
  for (const file of files) {
    if (!isHeic(file)) {
      out.push(file);
      continue;
    }
    try {
      const { convertHeicToJpeg } = await import('@/lib/heicConvert');
      out.push(await convertHeicToJpeg(file));
    } catch (error) {
      console.warn('[imageNormalize] HEIC conversion failed; refusing the file', error);
      refused = true;
    }
  }
  if (refused) toast.error(i18n.t('common:toast.heicUnsupported'));
  return out;
}

export async function normalizeImageFile(file: File): Promise<File | null> {
  return (await normalizeImageFiles([file]))[0] ?? null;
}
