import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from './_lib/supabase.js';
import {
  buildInviteDescription,
  buildInviteTitle,
  replaceOgTags,
  type InviteKind,
} from './_lib/og.js';

// Serves /roommates/invite/:code and /rankings/invite/:code (vercel.json
// rewrites) so link crawlers (iMessage, Slack, Twitter) get per-invite
// Open Graph tags. Humans get the same SPA shell — no redirect hop.
//
// Privacy: the preview is deliberately generic (dorm name + join CTA only).
// Never expose group name, owner, or membership — the recipient sees those
// in-app after auth.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FETCH_TIMEOUT_MS = 5000;

// The Host header is attacker-controlled and this response is CDN-cached
// (s-maxage) — deriving the fetch/OG origin from it would let a spoofed Host
// poison the cache with attacker-origin URLs. Only hostnames we own pass;
// anything else canonicalizes to production.
const ALLOWED_HOSTS = new Set(['dormcheck.com', 'www.dormcheck.com']);
const CANONICAL_HOST = 'dormcheck.com';

function resolveHost(rawHost: unknown): string {
  const host = typeof rawHost === 'string' ? rawHost.toLowerCase().split(':')[0] : '';
  return ALLOWED_HOSTS.has(host) ? host : CANONICAL_HOST;
}

async function fetchIndexHtml(origin: string): Promise<string | null> {
  try {
    const res = await fetch(`${origin}/index.html`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const kind: InviteKind = req.query.kind === 'ranking' ? 'ranking' : 'roommate';
  const host = resolveHost(req.headers.host);
  const origin = `https://${host}`;

  const html = await fetchIndexHtml(origin);
  if (!html) {
    // Can't build the shell. Don't redirect back to the invite path — the
    // rewrite would route it straight back here (loop). /auth?redirect=…
    // is a plain SPA route and Auth.tsx already honors the redirect param.
    const path = kind === 'ranking' ? 'rankings' : 'roommates';
    const target = encodeURIComponent(`/${path}/invite/${code}`);
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, `${origin}/auth?redirect=${target}`);
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

  if (!supabase || !UUID_RE.test(code)) {
    // Invalid code or missing env: serve the untouched static tags (200 so
    // previews degrade gracefully instead of showing an error card).
    return res.status(200).send(html);
  }

  let dormName: string | null = null;
  try {
    const { data } = await supabase
      .from('ranking_collaborations')
      .select('dorm_name')
      .eq('invite_code', code)
      .maybeSingle();
    if (data) dormName = data.dorm_name;
  } catch {
    // Unknown/expired codes still get the generic invite card below.
  }

  const path = kind === 'ranking' ? 'rankings' : 'roommates';
  const imageParams = new URLSearchParams({ kind });
  if (dormName) imageParams.set('dorm', dormName);

  return res.status(200).send(
    replaceOgTags(html, {
      title: buildInviteTitle(kind, dormName),
      description: buildInviteDescription(kind),
      image: `${origin}/api/og-image?${imageParams.toString()}`,
      url: `${origin}/${path}/invite/${code}`,
    }),
  );
}
