import { describe, it, expect } from 'vitest';
import { supabaseThumbUrl } from './imageTransform';

const BASE = 'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/marketplace-images/user-1/photo.jpg';

describe('supabaseThumbUrl', () => {
  it('rewrites a public object URL to the render endpoint with params', () => {
    expect(supabaseThumbUrl(BASE, { width: 400, quality: 70 })).toBe(
      'https://abcdefghijklmnopqrst.supabase.co/storage/v1/render/image/public/marketplace-images/user-1/photo.jpg?width=400&quality=70',
    );
  });

  it('omits quality when not given', () => {
    expect(supabaseThumbUrl(BASE, { width: 200 })).toMatch(/\?width=200$/);
  });

  it('returns null for non-Supabase and non-public URLs', () => {
    expect(supabaseThumbUrl('/placeholder.svg', { width: 400 })).toBeNull();
    expect(supabaseThumbUrl('blob:https://x/abc', { width: 400 })).toBeNull();
    expect(supabaseThumbUrl('data:image/png;base64,xyz', { width: 400 })).toBeNull();
    expect(supabaseThumbUrl('https://example.com/a.jpg', { width: 400 })).toBeNull();
    expect(supabaseThumbUrl(null, { width: 400 })).toBeNull();
    expect(supabaseThumbUrl(undefined, { width: 400 })).toBeNull();
  });

  it('returns null when the URL already has a query string', () => {
    expect(supabaseThumbUrl(`${BASE}?width=100`, { width: 400 })).toBeNull();
  });
});
