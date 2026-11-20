import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  Camera,
  CameraErrorCode,
  CameraResultType,
  CameraSource,
  type GalleryPhoto,
  type Photo,
} from '@capacitor/camera';
import { normalizeImageFile, normalizeImageFiles } from '@/lib/imageNormalize';

export type ImageSource = 'prompt' | 'camera' | 'library';

export type ImagePickOptions = {
  source?: ImageSource;
  quality?: number;
  allowEditing?: boolean;
  limit?: number;
  accept?: string;
  capture?: 'user' | 'environment';
};

export type UseImageUploadReturn = {
  isNative: boolean;
  /**
   * False once we know this device has no usable camera - the iOS Simulator, a
   * desktop browser with no webcam. Optimistic until proven otherwise, so the
   * capture affordance is hidden the moment the platform tells us it can't.
   */
  isCameraAvailable: boolean;
  pickOne: (options?: Omit<ImagePickOptions, 'limit'>) => Promise<File | null>;
  pickMany: (options?: ImagePickOptions) => Promise<File[]>;
};

export type ImageUploadErrorCode = 'permission-denied' | 'camera-unavailable' | 'unknown';

export class ImageUploadError extends Error {
  code: ImageUploadErrorCode;
  nativeCode?: string;
  cause?: unknown;

  constructor(message: string, code: ImageUploadErrorCode, nativeCode?: string, cause?: unknown) {
    super(message);
    this.name = 'ImageUploadError';
    this.code = code;
    this.nativeCode = nativeCode;
    this.cause = cause;
  }
}

/**
 * Callers should branch on this, never on `error.message` - the message is a
 * developer-facing default and translating from it is what leaked "pickOne"
 * into a user's toast.
 */
export function imageUploadErrorCode(error: unknown): ImageUploadErrorCode {
  return error instanceof ImageUploadError ? error.code : 'unknown';
}

const DEFAULT_ACCEPT = 'image/*';
const DEFAULT_QUALITY = 70;
const DEFAULT_LIMIT = 5;

type NativeCameraError = Error & { code?: string; message?: string };

/**
 * Camera availability is a device fact, not component state, so it lives at
 * module scope and is shared by every `useImageUpload()` caller. It latches
 * false once (a device does not grow a camera mid-session) and is read through
 * `useSyncExternalStore` so a failure in one field hides the capture button
 * everywhere at once.
 */
let cameraKnownUnavailable = false;
const cameraAvailabilityListeners = new Set<() => void>();

function notifyCameraAvailabilityChanged(): void {
  cameraAvailabilityListeners.forEach((listener) => listener());
}

function subscribeToCameraAvailability(listener: () => void): () => void {
  cameraAvailabilityListeners.add(listener);
  return () => {
    cameraAvailabilityListeners.delete(listener);
  };
}

function getCameraAvailability(): boolean {
  return !cameraKnownUnavailable;
}

/**
 * Web-only pre-flight: a desktop browser with no webcam should never show a
 * "Take a photo" affordance. `enumerateDevices` needs no permission (it just
 * withholds labels), and on native we stay optimistic - iOS only tells us via a
 * `NoCameraAvailable` rejection.
 */
async function probeWebCamera(): Promise<void> {
  if (cameraKnownUnavailable) return;
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    cameraKnownUnavailable = true;
    notifyCameraAvailabilityChanged();
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (!devices.some((device) => device.kind === 'videoinput')) {
      cameraKnownUnavailable = true;
      notifyCameraAvailabilityChanged();
    }
  } catch {
    // An enumeration failure is not proof of absence - stay optimistic and let
    // the pick attempt classify it.
  }
}

function normalizeFormat(format?: string | null): string | null {
  if (!format) return null;
  const normalized = format.trim().toLowerCase();
  if (normalized === 'jpeg') return 'jpg';
  return normalized || null;
}

function formatToMimeType(format?: string | null): string {
  switch (normalizeFormat(format)) {
    case 'jpg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    default:
      return 'image/jpeg';
  }
}

function mimeTypeToExtension(mimeType?: string | null): string | null {
  if (!mimeType) return null;
  const normalized = mimeType.toLowerCase();
  switch (normalized) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'image/heic':
      return 'heic';
    case 'image/heif':
      return 'heif';
    default:
      return null;
  }
}

