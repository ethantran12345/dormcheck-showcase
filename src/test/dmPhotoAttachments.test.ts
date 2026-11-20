import { describe, expect, it } from 'vitest';
import { parseDmAttachmentMetadata, parseDmMessageMetadata } from '@/types/dmMessageMeta';
import { dmPhotoPath } from '@/lib/dmPhotos';
import { audioDurationLabel, dmAudioPath } from '@/lib/dmAudio';
import { makeDmPoll } from '@/lib/dmPolls';

const UID = 'a1b2c3d4-0000-4000-8000-000000000001';
const file = (name: string) => new File(['x'], name, { type: 'image/jpeg' });

describe('parseDmMessageMetadata', () => {
  it('accepts an image payload and normalizes missing dimensions', () => {
    expect(parseDmMessageMetadata({ type: 'image', url: 'https://x/y.jpg' })).toEqual({
      type: 'image', url: 'https://x/y.jpg', width: null, height: null,
    });
  });

  it('keeps numeric dimensions', () => {
    expect(parseDmMessageMetadata({ type: 'image', url: 'u', width: 800, height: 600 }))
      .toEqual({ type: 'image', url: 'u', width: 800, height: 600 });
  });

  it('rejects anything that is not a usable image payload', () => {
    expect(parseDmMessageMetadata(null)).toBeNull();
    expect(parseDmMessageMetadata({})).toBeNull();
    expect(parseDmMessageMetadata({ type: 'image' })).toBeNull();
    expect(parseDmMessageMetadata({ type: 'image', url: '' })).toBeNull();
    expect(parseDmMessageMetadata({ type: 'instagram', username: 'x' })).toBeNull();
    expect(parseDmMessageMetadata('{"type":"image"}')).toBeNull();
  });
});

describe('DM audio and poll metadata', () => {
  it('keeps legacy image parsing image-only while accepting private audio metadata', () => {
    const audio = { type: 'audio', path: 'conversation/sender/clip.m4a', durationMs: 3_250 };
    expect(parseDmMessageMetadata(audio)).toBeNull();
    expect(parseDmAttachmentMetadata(audio)).toEqual({ ...audio, mimeType: null });
  });

  it('creates the storage path RLS expects and shows compact audio duration', () => {
    expect(dmAudioPath('conversation', UID, 'clip')).toBe(`conversation/${UID}/clip.m4a`);
    expect(audioDurationLabel(65_400)).toBe('1:05');
  });

  it('normalizes a valid poll and rejects duplicate options', () => {
    expect(makeDmPoll('Dinner?', [' 5:00 ', '6:00'])).toEqual({
      type: 'poll', question: 'Dinner?', options: ['5:00', '6:00'],
    });
    expect(() => makeDmPoll('Dinner?', ['5:00', '5:00'])).toThrow('different');
  });
});

describe('dmPhotoPath', () => {
  // The storage policy compares (storage.foldername(name))[1] to auth.uid(),
  // so a path whose first segment is not the uid is rejected by the SERVER.
  it('always puts the uploader uid in the first path segment', () => {
    expect(dmPhotoPath(UID, file('a.jpg'), 'seed').split('/')[0]).toBe(UID);
    expect(dmPhotoPath(UID, file('no-extension'), 'seed').split('/')[0]).toBe(UID);
  });

  it('lowercases the extension', () => {
    expect(dmPhotoPath(UID, file('a.PNG'), 's')).toBe(`${UID}/s.png`);
  });

  it('falls back to the MIME type when the file has no extension', () => {
    // A camera capture frequently arrives as "IMG_0001" with no dot at all;
    // naive split('.').pop() would make the whole name the extension.
    const noExt = new File(['x'], 'IMG_0001', { type: 'image/png' });
    expect(dmPhotoPath(UID, noExt, 's')).toBe(`${UID}/s.png`);
    const nothing = new File(['x'], 'IMG_0001', { type: '' });
    expect(dmPhotoPath(UID, nothing, 's')).toBe(`${UID}/s.jpg`);
  });
});
