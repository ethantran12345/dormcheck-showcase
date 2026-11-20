import { useState, type ImgHTMLAttributes } from 'react';
import { supabaseThumbUrl } from '@/lib/imageTransform';

interface ThumbImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> {
  /** Original (already-sanitized) image URL; null/undefined renders the fallback. */
  src: string | null | undefined;
  /** Transform width in px — pick ~2x the rendered CSS width for retina. */
  thumbWidth?: number;
  quality?: number;
  fallbackSrc?: string;
}

/**
 * <img> that serves a Supabase Storage transform (thumbnail) instead of the
 * full-size original, degrading thumb -> original -> fallback on load errors.
 * Non-Supabase sources (bundled assets, blob:, data:) just load as-is.
 * Lazy + async by default; override via the usual img props.
 */
export function ThumbImage({
  src,
  thumbWidth = 400,
  quality = 70,
  fallbackSrc = '/placeholder.svg',
  loading = 'lazy',
  decoding = 'async',
  alt = '',
  ...rest
}: ThumbImageProps) {
  const original = src || fallbackSrc;
  const thumb = supabaseThumbUrl(original, { width: thumbWidth, quality });
  const candidates = thumb ? [thumb, original, fallbackSrc] : [original, fallbackSrc];
  // Reset the fallback chain whenever the source itself changes.
  const [errored, setErrored] = useState<{ key: string; step: number }>({ key: original, step: 0 });
  const step = errored.key === original ? errored.step : 0;
  const resolved = candidates[Math.min(step, candidates.length - 1)];
  return (
    <img
      src={resolved}
      alt={alt}
      loading={loading}
      decoding={decoding}
      onError={() => setErrored({ key: original, step: step + 1 })}
      {...rest}
    />
  );
}
