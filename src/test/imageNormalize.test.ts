/**
 * HEIC uploads (A3, 2026-10-12): a HEIC file is converted to JPEG before upload or
 * refused with ONE clear toast; everything else passes through untouched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));
vi.mock('@/i18n', () => ({ default: { t: (k: string) => k } }));

const convert = vi.fn();
vi.mock('@/lib/heicConvert', () => ({ convertHeicToJpeg: (f: File) => convert(f) }));

import { isHeic, normalizeImageFile, normalizeImageFiles } from '@/lib/imageNormalize';

const file = (name: string, type: string) => new File([new Uint8Array([1, 2, 3])], name, { type });
const jpegFrom = (f: File) => file(f.name.replace(/\.\w+$/, '.jpg'), 'image/jpeg');

beforeEach(() => {
  toastError.mockReset();
  convert.mockReset();
});

describe('isHeic', () => {
  it('recognises HEIC/HEIF by type, and by extension when the browser gives no type', () => {
    expect(isHeic(file('a.heic', 'image/heic'))).toBe(true);
    expect(isHeic(file('a.HEIF', 'image/heif'))).toBe(true);
    expect(isHeic(file('IMG_0001.HEIC', ''))).toBe(true);
    expect(isHeic(file('IMG_0001.heic', 'application/octet-stream'))).toBe(true);
  });
  it('leaves ordinary images alone', () => {
    expect(isHeic(file('a.jpg', 'image/jpeg'))).toBe(false);
    expect(isHeic(file('a.png', 'image/png'))).toBe(false);
    // A real JPEG named .heic by mistake is trusted by its type.
    expect(isHeic(file('a.heic', 'image/jpeg'))).toBe(false);
  });
});

describe('normalizeImageFiles', () => {
  it('passes non-HEIC files through as the same objects, without loading the converter', async () => {
    const files = [file('a.jpg', 'image/jpeg'), file('b.png', 'image/png')];
    await expect(normalizeImageFiles(files)).resolves.toBe(files);
    expect(convert).not.toHaveBeenCalled();
  });

  it('converts a HEIC to JPEG and keeps order with its neighbours', async () => {
    convert.mockImplementation(async (f: File) => jpegFrom(f));
    const out = await normalizeImageFiles([file('a.jpg', 'image/jpeg'), file('IMG_1.HEIC', 'image/heic')]);
    expect(out.map((f) => [f.name, f.type])).toEqual([
      ['a.jpg', 'image/jpeg'],
      ['IMG_1.jpg', 'image/jpeg'],
    ]);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('refuses a HEIC this browser cannot decode: dropped, one clear toast for the batch', async () => {
    convert.mockRejectedValue(new Error('this browser cannot decode HEIC'));
    const out = await normalizeImageFiles([
      file('a.heic', 'image/heic'),
      file('b.jpg', 'image/jpeg'),
      file('c.heic', ''),
    ]);
    expect(out.map((f) => f.name)).toEqual(['b.jpg']);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith('common:toast.heicUnsupported');
  });
});

describe('normalizeImageFile', () => {
  it('returns null (treated as a cancelled pick) when a HEIC is refused', async () => {
    convert.mockRejectedValue(new Error('nope'));
    await expect(normalizeImageFile(file('a.heic', 'image/heic'))).resolves.toBeNull();
    expect(toastError).toHaveBeenCalledTimes(1);
  });
  it('returns the converted JPEG', async () => {
    convert.mockImplementation(async (f: File) => jpegFrom(f));
    const out = await normalizeImageFile(file('a.heic', 'image/heic'));
    expect(out?.type).toBe('image/jpeg');
  });
});

describe('heicConvert (real module, injected decoder)', () => {
  it('names the JPEG after the source and refuses an empty encode', async () => {
    const real = await vi.importActual<typeof import('@/lib/heicConvert')>('@/lib/heicConvert');
    expect(real.jpegNameFor('IMG_0001.HEIC')).toBe('IMG_0001.jpg');
    expect(real.jpegNameFor('.heic')).toMatch(/^photo-\d+\.jpg$/);
    const ok = await real.convertHeicToJpeg(file('x.heic', 'image/heic'), async () => new Blob([new Uint8Array([9])], { type: 'image/jpeg' }));
    expect([ok.name, ok.type]).toEqual(['x.jpg', 'image/jpeg']);
    await expect(real.convertHeicToJpeg(file('x.heic', 'image/heic'), async () => new Blob([]))).rejects.toThrow(/empty/);
  });
});
