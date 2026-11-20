import { beforeEach, describe, expect, it, vi } from 'vitest';

const remove = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    storage: {
      from: vi.fn(() => ({
        remove,
        upload: vi.fn(),
      })),
    },
  },
}));

vi.mock('@/lib/imageModeration', () => ({ uploadAndScreen: vi.fn() }));

const { deleteDmPhoto } = await import('@/lib/dmPhotos');
const { deleteDmAudio, uploadDmAudio, MAX_DM_AUDIO_BYTES } = await import('@/lib/dmAudio');

describe('message attachment resilience', () => {
  beforeEach(() => {
    remove.mockReset();
    remove.mockResolvedValue({ error: null });
  });

  it('deletes a DM photo object by its exact path after a failed message commit', async () => {
    await deleteDmPhoto('user-1/photo.jpg');
    expect(remove).toHaveBeenCalledWith(['user-1/photo.jpg']);
  });

  it('deletes a private DM audio object by its exact path after a failed message commit', async () => {
    await deleteDmAudio('conversation/user-1/clip.m4a');
    expect(remove).toHaveBeenCalledWith(['conversation/user-1/clip.m4a']);
  });

  it('rejects oversized audio before Storage is called', async () => {
    const audio = new Blob([new Uint8Array(MAX_DM_AUDIO_BYTES + 1)], { type: 'audio/mp4' });
    await expect(uploadDmAudio({
      conversationId: 'conversation',
      userId: 'user-1',
      audio,
      durationMs: 1_000,
    })).rejects.toThrow('smaller than 15 MB');
  });

  it('surfaces cleanup failures instead of falsely reporting that an orphan was removed', async () => {
    remove.mockResolvedValueOnce({ error: new Error('remove failed') });
    await expect(deleteDmPhoto('user-1/photo.jpg')).rejects.toThrow('remove failed');
  });
});
