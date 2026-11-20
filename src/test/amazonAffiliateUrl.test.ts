import { describe, it, expect } from 'vitest';
import {
  isAmazonAffiliateUrl,
  isSafeHttpUrl,
  withAffiliateTag,
} from '@/lib/amazonAffiliateUrl';

describe('isAmazonAffiliateUrl', () => {
  describe('amazon.com detection', () => {
    it('detects amazon.com', () => {
      expect(isAmazonAffiliateUrl('https://amazon.com/gp/product/B00')).toBe(true);
    });

    it('detects subdomains of amazon.com', () => {
      expect(isAmazonAffiliateUrl('https://www.amazon.com/gp/product/B00')).toBe(true);
      expect(isAmazonAffiliateUrl('https://smile.amazon.com/gp/product/B00')).toBe(true);
    });

    it('detects amazon.com without protocol', () => {
      expect(isAmazonAffiliateUrl('amazon.com/gp/product/B00')).toBe(true);
    });

    it('detects amazon.com in plaintext (fallback regex)', () => {
      expect(isAmazonAffiliateUrl('amazon.com product')).toBe(true);
      expect(isAmazonAffiliateUrl('visit amazon.com today')).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(isAmazonAffiliateUrl('HTTPS://AMAZON.COM/product')).toBe(true);
      expect(isAmazonAffiliateUrl('https://WWW.AMAZON.COM/product')).toBe(true);
    });
  });

  describe('amzn.to detection', () => {
    it('detects amzn.to', () => {
      expect(isAmazonAffiliateUrl('https://amzn.to/3abcd')).toBe(true);
    });

    it('detects amzn.to without protocol', () => {
      expect(isAmazonAffiliateUrl('amzn.to/3abcd')).toBe(true);
    });

    it('detects amzn.to subdomains', () => {
      expect(isAmazonAffiliateUrl('https://click.amzn.to/3abcd')).toBe(true);
    });

    it('detects amzn.to in plaintext (fallback regex)', () => {
      expect(isAmazonAffiliateUrl('short link amzn.to/abc123')).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(isAmazonAffiliateUrl('HTTPS://AMZN.TO/3abcd')).toBe(true);
    });
  });

  describe('non-Amazon URLs', () => {
    it('rejects ebay.com', () => {
      expect(isAmazonAffiliateUrl('https://ebay.com/itm/123')).toBe(false);
    });

    it('rejects unrelated domains', () => {
      expect(isAmazonAffiliateUrl('https://google.com')).toBe(false);
      expect(isAmazonAffiliateUrl('https://target.com/p/123')).toBe(false);
    });

    it('rejects null/undefined', () => {
      expect(isAmazonAffiliateUrl(null)).toBe(false);
      expect(isAmazonAffiliateUrl(undefined)).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isAmazonAffiliateUrl('')).toBe(false);
      expect(isAmazonAffiliateUrl('   ')).toBe(false);
    });
  });
});

