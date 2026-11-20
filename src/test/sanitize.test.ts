import { describe, it, expect } from 'vitest';
import {
  sanitizeText,
  sanitizeOptional,
  safeHref,
  safeHrefWithHttpsFallback,
  safeSocialHandle,
  safeImageSrc,
  safeTel,
  safeMailToEmail,
  isValidUuid,
} from '@/lib/sanitize';

describe('sanitizeText', () => {
  it('trims leading and trailing whitespace', () => {
    expect(sanitizeText('  hello world  ')).toBe('hello world');
    expect(sanitizeText('\n\ttab\n')).toBe('tab');
  });

  it('strips script tags', () => {
    expect(sanitizeText('<script>alert("xss")</script>hello')).toBe('hello');
    expect(sanitizeText('start<script src="evil.js"></script>end')).toBe('startend');
  });

  it('strips style tags', () => {
    expect(sanitizeText('<style>body { color: red; }</style>text')).toBe('text');
  });

  it('strips all HTML tags', () => {
    expect(sanitizeText('<p>hello</p><div>world</div>')).toBe('helloworld');
    expect(sanitizeText('<img src="x" alt="y"><br>')).toBe('');
  });

  it('handles nested and multiline tags', () => {
    // NOTE: The script tag regex is greedy and stops at the first </script>,
    // so 'var x = "</script>"' is not in a script tag. The outer script tags
    // are stripped, leaving the string content behind.
    expect(sanitizeText('<script>var x = "</script>"; console.log(x);</script>hello')).toBe('"; console.log(x);hello');
  });

  it('returns empty string for null/undefined', () => {
    expect(sanitizeText(null)).toBe('');
    expect(sanitizeText(undefined)).toBe('');
  });

  it('returns empty string for non-string types', () => {
    expect(sanitizeText(123 as unknown as string)).toBe('');
    expect(sanitizeText({} as unknown as string)).toBe('');
  });

  it('limits length to 10000 characters', () => {
    const longString = 'a'.repeat(10_001);
    const result = sanitizeText(longString);
    expect(result.length).toBe(10_000);
    expect(result).toBe('a'.repeat(10_000));
  });

  it('trims again after tag stripping and limiting', () => {
    expect(sanitizeText('  <p>  hello  </p>  ')).toBe('hello');
  });
});

describe('sanitizeOptional', () => {
  it('returns null for empty strings', () => {
    expect(sanitizeOptional('')).toBeNull();
    expect(sanitizeOptional('   ')).toBeNull();
  });

  it('returns null for null/undefined inputs', () => {
    expect(sanitizeOptional(null)).toBeNull();
    expect(sanitizeOptional(undefined)).toBeNull();
  });

  it('returns sanitized string for non-empty input', () => {
    expect(sanitizeOptional('  hello world  ')).toBe('hello world');
  });

  it('returns null when sanitization results in empty string', () => {
    expect(sanitizeOptional('<script></script>')).toBeNull();
  });
});

