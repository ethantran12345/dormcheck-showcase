/** Parse user input as https URL; returns null if invalid or non-https. */
function parseHttpsUrl(url: string): URL | null {
  const t = url.trim();
  if (!t) return null;
  try {
    const withProto = /^https:\/\//i.test(t) ? t : `https://${t}`;
    const parsed = new URL(withProto);
    if (parsed.protocol !== 'https:') return null;
    return parsed;
  } catch {
    return null;
  }
}

function isTikTokHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'tiktok.com' || h.endsWith('.tiktok.com');
}

/** True only for https URLs on tiktok.com / *.tiktok.com (www, m, vm, etc.). */
export function isTikTokUrl(url: string | null | undefined): boolean {
  const parsed = parseHttpsUrl(url ?? '');
  if (!parsed) return false;
  return isTikTokHostname(parsed.hostname);
}

/**
 * Extract numeric video id from a full TikTok video URL.
 * Supports /@user/video/{id} and /v/{id}. Returns null for short vm.tiktok.com links.
 */
export function parseTikTokVideoId(url: string | null | undefined): string | null {
  const parsed = parseHttpsUrl(url ?? '');
  if (!parsed || !isTikTokHostname(parsed.hostname)) return null;

  const path = parsed.pathname;
  const videoMatch = path.match(/\/video\/(\d+)/);
  if (videoMatch) return videoMatch[1];

  const vMatch = path.match(/^\/v\/(\d+)\/?$/);
  if (vMatch) return vMatch[1];

  return null;
}

/** Normalized https URL to store after validation; null if not a full video link. */
export function canonicalTikTokUrl(url: string | null | undefined): string | null {
  const id = parseTikTokVideoId(url);
  if (!id) return null;

  const parsed = parseHttpsUrl(url ?? '');
  if (!parsed) return null;

  const atVideo = parsed.pathname.match(/^(\/@[^/]+\/video\/\d+)/);
  if (atVideo) return `https://www.tiktok.com${atVideo[1]}`;

  if (/^\/v\/\d+/.test(parsed.pathname)) return `https://www.tiktok.com/v/${id}`;

  return `https://www.tiktok.com/video/${id}`;
}

const TIKTOK_EMBED_ORIGIN = 'https://www.tiktok.com';

/**
 * Official TikTok embed player URL for a stored link, or null if invalid/untrusted.
 * Re-validates host + numeric video id before building the iframe src.
 */
export function getTikTokEmbedSrc(url: string | null | undefined): string | null {
  if (!isTikTokUrl(url)) return null;
  const id = parseTikTokVideoId(url);
  if (!id || !/^\d+$/.test(id)) return null;
  return `${TIKTOK_EMBED_ORIGIN}/embed/v2/${id}`;
}
