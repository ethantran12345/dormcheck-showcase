/**
 * Quarantine bookkeeping (BA-07, docs/audits/backend-audit-2026-09-06.md).
 *
 * The bucket registry and the pure path/clock helpers are the part of the CSAM
 * preservation path that can be asserted without a stack. The load-bearing pin is
 * the first block: account deletion's purge list must NEVER contain the quarantine
 * bucket, because objects there are held under a statutory one-year clock that does
 * not end when the uploader deletes their account.
 */
import { describe, it, expect } from 'vitest';
import {
  USER_FOLDER_BUCKETS,
  PRESERVED_BUCKETS,
  QUARANTINE_BUCKET,
  HELD_BUCKET,
  isPreservedBucket,
  purgeableUserBuckets,
  purgeableOwnerBuckets,
  sweepableBuckets,
} from '../../supabase/functions/_shared/storageBuckets';
import {
  PRESERVE_DAYS,
  imageDisposition,
  mustPreserve,
  parsePublicStorageUrl,
  quarantinePathFor,
  preserveUntil,
} from '../../supabase/functions/_shared/quarantine';

describe('storage bucket registry', () => {
  it('never purges the quarantine bucket, whatever the user-folder list says', () => {
    expect(QUARANTINE_BUCKET).toBe('images-quarantine');
    expect(PRESERVED_BUCKETS).toContain('images-quarantine');
    expect(isPreservedBucket('images-quarantine')).toBe(true);
    expect(purgeableUserBuckets()).not.toContain('images-quarantine');
    for (const b of purgeableUserBuckets()) expect(isPreservedBucket(b)).toBe(false);
  });
  it('pins the purge list, so a change to what account deletion removes is a conscious edit here too', () => {
    expect([...USER_FOLDER_BUCKETS]).toEqual([
      'avatars',
      'setup-photos',
      'academic-planners',
      'business-banners',
      'business-logos',
      'marketplace-images',
      'roommate-post-photos',
      'dm-photos',
    ]);
    expect(purgeableUserBuckets()).toEqual([...USER_FOLDER_BUCKETS]);
    expect(purgeableOwnerBuckets()).toEqual(['dorm-photos']);
  });
  it('preserves images-held as well as images-quarantine: no purge list and no sweep list reaches either', () => {
    expect(HELD_BUCKET).toBe('images-held');
    expect([...PRESERVED_BUCKETS]).toEqual(['images-quarantine', 'images-held']);
    for (const list of [purgeableUserBuckets(), purgeableOwnerBuckets(), sweepableBuckets()]) {
      expect(list).not.toContain('images-quarantine');
      expect(list).not.toContain('images-held');
    }
  });
});

describe('imageDisposition (A2: what moderate-image does with the object)', () => {
  it('keeps an approved image', () => {
    expect(imageDisposition('approve', [])).toBe('keep');
  });
  it('quarantines every reject', () => {
    expect(imageDisposition('reject', ['violence/graphic'])).toBe('quarantine');
    expect(imageDisposition('reject', ['sexual/minors'])).toBe('quarantine');
  });
  it('deletes an ordinary hold server-side, including a screen-unavailable hold', () => {
    expect(imageDisposition('hold', ['harassment'])).toBe('delete');
    expect(imageDisposition('hold', [])).toBe('delete');
  });
  it('NEVER deletes a hold flagged sexual/minors: it is quarantined like a reject', () => {
    expect(mustPreserve(['harassment', 'sexual/minors'])).toBe(true);
    expect(imageDisposition('hold', ['sexual/minors'])).toBe('quarantine');
    expect(imageDisposition('hold', ['harassment', 'sexual/minors'])).toBe('quarantine');
  });
});

describe('parsePublicStorageUrl', () => {
  it('splits a public object URL of this project into bucket and path', () => {
    expect(parsePublicStorageUrl('https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/setup-photos/u1/room.jpg'))
      .toEqual({ bucket: 'setup-photos', path: 'u1/room.jpg' });
    expect(parsePublicStorageUrl('http://127.0.0.1:54321/storage/v1/object/public/dm-photos/a/b/c%20d.png'))
      .toEqual({ bucket: 'dm-photos', path: 'a/b/c d.png' });
  });
  it('refuses anything that is not a public storage object', () => {
    expect(parsePublicStorageUrl('https://example.com/image.jpg')).toBeNull();
    expect(parsePublicStorageUrl('https://x.supabase.co/storage/v1/object/sign/setup-photos/u1/room.jpg')).toBeNull();
    expect(parsePublicStorageUrl('https://x.supabase.co/storage/v1/object/public/setup-photos/')).toBeNull();
    expect(parsePublicStorageUrl('https://x.supabase.co/storage/v1/object/public/setup-photos/../etc')).toBeNull();
    expect(parsePublicStorageUrl('not a url')).toBeNull();
  });
});

describe('quarantinePathFor / preserveUntil', () => {
  const now = new Date('2026-09-06T15:04:05.000Z');
  it('files the object by day, context and source, keeping the source path visible', () => {
    const p = quarantinePathFor({ bucket: 'setup-photos', path: 'u1/room.jpg' }, 'setup_photo', now);
    expect(p).toBe(`2026-09-06/setup_photo/setup-photos/${now.getTime()}-u1/room.jpg`);
  });
  it('holds for one year plus a day of slack, never less', () => {
    expect(PRESERVE_DAYS).toBe(366);
    const until = preserveUntil(now);
    expect(until.getTime() - now.getTime()).toBe(366 * 24 * 60 * 60 * 1000);
    expect(until.toISOString().slice(0, 10)).toBe('2027-09-07');
  });
});