describe('isSafeHttpUrl', () => {
  it('accepts https URLs', () => {
    expect(isSafeHttpUrl('https://example.com/path')).toBe(true);
  });

  it('accepts http URLs', () => {
    expect(isSafeHttpUrl('http://example.com/path')).toBe(true);
  });

  it('accepts bare domains (adds https)', () => {
    expect(isSafeHttpUrl('example.com')).toBe(true);
  });

  it('rejects javascript scheme', () => {
    expect(isSafeHttpUrl('javascript:alert("xss")')).toBe(false);
  });

  it('rejects data scheme', () => {
    expect(isSafeHttpUrl('data:text/html,<script>')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isSafeHttpUrl(null)).toBe(false);
    expect(isSafeHttpUrl(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isSafeHttpUrl('')).toBe(false);
    expect(isSafeHttpUrl('   ')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isSafeHttpUrl('not a valid url')).toBe(false);
  });
});

describe('withAffiliateTag', () => {
  describe('amazon.com URLs', () => {
    it('adds tag to amazon.com URLs', () => {
      const url = 'https://amazon.com/gp/product/B00ABC123';
      const result = withAffiliateTag(url);
      expect(result).toContain('tag=dormcheck-20');
      expect(result).toContain('amazon.com');
    });

    it('adds tag to www.amazon.com', () => {
      const url = 'https://www.amazon.com/gp/product/B00ABC123';
      const result = withAffiliateTag(url);
      expect(result).toContain('tag=dormcheck-20');
    });

    it('replaces existing tag', () => {
      const url = 'https://amazon.com/gp/product/B00ABC123?tag=oldtag-20';
      const result = withAffiliateTag(url);
      expect(result).toContain('tag=dormcheck-20');
      expect(result).not.toContain('oldtag-20');
    });

    it('handles URLs that already have query params', () => {
      const url = 'https://amazon.com/gp/product/B00ABC123?ref=sr_1_1';
      const result = withAffiliateTag(url);
      expect(result).toContain('tag=dormcheck-20');
      expect(result).toContain('ref=sr_1_1');
    });

    it('handles bare domain (adds https)', () => {
      const url = 'amazon.com/gp/product/B00ABC123';
      const result = withAffiliateTag(url);
      expect(result).toContain('https://');
      expect(result).toContain('tag=dormcheck-20');
    });

    it('is case-insensitive on domain', () => {
      const url = 'HTTPS://AMAZON.COM/gp/product/B00ABC123';
      const result = withAffiliateTag(url);
      expect(result).toContain('tag=dormcheck-20');
    });
  });

  describe('amzn.to short links', () => {
    it('passes through amzn.to unchanged (tag server-side)', () => {
      const url = 'https://amzn.to/3abcd';
      const result = withAffiliateTag(url);
      expect(result).toBe('https://amzn.to/3abcd');
      expect(result).not.toContain('tag=dormcheck-20');
    });

    it('passes through amzn.to without protocol', () => {
      const url = 'amzn.to/3abcd';
      const result = withAffiliateTag(url);
      // Should normalize to https and pass through unchanged
      expect(result).toContain('amzn.to');
      expect(result).not.toContain('tag=dormcheck-20');
    });
  });

  describe('non-Amazon URLs', () => {
    it('passes through non-Amazon URLs unchanged', () => {
      const url = 'https://ebay.com/itm/123';
      const result = withAffiliateTag(url);
      expect(result).toBe('https://ebay.com/itm/123');
    });

    it('passes through other domains unchanged', () => {
      const url = 'https://target.com/p/1234567';
      const result = withAffiliateTag(url);
      expect(result).toBe('https://target.com/p/1234567');
    });

    it('normalizes protocol-less non-Amazon URLs to https', () => {
      const url = 'target.com/p/1234567';
      const result = withAffiliateTag(url);
      expect(result).toBe('https://target.com/p/1234567');
    });
  });

  describe('error handling', () => {
    it('passes through empty string unchanged', () => {
      expect(withAffiliateTag('')).toBe('');
    });

    it('handles malformed URLs gracefully (returns original)', () => {
      const badUrl = 'not a url at all';
      const result = withAffiliateTag(badUrl);
      // Should return the input unchanged if it can't be parsed
      expect(result).toBe(badUrl);
    });
  });

  describe('integration: current behavior', () => {
    it('amazon.com gets tag=dormcheck-20', () => {
      const result = withAffiliateTag('https://amazon.com/dp/B096');
      expect(result).toContain('tag=dormcheck-20');
    });

    it('amzn.to does not get tag (server-side)', () => {
      const result = withAffiliateTag('https://amzn.to/3P');
      expect(result).not.toContain('tag=dormcheck-20');
    });

    it('other URLs pass through', () => {
      const result = withAffiliateTag('https://example.com/shop');
      expect(result).toBe('https://example.com/shop');
    });
  });
});
