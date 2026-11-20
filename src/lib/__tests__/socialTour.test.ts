import { describe, it, expect } from 'vitest';
import {
  canonicalInstagramReelUrl,
  canonicalTourUrl,
  isInstagramReelUrl,
  parseTourUrl,
} from '@/lib/socialTour';

describe('canonicalInstagramReelUrl', () => {
  it('accepts reel and reels paths, normalizing to www + /reel/', () => {
    expect(canonicalInstagramReelUrl('https://instagram.com/reel/AbC-1_2/')).toBe(
      'https://www.instagram.com/reel/AbC-1_2/',
    );
    expect(canonicalInstagramReelUrl('https://www.instagram.com/reels/XyZ9')).toBe(
      'https://www.instagram.com/reel/XyZ9/',
    );
  });

  it('rejects feed posts, profiles, and non-Instagram hosts', () => {
    expect(canonicalInstagramReelUrl('https://www.instagram.com/p/AbC123/')).toBeNull();
    expect(canonicalInstagramReelUrl('https://www.instagram.com/someuser/')).toBeNull();
    expect(canonicalInstagramReelUrl('https://instagram.evil.com/reel/AbC123/')).toBeNull();
  });

  it('rejects non-https input', () => {
    expect(canonicalInstagramReelUrl('http://www.instagram.com/reel/AbC123/')).toBeNull();
    expect(canonicalInstagramReelUrl('')).toBeNull();
    expect(canonicalInstagramReelUrl(null)).toBeNull();
  });

  it('backs isInstagramReelUrl', () => {
    expect(isInstagramReelUrl('https://www.instagram.com/reel/AbC123/')).toBe(true);
    expect(isInstagramReelUrl('https://www.tiktok.com/@you/video/123')).toBe(false);
  });
});

describe('canonicalTourUrl', () => {
  it('tags TikTok video links', () => {
    expect(canonicalTourUrl('https://www.tiktok.com/@you/video/1234567890')).toEqual({
      platform: 'tiktok',
      url: 'https://www.tiktok.com/@you/video/1234567890',
    });
  });

  it('tags Instagram Reels', () => {
    expect(canonicalTourUrl('https://www.instagram.com/reel/AbC123/')).toEqual({
      platform: 'instagram',
      url: 'https://www.instagram.com/reel/AbC123/',
    });
  });

  it('rejects every other platform, and short TikTok links', () => {
    expect(canonicalTourUrl('https://vm.tiktok.com/ZMabc/')).toBeNull();
    expect(canonicalTourUrl('https://youtube.com/shorts/abc')).toBeNull();
    expect(canonicalTourUrl('https://example.com/room')).toBeNull();
    expect(canonicalTourUrl('  ')).toBeNull();
  });
});

describe('parseTourUrl', () => {
  it('is looser than the canonicalizer so legacy rows still render a logo', () => {
    // A short link we would refuse to SAVE today still displays as TikTok.
    expect(parseTourUrl('https://vm.tiktok.com/ZMabc/')?.platform).toBe('tiktok');
    // A feed post saved before Reels-only validation still displays as Instagram.
    expect(parseTourUrl('https://www.instagram.com/p/AbC123/')?.platform).toBe('instagram');
  });

  it('still refuses unknown hosts', () => {
    expect(parseTourUrl('https://example.com/room')).toBeNull();
    expect(parseTourUrl(null)).toBeNull();
  });
});
