import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';

const MAX_PHOTOS = 6;
const MAX_EDGE_PX = 1280;
const JPEG_QUALITY = 0.7;

type RoomPhoto = { dataUrl: string; takenAt: string };

/** Downscale to a storable JPEG data URL so a set of photos fits localStorage. */
async function fileToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

/**
 * Timestamped room-condition photos for the move-out walkthrough - the
 * student's evidence if a damage charge shows up later. Device-local
 * (localStorage) so it works offline on move-out day; capped and downscaled
 * to stay inside the storage quota.
 */
export function RoomPhotoCapture() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const storageKey = user ? `dormcheck_room_photos_${user.id}` : null;
  const [photos, setPhotos] = useState<RoomPhoto[]>([]);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setPhotos(JSON.parse(raw) as RoomPhoto[]);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  const persist = (next: RoomPhoto[]) => {
    setPhotos(next);
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      toast.error(t("checklist:roomPhoto.storageError"));
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setSaving(true);
    try {
      const room = MAX_PHOTOS - photos.length;
      const added: RoomPhoto[] = [];
      for (const file of Array.from(files).slice(0, room)) {
        added.push({ dataUrl: await fileToDataUrl(file), takenAt: new Date().toISOString() });
      }
      if (files.length > room) toast(t("checklist:roomPhoto.maxPhotosToast", { room }));
      persist([...photos, ...added]);
    } catch {
      toast.error(t("checklist:roomPhoto.readError"));
    } finally {
      setSaving(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="mt-2 rounded-lg bg-muted/60 p-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        aria-label={t("checklist:roomPhoto.addAriaLabel")}
        onChange={(e) => void handleFiles(e.target.files)}
      />
      {photos.length > 0 && (
        <ul className="mb-3 grid grid-cols-3 gap-2">
          {photos.map((p, i) => (
            <li key={p.takenAt + i} className="relative">
              <img
                src={p.dataUrl}
                alt={`Room condition ${i + 1} of ${photos.length}, taken ${new Date(p.takenAt).toLocaleDateString()}`}
                className="aspect-square w-full rounded-md object-cover"
              />
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] tabular-nums text-white">
                {new Date(p.takenAt).toLocaleDateString()}
              </span>
              <Button
                type="button"
                variant="ghost"
                aria-label={t("checklist:roomPhoto.deleteAriaLabel", { n: i + 1 })}
                // [&_svg]:size-3.5 keeps the 14px trash glyph off the base [&_svg]:size-4.
                className="absolute right-1 top-1 h-auto rounded-full bg-black/60 p-1 text-white transition-colors hover:bg-black/80 hover:text-white [&_svg]:size-3.5"
                onClick={() => persist(photos.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={saving || photos.length >= MAX_PHOTOS}
          onClick={() => inputRef.current?.click()}
        >
          <Camera className="mr-1.5 h-4 w-4" aria-hidden />
          {photos.length ? t("checklist:roomPhoto.addAnother") : t("checklist:roomPhoto.takePhotos")}
        </Button>
        <p className="text-xs text-muted-foreground">
          {t("checklist:roomPhoto.description")}
        </p>
      </div>
    </div>
  );
}
