/**
 * HEIC/HEIF → JPEG in the browser (A3, 2026-10-12). Loaded lazily by
 * `src/lib/imageNormalize.ts`, only when a HEIC file actually arrives.
 *
 * It uses the browser's OWN decoder: draw the image onto a canvas and re-encode
 * it as JPEG. Safari (macOS 17+, iOS) decodes HEIC natively, so this converts
 * there with no download. Chrome and Firefox cannot decode HEIC at all; there the
 * decode fails and the caller refuses the file with a clear message instead of
 * uploading something that renders as a broken image everywhere else.
 *
 * A wasm decoder (libheif) would convert in every browser, but every maintained
 * build is LGPL-3.0 and several MB; adding one is a licence decision, not a code
 * one, so it is deliberately not here. `decode` is injectable so that decision can
 * slot in later without touching callers.
 */

export const JPEG_QUALITY = 0.9;

export type HeicDecoder = (file: File) => Promise<Blob>;

function canvasToJpeg(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('canvas 2d context unavailable'));
  draw(ctx);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('JPEG encode failed'))),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

/** Decode with whatever the browser supports natively, then encode JPEG. */
export const decodeWithBrowser: HeicDecoder = async (file) => {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      try {
        return await canvasToJpeg(bitmap.width, bitmap.height, (ctx) => ctx.drawImage(bitmap, 0, 0));
      } finally {
        bitmap.close?.();
      }
    } catch {
      // Fall through to <img>: some Safari builds decode HEIC in <img> only.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('this browser cannot decode HEIC'));
      el.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('decoded HEIC has no size');
    return await canvasToJpeg(img.naturalWidth, img.naturalHeight, (ctx) => ctx.drawImage(img, 0, 0));
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** `IMG_0001.HEIC` → `IMG_0001.jpg`; a nameless camera capture gets a stamped name. */
export function jpegNameFor(name: string): string {
  const base = name.replace(/\.(heic|heif)$/i, '').trim();
  return `${base || `photo-${Date.now()}`}.jpg`;
}

export async function convertHeicToJpeg(file: File, decode: HeicDecoder = decodeWithBrowser): Promise<File> {
  const blob = await decode(file);
  if (!blob || blob.size === 0) throw new Error('HEIC conversion produced an empty file');
  return new File([blob], jpegNameFor(file.name), {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  });
}
