import { describe, expect, it } from 'vitest';
import {
  canonicalTikTokUrl,
  getTikTokEmbedSrc,
  isTikTokUrl,
  parseTikTokVideoId,
} from '@/lib/tiktok';

describe('isTikTokUrl', () => {
  it('accepts https tiktok hosts', () => {
    expect(isTikTokUrl('https://www.tiktok.com/@u/video/123')).toBe(true);
    expect(isTikTokUrl('https://vm.tiktok.com/abc/')).toBe(true);
    expect(isTikTokUrl('www.tiktok.com/@u/video/123')).toBe(true);
  });

  it('rejects non-tiktok and non-https', () => {
    expect(isTikTokUrl('https://youtube.com/watch?v=1')).toBe(false);
    expect(isTikTokUrl('http://www.tiktok.com/@u/video/123')).toBe(false);
    expect(isTikTokUrl('not a url')).toBe(false);
  });
});

describe('parseTikTokVideoId', () => {
  it('parses full video URLs', () => {
    expect(parseTikTokVideoId('https://www.tiktok.com/@user/video/7123456789012345678')).toBe(
      '7123456789012345678',
    );
    expect(parseTikTokVideoId('https://tiktok.com/v/999')).toBe('999');
  });

  it('returns null for short links', () => {
    expect(parseTikTokVideoId('https://vm.tiktok.com/ZMabc/')).toBeNull();
  });
});

describe('canonicalTikTokUrl', () => {
  it('normalizes @user/video links', () => {
    expect(
      canonicalTikTokUrl('https://m.tiktok.com/@roomie/video/123?is_from_webapp=1'),
    ).toBe('https://www.tiktok.com/@roomie/video/123');
  });
});

describe('getTikTokEmbedSrc', () => {
  it('returns official embed v2 URL for valid links', () => {
    expect(getTikTokEmbedSrc('https://www.tiktok.com/@u/video/7123456789012345678')).toBe(
      'https://www.tiktok.com/embed/v2/7123456789012345678',
    );
  });

  it('rejects invalid stored values', () => {
    expect(getTikTokEmbedSrc('https://vm.tiktok.com/ZMabc/')).toBeNull();
    expect(getTikTokEmbedSrc('javascript:alert(1)')).toBeNull();
    expect(getTikTokEmbedSrc('https://www.tiktok.com/embed/v2/1')).toBeNull();
  });
});
