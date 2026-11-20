// Shared helpers for the dynamic Open Graph invite previews (api/og-invite.ts).
// Pure functions so they can be unit-tested from src/test/og.test.ts.

export type InviteKind = 'roommate' | 'ranking';

export interface OgTags {
  title: string;
  description: string;
  image: string;
  url: string;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

export function buildInviteTitle(kind: InviteKind, dormName: string | null): string {
  const dorm = dormName?.trim();
  if (kind === 'ranking') return 'Join my dorm-ranking group | DormCheck';
  return dorm ? `Join my group at ${dorm} | DormCheck` : 'Join my roommate group | DormCheck';
}

export function buildInviteDescription(kind: InviteKind): string {
  return kind === 'ranking'
    ? 'Rank dorms together with your friends on DormCheck, the verified student hub for move-in.'
    : 'Team up with verified students from your campus on DormCheck, the verified student hub for move-in.';
}

/**
 * Replace the static og:* / twitter:* meta tags in the deployed index.html
 * with per-invite values. Tag values must already be plain strings; this
 * function escapes them for the HTML attribute context.
 */
export function replaceOgTags(html: string, tags: OgTags): string {
  const set = (input: string, attr: 'property' | 'name', key: string, value: string) =>
    input.replace(
      new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`),
      `$1${escapeHtml(value)}$2`,
    );

  let out = html;
  out = set(out, 'property', 'og:title', tags.title);
  out = set(out, 'property', 'og:description', tags.description);
  out = set(out, 'property', 'og:image', tags.image);
  out = set(out, 'property', 'og:url', tags.url);
  out = set(out, 'name', 'twitter:image', tags.image);
  return out;
}