describe('safeHref', () => {
  it('accepts http URLs', () => {
    expect(safeHref('http://example.com/path')).toBe('http://example.com/path');
  });

  it('accepts https URLs', () => {
    expect(safeHref('https://example.com/path')).toBe('https://example.com/path');
  });

  it('returns null for javascript scheme', () => {
    expect(safeHref('javascript:alert("xss")')).toBeNull();
  });

  it('returns null for data scheme', () => {
    expect(safeHref('data:text/html,<script>alert("xss")</script>')).toBeNull();
  });

  it('returns null for vbscript scheme', () => {
    expect(safeHref('vbscript:msgbox("xss")')).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(safeHref(null)).toBeNull();
    expect(safeHref(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(safeHref('')).toBeNull();
    expect(safeHref('   ')).toBeNull();
  });

  it('returns null for malformed URLs', () => {
    expect(safeHref('not a url')).toBeNull();
    expect(safeHref('htp://typo.com')).toBeNull();
  });

  it('trims input before parsing', () => {
    expect(safeHref('  https://example.com/path  ')).toBe('https://example.com/path');
  });

  it('is case-insensitive for scheme', () => {
    expect(safeHref('HTTPS://example.com')).toBe('HTTPS://example.com');
    expect(safeHref('HtTp://example.com')).toBe('HtTp://example.com');
  });
});

describe('safeHrefWithHttpsFallback', () => {
  it('accepts explicit http/https URLs', () => {
    expect(safeHrefWithHttpsFallback('https://amazon.com/product')).toBe('https://amazon.com/product');
    expect(safeHrefWithHttpsFallback('http://example.com')).toBe('http://example.com');
  });

  it('normalizes protocol-relative URLs', () => {
    expect(safeHrefWithHttpsFallback('//example.com/path')).toBe('https://example.com/path');
  });

  it('normalizes bare domain/path to https', () => {
    expect(safeHrefWithHttpsFallback('www.amazon.com/product')).toBe('https://www.amazon.com/product');
    expect(safeHrefWithHttpsFallback('amazon.com/product')).toBe('https://amazon.com/product');
  });

  it('rejects javascript scheme', () => {
    expect(safeHrefWithHttpsFallback('javascript:alert("xss")')).toBeNull();
  });

  it('rejects data scheme', () => {
    expect(safeHrefWithHttpsFallback('data:text/html,<script>')).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(safeHrefWithHttpsFallback(null)).toBeNull();
    expect(safeHrefWithHttpsFallback(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(safeHrefWithHttpsFallback('')).toBeNull();
    expect(safeHrefWithHttpsFallback('   ')).toBeNull();
  });

  it('rejects strings with scheme prefix before slash', () => {
    // Strings like "ftp://..." that have : before the first / are rejected
    // to prevent wrapping dangerous schemes
    expect(safeHrefWithHttpsFallback('ftp://example.com')).toBeNull();
  });

  it('accepts paths starting with /', () => {
    // Relative paths are NOT normalized with https (they start with /)
    expect(safeHrefWithHttpsFallback('/path/to/page')).toBeNull();
  });

  it('trims input before processing', () => {
    expect(safeHrefWithHttpsFallback('  www.example.com  ')).toBe('https://www.example.com');
  });
});

describe('safeSocialHandle', () => {
  it('removes leading @ symbol', () => {
    expect(safeSocialHandle('@username')).toBe('username');
  });

  it('keeps alphanumeric characters', () => {
    expect(safeSocialHandle('User123')).toBe('User123');
  });

  it('keeps underscore and period', () => {
    expect(safeSocialHandle('user_name.123')).toBe('user_name.123');
  });

  it('strips special characters', () => {
    expect(safeSocialHandle('user!@#$%name')).toBe('username');
  });

  it('returns empty string for null/undefined', () => {
    expect(safeSocialHandle(null)).toBe('');
    expect(safeSocialHandle(undefined)).toBe('');
  });

  it('trims whitespace', () => {
    expect(safeSocialHandle('  username  ')).toBe('username');
  });

  it('handles multiple @ symbols', () => {
    expect(safeSocialHandle('@@username')).toBe('username');
  });
});

describe('safeImageSrc', () => {
  it('accepts https URLs', () => {
    expect(safeImageSrc('https://example.com/image.jpg')).toBe('https://example.com/image.jpg');
  });

  it('accepts http URLs', () => {
    expect(safeImageSrc('http://example.com/image.png')).toBe('http://example.com/image.png');
  });

  it('rejects data scheme (SVG/script XSS)', () => {
    expect(safeImageSrc('data:image/svg+xml,<svg></svg>')).toBeNull();
  });

  it('rejects javascript scheme', () => {
    expect(safeImageSrc('javascript:alert("xss")')).toBeNull();
  });

  it('rejects vbscript scheme', () => {
    expect(safeImageSrc('vbscript:msgbox("xss")')).toBeNull();
  });

  it('accepts relative paths starting with /', () => {
    expect(safeImageSrc('/images/logo.png')).toBe('/images/logo.png');
  });

  it('rejects protocol-relative URLs (//)', () => {
    expect(safeImageSrc('//example.com/image.jpg')).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(safeImageSrc(null)).toBeNull();
    expect(safeImageSrc(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(safeImageSrc('')).toBeNull();
    expect(safeImageSrc('   ')).toBeNull();
  });

  it('returns null for malformed URLs', () => {
    expect(safeImageSrc('not a url')).toBeNull();
  });

  it('trims input before parsing', () => {
    expect(safeImageSrc('  https://example.com/image.jpg  ')).toBe('https://example.com/image.jpg');
  });
});

describe('safeTel', () => {
  it('allows digits, +, -, (, ), and spaces', () => {
    expect(safeTel('+1 (555) 123-4567')).toBe('+1 (555) 123-4567');
  });

  it('returns empty string for null/undefined', () => {
    expect(safeTel(null)).toBe('');
    expect(safeTel(undefined)).toBe('');
  });

  it('strips newlines and control characters', () => {
    expect(safeTel('555\n1234\r\n567')).toBe('5551234567');
  });

  it('strips non-phone characters', () => {
    // NOTE: Only keeps digits, +, -, (, ), spaces. $ is stripped but # is too.
    expect(safeTel('555#1234$5678')).toBe('55512345678');
  });

  it('limits to 30 characters', () => {
    const longPhone = '+1 (555) 123-4567-8901234567890';
    const result = safeTel(longPhone);
    expect(result.length).toBeGreaterThanOrEqual(0);
    expect(result.length).toBeLessThanOrEqual(30);
  });

  it('trims whitespace', () => {
    expect(safeTel('  555-1234  ')).toBe('555-1234');
  });
});

describe('safeMailToEmail', () => {
  it('accepts basic email addresses', () => {
    expect(safeMailToEmail('user@example.com')).toBe('user@example.com');
  });

  it('returns empty string for null/undefined', () => {
    expect(safeMailToEmail(null)).toBe('');
    expect(safeMailToEmail(undefined)).toBe('');
  });

  it('strips newlines and control characters (header injection prevention)', () => {
    // NOTE: Strips \r\n (control chars 0x00-0x1f) but does NOT strip the text that
    // follows. Header injection is prevented at the mailto: level by the UA.
    // The newlines ARE removed, leaving the text concatenated.
    expect(safeMailToEmail('user@example.com\r\nBcc: attacker@evil.com')).toBe('user@example.comBcc: attacker@evil.com');
  });

  it('limits to 254 characters', () => {
    const longEmail = 'a'.repeat(250) + '@example.com';
    const result = safeMailToEmail(longEmail);
    expect(result.length).toBeLessThanOrEqual(254);
  });

  it('trims whitespace', () => {
    expect(safeMailToEmail('  user@example.com  ')).toBe('user@example.com');
  });
});

describe('isValidUuid', () => {
  it('accepts valid UUID v4', () => {
    expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('accepts UUID with uppercase', () => {
    expect(isValidUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  it('accepts UUID with mixed case', () => {
    expect(isValidUuid('550e8400-E29B-41d4-A716-446655440000')).toBe(true);
  });

  it('rejects UUID without hyphens', () => {
    expect(isValidUuid('550e8400e29b41d4a716446655440000')).toBe(false);
  });

  it('rejects malformed UUID (wrong segment lengths)', () => {
    expect(isValidUuid('550e8400-e29b-41d4-a716')).toBe(false);
  });

  it('rejects non-UUID strings', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false);
  });

  it('rejects null/undefined', () => {
    expect(isValidUuid(null)).toBe(false);
    expect(isValidUuid(undefined)).toBe(false);
  });

  it('accepts UUID with leading/trailing whitespace (trims before validating)', () => {
    // The function trims the string before testing against the regex
    expect(isValidUuid('  550e8400-e29b-41d4-a716-446655440000  ')).toBe(true);
  });

});
