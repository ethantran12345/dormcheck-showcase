/**
 * Supabase Storage image transforms (thumbnails) for grid/card surfaces.
 *
 * Public storage URLs look like
 *   https://<proj>.supabase.co/storage/v1/object/public/<bucket>/<path>
 * and the on-the-fly transform endpoint is the same URL with
 * `/object/public/` swapped for `/render/image/public/` plus query params.
 * Marketplace originals are multi-MB phone photos; a ~400px thumb is what a
 * grid card actually needs.
 *
 * Callers must keep the ORIGINAL url as an <img> onError fallback: if the
 * transform pipeline is ever unavailable (plan change, self-hosted stack,
 * local supabase in e2e) the render URL 4xxs and the original still loads.
 */

const PUBLIC_OBJECT_SEGMENT = '/storage/v1/object/public/';
const RENDER_SEGMENT = '/storage/v1/render/image/public/';

export interface ThumbOptions {
  width: number;
  /** WebP/JPEG quality 20-100; Supabase default is 80. */
  quality?: number;
}

/**
 * Rewrite a Supabase public-storage URL to its resized/transcoded variant.
 * Returns null for anything that isn't a plain Supabase public object URL
 * (blob:, data:, /placeholder.svg, already-transformed, non-Supabase hosts) —
 * callers should then just use the original.
 */
export function supabaseThumbUrl(url: string | null | undefined, opts: ThumbOptions): string | null {
  if (!url || !url.startsWith('https://')) return null;
  const idx = url.indexOf(PUBLIC_OBJECT_SEGMENT);
  if (idx === -1 || url.includes('?')) return null;
  const base = url.slice(0, idx) + RENDER_SEGMENT + url.slice(idx + PUBLIC_OBJECT_SEGMENT.length);
  const params = new URLSearchParams({ width: String(opts.width) });
  if (opts.quality) params.set('quality', String(opts.quality));
  return `${base}?${params.toString()}`;
}
