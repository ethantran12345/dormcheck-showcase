import { useState, useEffect, useRef } from 'react';
import { Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { uploadAndScreen } from '@/lib/imageModeration';
import { useImageUpload } from '@/hooks/useImageUpload';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { normalizeImageFile } from '@/lib/imageNormalize';

const BUCKET = 'dorm-photos';
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT_IMAGE = 'image/jpeg,image/png,image/webp';
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const URL_REGEX = /^https?:\/\/\S+$/i;

interface PhotoUploadProps {
  currentUrl: string | null;
  onUpload: (newUrl: string) => Promise<void>;
  onRemove: () => Promise<void>;
  onCancel: () => void;
  dormId: number;
  fieldName: 'image_url' | 'floorplan';
  disabled: boolean;
}

function sanitizeName(name: string): string {
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name).replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 60) || 'file';
  const ext = (dot > 0 ? name.slice(dot + 1) : 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  return `${base}.${ext}`;
}

/**
 * If the given URL is a public URL from our dorm-photos bucket, return the storage path.
 * Otherwise return null (don't try to delete external URLs).
 */
function extractBucketPath(url: string): string | null {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}

async function tryDeleteOldFile(oldUrl: string | null) {
  if (!oldUrl) return;
  const path = extractBucketPath(oldUrl);
  if (!path) return;
  try {
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) {
      console.warn('[PhotoUpload] failed to delete old file', path, error.message);
    }
  } catch (err) {
    console.warn('[PhotoUpload] unexpected error deleting old file', err);
  }
}

export function PhotoUpload({
  currentUrl,
  onUpload,
  onRemove,
  onCancel,
  dormId,
  fieldName,
  disabled,
}: PhotoUploadProps) {
  const { pickOne } = useImageUpload();
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pastedUrl, setPastedUrl] = useState(currentUrl ?? '');
  const [savingPaste, setSavingPaste] = useState(false);
  const pasteInputRef = useRef<HTMLInputElement>(null);

  const busy = disabled || uploading || savingPaste;

  useEffect(() => {
    if (pasteMode) {
      pasteInputRef.current?.focus();
    }
  }, [pasteMode]);

  const handleFile = async (file: File) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error('Only JPEG, PNG, or WebP images are allowed.');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('Image must be smaller than 5 MB.');
      return;
    }

    setUploading(true);
    try {
      // Screened before onUpload persists the URL onto the dorm. Admin-supplied
      // photos go straight onto a public dorm page, so the same screen applies
      // here as to a student upload; a refusal deletes the object and throws.
      const path = `${dormId}/${fieldName}/${Date.now()}-${sanitizeName(file.name)}`;
      const publicUrl = await uploadAndScreen({
        bucket: BUCKET,
        path,
        file,
        context: 'dorm_photo',
        upload: { cacheControl: '3600', upsert: false, contentType: file.type },
      });

      await onUpload(publicUrl);

      void tryDeleteOldFile(currentUrl);
    } catch (err) {
      console.error('[PhotoUpload] upload failed', err);
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleBrowse = async () => {
    if (busy) return;
    try {
      const file = await pickOne({ source: 'prompt', accept: ACCEPT_IMAGE });
      if (!file) return;
      await handleFile(file);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Upload failed');
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (busy) return;
    const dropped = e.dataTransfer.files?.[0];
    if (!dropped) return;
    // A dropped .heic is converted to JPEG here, or refused with a clear toast.
    void normalizeImageFile(dropped).then((file) => {
      if (file) void handleFile(file);
    });
  };

  const handleRemove = async () => {
    if (busy) return;
    const oldUrl = currentUrl;
    try {
      await onRemove();
      void tryDeleteOldFile(oldUrl);
    } catch (err) {
      console.error('[PhotoUpload] remove failed', err);
    }
  };

  const savePastedUrl = async () => {
    const trimmed = pastedUrl.trim();
    if (!trimmed) {
      toast.error('Enter a URL or cancel.');
      return;
    }
    if (!URL_REGEX.test(trimmed)) {
      toast.error('Must be a valid URL (https://...).');
      return;
    }
    setSavingPaste(true);
    try {
      await onUpload(trimmed);
    } catch (err) {
      console.error('[PhotoUpload] paste save failed', err);
    } finally {
      setSavingPaste(false);
    }
  };

  if (pasteMode) {
    return (
      <div className="space-y-2">
        <input
          ref={pasteInputRef}
          type="url"
          value={pastedUrl}
          onChange={(e) => setPastedUrl(e.target.value)}
          disabled={busy}
          placeholder="https://..."
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-malachite-600 focus:outline-none focus:ring-1 focus:ring-malachite-600 disabled:opacity-60"
        />
        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            onClick={() => void savePastedUrl()}
            disabled={busy}
            className="bg-malachite-800 text-white hover:bg-malachite-900"
          >
            {savingPaste ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save URL'}
          </Button>
          <button
            type="button"
            onClick={() => setPasteMode(false)}
            disabled={busy}
            className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            Back to upload
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {currentUrl && (
        <div className="flex items-center gap-3">
          <img
            src={currentUrl}
            alt="current"
            className="rounded border border-border object-cover"
            style={{ width: 100, height: 60 }}
          />
          <button
            type="button"
            onClick={() => void handleRemove()}
            disabled={busy}
            aria-label="Clear image"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-60"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => {
          void handleBrowse();
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !busy) {
            e.preventDefault();
            void handleBrowse();
          }
        }}
        className={cn(
          'flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors',
          busy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
          isDragging
            ? 'border-malachite-600 bg-malachite-600/5'
            : 'border-border bg-card hover:border-malachite-600 hover:bg-malachite-600/5',
        )}
      >
        {uploading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin text-malachite-600" />
            <p className="text-sm text-muted-foreground">Uploading…</p>
          </>
        ) : (
          <>
            <Upload className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-foreground">
              Drop an image here, or <span className="font-medium text-malachite-800">click to browse</span>
            </p>
            <p className="text-xs text-muted-foreground">JPEG, PNG, or WebP · max 5 MB</p>
          </>
        )}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={() => {
            setPastedUrl(currentUrl ?? '');
            setPasteMode(true);
          }}
          disabled={busy}
          className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline disabled:opacity-60"
        >
          Or paste a URL
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