function extensionFromPath(path?: string | null): string | null {
  if (!path) return null;
  try {
    const cleanPath = path.split('?')[0];
    const lastSegment = cleanPath.split('/').pop();
    if (!lastSegment || !lastSegment.includes('.')) return null;
    return normalizeFormat(lastSegment.split('.').pop() ?? null);
  } catch {
    return null;
  }
}

export function generateFilename(options?: {
  path?: string | null;
  format?: string | null;
  mimeType?: string | null;
}): string {
  const ext =
    mimeTypeToExtension(options?.mimeType) ??
    normalizeFormat(options?.format) ??
    extensionFromPath(options?.path) ??
    'jpg';

  return `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
}

function mapSource(source: ImageSource): CameraSource {
  switch (source) {
    case 'camera':
      return CameraSource.Camera;
    case 'library':
      return CameraSource.Photos;
    case 'prompt':
    default:
      return CameraSource.Prompt;
  }
}

function isCancelledError(error: unknown): boolean {
  const nativeError = error as NativeCameraError | undefined;
  const code = nativeError?.code;
  const message = nativeError?.message?.toLowerCase() ?? '';

  return (
    code === CameraErrorCode.TakePhotoCancelled ||
    code === CameraErrorCode.ChooseMediaCancelled ||
    code === CameraErrorCode.EditPhotoCancelled ||
    message.includes('cancel')
  );
}

function isPermissionDeniedError(error: unknown): boolean {
  const nativeError = error as NativeCameraError | undefined;
  const code = nativeError?.code;
  const message = nativeError?.message?.toLowerCase() ?? '';

  return (
    code === CameraErrorCode.CameraPermissionDenied ||
    code === CameraErrorCode.GalleryPermissionDenied ||
    (message.includes('permission') && message.includes('denied'))
  );
}

function isCameraUnavailableError(error: unknown): boolean {
  const nativeError = error as NativeCameraError | undefined;
  const code = nativeError?.code;
  const message = nativeError?.message?.toLowerCase() ?? '';

  return (
    code === CameraErrorCode.NoCameraAvailable ||
    message.includes('no camera') ||
    message.includes('camera not available') ||
    // The iOS Simulator has no capture device and says so in prose, not a code.
    message.includes('simulator')
  );
}

function classifyError(error: unknown): ImageUploadErrorCode {
  if (isPermissionDeniedError(error)) return 'permission-denied';
  if (isCameraUnavailableError(error)) return 'camera-unavailable';
  return 'unknown';
}

const ERROR_MESSAGES: Record<ImageUploadErrorCode, string> = {
  'permission-denied': 'Photo access was denied.',
  'camera-unavailable': 'This device has no camera available.',
  unknown: 'Something went wrong reading that photo.',
};

/**
 * `operation` stays out of the message on purpose - it is an internal function
 * name and used to leak into user-facing toasts. Callers translate from `code`.
 */
function toImageUploadError(error: unknown, operation: 'pickOne' | 'pickMany'): ImageUploadError {
  const nativeError = error as NativeCameraError | undefined;
  const code = classifyError(error);

  if (code === 'camera-unavailable') {
    cameraKnownUnavailable = true;
    notifyCameraAvailabilityChanged();
  }

  console.error(`[useImageUpload] ${operation} failed (${code})`, error);

  return new ImageUploadError(ERROR_MESSAGES[code], code, nativeError?.code, error);
}

function trimFilesToLimit(files: File[], limit?: number): File[] {
  if (typeof limit !== 'number' || limit <= 0) return files;
  return files.slice(0, limit);
}

async function fileFromWebPath(
  webPath: string,
  options?: { path?: string | null; format?: string | null }
): Promise<File> {
  const response = await fetch(webPath);
  if (!response.ok) {
    throw new Error(`Unable to read selected image: ${response.status} ${response.statusText}`);
  }

  const blob = await response.blob();
  const mimeType = blob.type || formatToMimeType(options?.format);
  const filename = generateFilename({
    path: options?.path ?? webPath,
    format: options?.format,
    mimeType,
  });

  return new File([blob], filename, { type: mimeType });
}

function buildInputCapture(source: ImageSource, capture?: 'user' | 'environment'): 'user' | 'environment' | null {
  if (source !== 'camera') return null;
  return capture ?? 'environment';
}

function pickFilesOnWeb(options: {
  accept: string;
  multiple: boolean;
  capture: 'user' | 'environment' | null;
}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = options.accept;
    input.multiple = options.multiple;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.opacity = '0';

    if (options.capture) {
      input.setAttribute('capture', options.capture);
    }

    let settled = false;

    const cleanup = () => {
      input.removeEventListener('change', handleChange);
      window.removeEventListener('focus', handleFocus);
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
    };

    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(files);
    };

    const handleChange = () => {
      finish(Array.from(input.files ?? []));
    };

    const handleFocus = () => {
      window.setTimeout(() => {
        finish(Array.from(input.files ?? []));
      }, 300);
    };

    input.addEventListener('change', handleChange);
    window.addEventListener('focus', handleFocus, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

async function photoToFile(photo: Photo): Promise<File> {
  if (!photo.webPath) {
    throw new Error('Selected photo did not include a usable webPath.');
  }

  return fileFromWebPath(photo.webPath, {
    path: photo.path ?? photo.webPath,
    format: photo.format,
  });
}

async function galleryPhotoToFile(photo: GalleryPhoto): Promise<File> {
  return fileFromWebPath(photo.webPath, {
    path: photo.path ?? photo.webPath,
    format: photo.format,
  });
}

export function useImageUpload(): UseImageUploadReturn {
  const isNative = Capacitor.isNativePlatform();
  const isCameraAvailable = useSyncExternalStore(
    subscribeToCameraAvailability,
    getCameraAvailability,
    getCameraAvailability
  );

  useEffect(() => {
    if (isNative) return;
    void probeWebCamera();
  }, [isNative]);

  const pickOne = useCallback<UseImageUploadReturn['pickOne']>(
    async (options) => {
      const {
        source = 'prompt',
        quality = DEFAULT_QUALITY,
        allowEditing = false,
        accept = DEFAULT_ACCEPT,
        capture,
      } = options ?? {};

      if (!isNative) {
        const files = await pickFilesOnWeb({
          accept,
          multiple: false,
          capture: buildInputCapture(source, capture),
        });
        // HEIC → JPEG, or a clear refusal (null, like a cancel). See imageNormalize.ts.
        return files[0] ? normalizeImageFile(files[0]) : null;
      }

      try {
        const photo = await Camera.getPhoto({
          source: mapSource(source),
          quality,
          allowEditing,
          resultType: CameraResultType.Uri,
        });

        return await normalizeImageFile(await photoToFile(photo));
      } catch (error) {
        if (isCancelledError(error)) return null;
        throw toImageUploadError(error, 'pickOne');
      }
    },
    [isNative]
  );

  const pickMany = useCallback<UseImageUploadReturn['pickMany']>(
    async (options) => {
      const {
        source = 'library',
        quality = DEFAULT_QUALITY,
        allowEditing = false,
        limit = DEFAULT_LIMIT,
        accept = DEFAULT_ACCEPT,
        capture,
      } = options ?? {};

      if (!isNative) {
        const files = await pickFilesOnWeb({
          accept,
          multiple: true,
          capture: buildInputCapture(source, capture),
        });
        return normalizeImageFiles(trimFilesToLimit(files, limit));
      }

      if (source === 'camera') {
        const file = await pickOne({ source: 'camera', quality, allowEditing, accept, capture });
        return file ? [file] : [];
      }

      if (source === 'prompt') {
        console.warn(
          '[useImageUpload] Native pickMany does not support a prompt source. Falling back to the photo library.'
        );
      }

      try {
        const result = await Camera.pickImages({
          quality,
          limit,
        });

        return await normalizeImageFiles(
          await Promise.all((result.photos ?? []).map((photo) => galleryPhotoToFile(photo)))
        );
      } catch (error) {
        if (isCancelledError(error)) return [];
        throw toImageUploadError(error, 'pickMany');
      }
    },
    [isNative, pickOne]
  );

  return useMemo(
    () => ({
      isNative,
      isCameraAvailable,
      pickOne,
      pickMany,
    }),
    [isNative, isCameraAvailable, pickOne, pickMany]
  );
}
