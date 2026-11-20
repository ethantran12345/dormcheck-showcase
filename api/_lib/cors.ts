import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Origins allowed to call the /api endpoints cross-origin.
 * - capacitor://localhost, https://localhost : Capacitor iOS/Android WKWebView
 * - http://localhost:8080, :8081            : local Vite dev server
 * - https://dormcheck.com (+ www)            : production web
 */
const ALLOWED_ORIGINS = new Set([
  'capacitor://localhost',
  'https://localhost',
  'http://localhost:8080',
  'http://localhost:8081',
  'https://dormcheck.com',
  'https://www.dormcheck.com',
]);

const FALLBACK_ORIGIN = 'https://dormcheck.com';

/**
 * Applies CORS headers and short-circuits the OPTIONS preflight.
 *
 * Reflects the request Origin when it is in the allowlist, otherwise falls back
 * to the production origin. These endpoints authenticate via a Bearer token (no
 * cookies), so reflecting a specific allowed origin is safe.
 *
 * Call at the very top of each handler, before auth. Returns true when the
 * request was an OPTIONS preflight that has been answered with a 204 - the
 * handler should `return` immediately in that case.
 */
export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  const originHeader = req.headers.origin;
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : FALLBACK_ORIGIN;

  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}
