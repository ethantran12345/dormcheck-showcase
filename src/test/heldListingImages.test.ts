/**
 * Held marketplace photos (A2, 20261013000000): the pure path helpers that decide
 * WHICH objects moderate-listing moves into images-held and where an approve puts
 * them back, plus the client's resolution of the function's origin-relative signed
 * URLs. Driven end to end over HTTP in scripts/edge-probe/moderate-listing.probe.mjs.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import {
  HELD_BUCKET,
  HELD_SIGNED_URL_TTL_SECONDS,
  heldPathFor,
  listingObjectPaths,
  sourcePathFromHeld,
} from '../../supabase/functions/_shared/heldImages';
import { absoluteSignedUrl } from '@/lib/heldListingImages';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const LISTING = '33333333-3333-4333-8333-333333333333';
const pub = (bucket: string, path: string) =>
  `https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/${bucket}/${path}`;

describe('listingObjectPaths', () => {
  it("returns only the owner's own marketplace-images objects, deduplicated", () => {
    expect(
      listingObjectPaths(
        [
          pub('marketplace-images', `${OWNER}/a.jpg`),
          pub('marketplace-images', `${OWNER}/a.jpg`),
          pub('marketplace-images', `${OWNER}/b%20c.png`),
        ],
        OWNER,
      ),
    ).toEqual([`${OWNER}/a.jpg`, `${OWNER}/b c.png`]);
  });
  it("never moves another user's photo the listing merely points at", () => {
    expect(listingObjectPaths([pub('marketplace-images', `${OTHER}/theirs.jpg`)], OWNER)).toEqual([]);
  });
  it('ignores other buckets, external URLs, and an empty owner', () => {
    expect(
      listingObjectPaths(
        [pub('avatars', `${OWNER}/me.jpg`), 'https://example.com/x.jpg', 'not a url'],
        OWNER,
      ),
    ).toEqual([]);
    expect(listingObjectPaths([pub('marketplace-images', `${OWNER}/a.jpg`)], '')).toEqual([]);
  });
});

describe('heldPathFor / sourcePathFromHeld', () => {
  it('round-trips a source path through the listing prefix', () => {
    const held = heldPathFor(LISTING, `${OWNER}/a.jpg`);
    expect(held).toBe(`${LISTING}/${OWNER}/a.jpg`);
    expect(sourcePathFromHeld(LISTING, held)).toBe(`${OWNER}/a.jpg`);
  });
  it("refuses a held path that is not this listing's, or that escapes", () => {
    expect(sourcePathFromHeld(LISTING, `${OTHER}/${OWNER}/a.jpg`)).toBeNull();
    expect(sourcePathFromHeld(LISTING, `${LISTING}/`)).toBeNull();
    expect(sourcePathFromHeld(LISTING, `${LISTING}/../x.jpg`)).toBeNull();
  });
  it('uses the private bucket and a short signed-URL lifetime', () => {
    expect(HELD_BUCKET).toBe('images-held');
    expect(HELD_SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(300);
  });
});

describe('absoluteSignedUrl', () => {
  it("resolves the function's origin-relative signed path against the client's origin", () => {
    expect(absoluteSignedUrl('/storage/v1/object/sign/images-held/x/y.jpg?token=t', 'http://127.0.0.1:54321/'))
      .toBe('http://127.0.0.1:54321/storage/v1/object/sign/images-held/x/y.jpg?token=t');
  });
  it('refuses anything that is not a signed images-held path', () => {
    expect(absoluteSignedUrl('/storage/v1/object/public/images-held/x.jpg', 'https://a.co')).toBeNull();
    expect(absoluteSignedUrl('https://evil.example/storage/v1/object/sign/images-held/x', 'https://a.co')).toBeNull();
  });
});
