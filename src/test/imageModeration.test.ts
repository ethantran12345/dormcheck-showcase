/**
 * The fail-closed contract of the shared image screen.
 *
 * Every one of these asserts the same thing from a different angle: there is no
 * input, no error and no timeout that turns "we could not check this image" into
 * a published URL. If one of these ever goes green by returning a URL, an
 * unscreened image can reach a public-read bucket.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  getPublicUrl: vi.fn(),
  invoke: vi.fn(),
  fromBucket: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => {
        mocks.fromBucket(bucket);
        return {
          upload: mocks.upload,
          remove: mocks.remove,
          getPublicUrl: mocks.getPublicUrl,
        };
      },
    },
    functions: { invoke: mocks.invoke },
  },
}));

import {
  ImageRejectedError,
  MODERATION_BATCH_SIZE,
  screenImageUrls,
  uploadAndScreen,
} from '@/lib/imageModeration';

const PUBLIC_URL = 'https://proj.supabase.co/storage/v1/object/public/avatars/u/1.jpg';

function aFile() {
  return new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.getPublicUrl.mockReturnValue({ data: { publicUrl: PUBLIC_URL } });
  mocks.invoke.mockResolvedValue({ data: { decision: 'approve' }, error: null });
});

describe('screenImageUrls', () => {
  it('approves only when the function says approve', async () => {
    const result = await screenImageUrls([PUBLIC_URL], 'profile_photo', 'user-1');
    expect(result).toEqual({ approved: true, decision: 'approve', reason: '' });
    expect(mocks.invoke).toHaveBeenCalledWith('moderate-image', {
      body: { image_urls: [PUBLIC_URL], context: 'profile_photo', content_id: 'user-1' },
    });
  });

  it.each(['reject', 'hold'] as const)('refuses on a %s verdict', async (decision) => {
    mocks.invoke.mockResolvedValue({ data: { decision }, error: null });
    const result = await screenImageUrls([PUBLIC_URL], 'dm_photo');
    expect(result.approved).toBe(false);
    expect(result.decision).toBe(decision);
  });

  it('refuses when the edge function returns a transport error', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new Error('502') });
    const result = await screenImageUrls([PUBLIC_URL], 'dm_photo');
    expect(result).toMatchObject({ approved: false, decision: 'unavailable' });
  });

  it('refuses when the invoke call throws outright', async () => {
    mocks.invoke.mockRejectedValue(new Error('network down'));
    const result = await screenImageUrls([PUBLIC_URL], 'setup_photo');
    expect(result).toMatchObject({ approved: false, decision: 'unavailable' });
  });

  it('refuses on an unrecognised payload rather than assuming approval', async () => {
    mocks.invoke.mockResolvedValue({ data: { verdict: 'fine' }, error: null });
    const result = await screenImageUrls([PUBLIC_URL], 'dorm_photo');
    expect(result).toMatchObject({ approved: false, decision: 'unavailable' });
  });

  it('refuses when the screen never comes back', async () => {
    vi.useFakeTimers();
    mocks.invoke.mockReturnValue(new Promise(() => {}));
    const pending = screenImageUrls([PUBLIC_URL], 'business_image');
    await vi.advanceTimersByTimeAsync(25_000);
    await expect(pending).resolves.toMatchObject({ approved: false, decision: 'unavailable' });
  });

  it('batches past the cap instead of silently skipping the tail', async () => {
    const urls = Array.from({ length: MODERATION_BATCH_SIZE + 1 }, (_, i) => `${PUBLIC_URL}?${i}`);
    await screenImageUrls(urls, 'roommate_post_photo');
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    const screened = mocks.invoke.mock.calls.flatMap((c) => c[1].body.image_urls);
    expect(screened).toEqual(urls);
  });

  it('refuses the whole set when any batch refuses', async () => {
    mocks.invoke
      .mockResolvedValueOnce({ data: { decision: 'approve' }, error: null })
      .mockResolvedValueOnce({ data: { decision: 'reject' }, error: null });
    const urls = Array.from({ length: MODERATION_BATCH_SIZE + 1 }, (_, i) => `${PUBLIC_URL}?${i}`);
    await expect(screenImageUrls(urls, 'roommate_post_photo')).resolves.toMatchObject({
      approved: false,
    });
  });
});

describe('uploadAndScreen', () => {
  it('returns the public URL when the screen approves', async () => {
    await expect(
      uploadAndScreen({
        bucket: 'avatars',
        path: 'u/1.jpg',
        file: aFile(),
        context: 'profile_photo',
      }),
    ).resolves.toBe(PUBLIC_URL);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('deletes the object and throws when the screen is unavailable', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new Error('boom') });
    await expect(
      uploadAndScreen({
        bucket: 'avatars',
        path: 'u/1.jpg',
        file: aFile(),
        context: 'profile_photo',
      }),
    ).rejects.toBeInstanceOf(ImageRejectedError);
    expect(mocks.remove).toHaveBeenCalledWith(['u/1.jpg']);
  });

  it('still throws when the cleanup delete itself fails', async () => {
    mocks.invoke.mockResolvedValue({ data: { decision: 'reject' }, error: null });
    mocks.remove.mockResolvedValue({ error: new Error('storage down') });
    await expect(
      uploadAndScreen({
        bucket: 'avatars',
        path: 'u/1.jpg',
        file: aFile(),
        context: 'profile_photo',
      }),
    ).rejects.toBeInstanceOf(ImageRejectedError);
  });

  it('does not screen, or return a URL, when the upload itself failed', async () => {
    mocks.upload.mockResolvedValue({ error: new Error('quota') });
    await expect(
      uploadAndScreen({
        bucket: 'avatars',
        path: 'u/1.jpg',
        file: aFile(),
        context: 'profile_photo',
      }),
    ).rejects.toThrow('quota');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
