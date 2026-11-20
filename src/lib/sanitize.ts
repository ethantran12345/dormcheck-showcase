/**
 * Sanitizes user-facing text before storing or sending to the backend.
 * - Trims whitespace
 * - Strips HTML/script tags to prevent XSS
 * - Limits length to prevent abuse (optional)
 */
const MAX_SAFE_LENGTH = 10_000;

export function sanitizeText(input: string | null | undefined): string {
  if (input == null || typeof input !== 'string') return '';
  let s = input.trim();
  // Strip script, style, and other HTML tags
  s = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  s = s.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  s = s.replace(/<[^>]+>/g, '');
  // Limit length
  if (s.length > MAX_SAFE_LENGTH) s = s.slice(0, MAX_SAFE_LENGTH);
  return s.trim();
}

/** Sanitize and return null if empty (for optional fields). */
export function sanitizeOptional(input: string | null | undefined): string | null {
  const s = sanitizeText(input);
  return s === '' ? null : s;
}

/**
 * Validates user-provided URLs for safe use in href attributes.
 * Only allows http: and https: protocols to prevent javascript:, data:, vbscript: injection.
 * Returns the URL if safe, null otherwise.
 */
export function safeHref(url: string | null | undefined): string | null {
  if (url == null || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (trimmed === '') return null;
  try {
    const parsed = new URL(trimmed);
    const scheme = parsed.protocol?.toLowerCase();
    if (scheme === 'https:' || scheme === 'http:') return trimmed;
  } catch {
    /* invalid URL */
  }
  return null;
}

/**
 * Like {@link safeHref}, but normalizes common user-pasted forms so checklist/external links persist:
 * protocol-relative `//host/...`, and bare `host/path` (e.g. `www.amazon.com/...`) via `https://`.
 * Rejects strings that already contain `:` before the first `/` (e.g. `javascript:...`) so we do not wrap them.
 */
export function safeHrefWithHttpsFallback(url: string | null | undefined): string | null {
  const primary = safeHref(url);
  if (primary) return primary;
  if (url == null || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (trimmed === '') return null;
  const firstSlash = trimmed.indexOf('/');
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx !== -1 && (firstSlash === -1 || colonIdx < firstSlash)) {
    return null;
  }
  if (trimmed.startsWith('//')) {
    return safeHref(`https:${trimmed}`);
  }
  if (!trimmed.startsWith('/') && trimmed.includes('.')) {
    return safeHref(`https://${trimmed}`);
  }
  return null;
}

/**
 * Sanitizes social media handles (Instagram, Snapchat) for safe use in URL paths.
 * Keeps only alphanumeric, underscore, period. Prevents path traversal and protocol injection.
 */
export function safeSocialHandle(handle: string | null | undefined): string {
  if (handle == null || typeof handle !== 'string') return '';
  return handle.replace(/^@/, '').replace(/[^a-zA-Z0-9_.]/g, '').trim();
}

/**
 * Validates URLs for safe use in img src attributes.
 * Only allows http: and https: to prevent data: (SVG/script XSS), javascript:, vbscript:.
 * Returns the URL if safe, null otherwise.
 */
export function safeImageSrc(url: string | null | undefined): string | null {
  if (url == null || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (trimmed === '') return null;
  try {
    const parsed = new URL(trimmed);
    const scheme = parsed.protocol?.toLowerCase();
    if (scheme === 'https:' || scheme === 'http:') return trimmed;
  } catch {
    /* relative URLs - allow if same-origin friendly (starts with /) */
    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  }
  return null;
}

/**
 * Sanitizes phone for tel: links. Strips non-phone chars except digits, +, -, (, ), spaces.
 * Prevents newlines and control chars that could break URI or inject.
 */
export function safeTel(phone: string | null | undefined): string {
  if (phone == null || typeof phone !== 'string') return '';
  // eslint-disable-next-line no-control-regex -- matching control chars IS the point: this strips them out of tel: URIs.
  return phone.replace(/[\r\n\x00-\x1f]/g, '').replace(/[^\d+\-()\s]/g, '').trim().slice(0, 30);
}

/**
 * Sanitizes email for mailto: links. Strips newlines/control chars to prevent header injection.
 */
export function safeMailToEmail(email: string | null | undefined): string {
  if (email == null || typeof email !== 'string') return '';
  // eslint-disable-next-line no-control-regex -- matching control chars IS the point: this blocks mailto: header injection.
  return email.replace(/[\r\n\x00-\x1f]/g, '').trim().slice(0, 254);
}

/**
 * Validates that a string is a valid UUID v4 format.
 * Used to prevent malformed conversation IDs from being passed to Supabase queries.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isValidUuid(str: string | null | undefined): str is string {
  return typeof str === 'string' && UUID_REGEX.test(str.trim());
}

/**
 * Escapes the SQL LIKE/ILIKE metacharacters in a user- or data-supplied string
 * so it matches literally inside a `%…%` pattern.
 *
 * `%` matches any run of characters and `_` matches any single character, so an
 * unescaped needle silently widens the match: a dorm named "Sutherland_East"
 * would match "SutherlandXEast". `\` is the escape character itself and must go
 * first, otherwise escaping `%` re-introduces a live backslash.
 *
 * Added 2026-08-02 with the My Home dorm-band filter (design-audit A-10), which
 * moved from a client-side substring scan of the newest 50 listings to a
 * server-side `.ilike()`.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
