/**
 * Room-tour links for student setups.
 *
 * A setup may link ONE short-form video tour, hosted on TikTok or Instagram
 * Reels. Both are stored in `student_setups.tiktok_url` — the column predates
 * Instagram support and is a plain text column, so it holds either platform's
 * canonical URL. Read tours through `parseTourUrl` / `canonicalTourUrl` rather
 * than assuming the column's name.
 */
import { canonicalTikTokUrl, isTikTokUrl } from '@/lib/tiktok';

export type TourPlatform = 'tiktok' | 'instagram';

export interface ParsedTour {
  platform: TourPlatform;
  /** Canonical https URL safe to store and to open. */
  url: string;
}

/** Parse user input as an https URL; returns null if invalid or non-https. */
function parseHttpsUrl(url: string): URL | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const withProto = /^https:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withProto);
    if (parsed.protocol !== 'https:') return null;
    return parsed;
  } catch {
    return null;
  }
}

function isInstagramHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'instagram.com' || h.endsWith('.instagram.com');
}

/**
 * Canonical Instagram Reel URL, or null. Reels only — feed posts (`/p/…`) and
 * profiles are rejected, since the feature is specifically a video room tour.
 */
export function canonicalInstagramReelUrl(url: string | null | undefined): string | null {
  const parsed = parseHttpsUrl(url ?? '');
  if (!parsed || !isInstagramHostname(parsed.hostname)) return null;

  const match = parsed.pathname.match(/^\/(?:reels?)\/([A-Za-z0-9_-]+)\/?$/);
  if (!match) return null;

  return `https://www.instagram.com/reel/${match[1]}/`;
}

/** True for any https URL on instagram.com that points at a reel. */
export function isInstagramReelUrl(url: string | null | undefined): boolean {
  return canonicalInstagramReelUrl(url) !== null;
}

/**
 * Normalize a pasted tour link to the canonical form we store, tagged with its
 * platform. Returns null when the link is neither a TikTok video nor an
 * Instagram Reel — those are the only two platforms we accept.
 */
export function canonicalTourUrl(url: string | null | undefined): ParsedTour | null {
  const tiktok = canonicalTikTokUrl(url);
  if (tiktok) return { platform: 'tiktok', url: tiktok };

  const reel = canonicalInstagramReelUrl(url);
  if (reel) return { platform: 'instagram', url: reel };

  return null;
}

/**
 * Classify an already-stored tour URL for display. Looser than
 * `canonicalTourUrl`: it trusts the host, so legacy rows saved before the
 * canonicalizer tightened still render with the right logo.
 */
export function parseTourUrl(url: string | null | undefined): ParsedTour | null {
  const parsed = parseHttpsUrl(url ?? '');
  if (!parsed) return null;

  if (isTikTokUrl(url)) return { platform: 'tiktok', url: parsed.toString() };
  if (isInstagramHostname(parsed.hostname)) {
    return { platform: 'instagram', url: parsed.toString() };
  }
  return null;
}
