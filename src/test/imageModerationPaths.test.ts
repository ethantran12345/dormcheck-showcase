/**
 * One fail-closed proof per image upload path.
 *
 * Before 2026-08-06 only marketplace listings were screened. The retired
 * roommate-post composer has since been removed; six live image paths remain,
 * and the other five now route through the shared fail-closed screen instead of
 * publishing unchecked objects from public-read buckets. These tests stop that
 * from silently coming back:
 * for every path, a moderation provider error must leave the image unpublished
 * and the uploaded object deleted.
 *
 * The DM path that lives in a lib is driven directly. The four that live inside
 * large page components are covered two ways instead of by rendering them: the
 * shared helper is exercised with that path's real bucket + context, and the
 * component source is asserted to route through the helper and to contain no raw
 * unscreened upload. Marketplace retains its pending-review edge-function path.
 * The last test is the repo-wide guard for any newly added raw upload path.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
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

import { uploadDmPhoto } from '@/lib/dmPhotos';
import { DM_AUDIO_BUCKET, uploadDmAudio } from '@/lib/dmAudio';
import {
  ImageRejectedError,
  type ImageModerationContext,
  uploadAndScreen,
} from '@/lib/imageModeration';

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_URL = 'https://proj.supabase.co/storage/v1/object/public/b/u/1.jpg';

/** The provider being down is the scenario every path has to survive closed. */
function providerIsDown() {
  mocks.invoke.mockResolvedValue({ data: null, error: new Error('openai moderation 500') });
}

function aFile(name = 'photo.jpg') {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' });
}

function readSrc(relative: string) {
  return readFileSync(path.join(SRC_DIR, relative), 'utf8');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.getPublicUrl.mockReturnValue({ data: { publicUrl: PUBLIC_URL } });
  mocks.invoke.mockResolvedValue({ data: { decision: 'approve' }, error: null });
});

describe('path: direct message photos', () => {
  it('sends nothing and deletes the object when the screen is unavailable', async () => {
    providerIsDown();
    await expect(uploadDmPhoto('user-1', aFile(), 'seed')).rejects.toBeInstanceOf(
      ImageRejectedError,
    );
    expect(mocks.remove).toHaveBeenCalledWith(['user-1/seed.jpg']);
  });

  it('screens as dm_photo before returning a URL', async () => {
    await expect(uploadDmPhoto('user-1', aFile(), 'seed')).resolves.toBe(PUBLIC_URL);
    expect(mocks.invoke.mock.calls[0][1].body.context).toBe('dm_photo');
    // Blocking, not fire-and-forget: the URL is only handed back after the verdict.
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
});


/**
 * The component-hosted paths. `file` is asserted to route through the helper;
 * `bucket`/`context` are the values that component passes, exercised for real.
 */
const COMPONENT_PATHS: {
  name: string;
  file: string;
  bucket: string;
  context: ImageModerationContext;
}[] = [
  {
    name: 'profile avatar + profile photos',
    file: 'components/profile/ProfileEditFields.tsx',
    bucket: 'avatars',
    context: 'profile_photo',
  },
  {
    name: 'room setup photos',
    file: 'components/dorm-portal/StudentSetupsTab.tsx',
    bucket: 'setup-photos',
    context: 'setup_photo',
  },
  {
    name: 'business logo + banner',
    file: 'components/marketplace/BusinessListingForm.tsx',
    bucket: 'business-logos',
    context: 'business_image',
  },
  {
    name: 'admin dorm photos',
    file: 'components/admin/PhotoUpload.tsx',
    bucket: 'dorm-photos',
    context: 'dorm_photo',
  },
];

describe.each(COMPONENT_PATHS)('path: $name', ({ file, bucket, context }) => {
  it('returns no URL and deletes the object when the screen is unavailable', async () => {
    providerIsDown();
    await expect(
      uploadAndScreen({ bucket, path: 'u/1.jpg', file: aFile(), context }),
    ).rejects.toBeInstanceOf(ImageRejectedError);
    expect(mocks.fromBucket).toHaveBeenCalledWith(bucket);
    expect(mocks.remove).toHaveBeenCalledWith(['u/1.jpg']);
  });

  it('routes its upload through the screen', () => {
    const source = readSrc(file);
    expect(source).toContain('uploadAndScreen');
    expect(source).toContain(`'${context}'`);
    expect(source).not.toMatch(/storage\s*\.\s*from\([^)]*\)\s*\.?\s*\n?\s*\.?upload\(/);
  });
});

describe('room setup post-upload cleanup', () => {
  it('removes newly uploaded objects when the setup row cannot be persisted', () => {
    const source = readSrc('components/dorm-portal/StudentSetupsTab.tsx');
    expect(source).toContain('const uploadedPaths: string[] = []');
    expect(source).toContain('uploadedPaths.push(fileName)');
    expect(source).toMatch(/catch \(error\)[\s\S]*?from\('setup-photos'\)[\s\S]*?\.remove\(uploadedPaths\)/);
  });
});

/**
 * The new-path guard. A raw `storage.from(...).upload(...)` is how an
 * unscreened image gets into a public bucket, so the set of exceptions is
 * enumerated here rather than left to review. Private voice clips are the one
 * non-image exception: their `dm-audio` bucket is participant-only and the
 * source migration grants report-gated human moderation access, rather than
 * sending student audio to the image-moderation provider.
 */
describe('no unscreened upload call sites', () => {
  const ALLOWED = new Set([
    // The screen itself.
    'lib/imageModeration.ts',
    // Marketplace listings: land as pending_review and are screened by the
    // moderate-listing edge function before the feed can show them.
    'hooks/useMyListings.ts',
    // Private participant-only audio; report-gated human moderation is covered
    // by supabase/tests/dm_audio_and_polls_rls.test.sql.
    'lib/dmAudio.ts',
  ]);

  it('every raw storage upload lives in a file that screens it', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const rel = path.relative(SRC_DIR, full).split(path.sep).join('/');
        // src/test/** never uploads; it only ever describes uploads, including
        // the pattern this very check greps for.
        if (rel.startsWith('test/') || ALLOWED.has(rel)) continue;
        const source = readFileSync(full, 'utf8');
        if (/storage[\s\S]{0,120}?\.upload\(/.test(source)) offenders.push(rel);
      }
    };
    walk(SRC_DIR);
    expect(offenders).toEqual([]);
  });

  it('keeps the private-audio exception non-public and in its dedicated bucket', async () => {
    await uploadDmAudio({
      conversationId: 'conversation',
      userId: 'user',
      audio: new Blob(['voice'], { type: 'audio/mp4' }),
      durationMs: 1_000,
    });
    expect(mocks.fromBucket).toHaveBeenCalledWith(DM_AUDIO_BUCKET);
    expect(mocks.getPublicUrl).not.toHaveBeenCalled();
    expect(readSrc('lib/dmAudio.ts')).not.toContain('getPublicUrl');
  });
});
