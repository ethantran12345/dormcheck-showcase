import { useState, useCallback, useMemo, useEffect, useRef, type DragEvent as ReactDragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, GripVertical, ImagePlus, Pencil, Plus, X } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { EditPhotoModal } from '@/components/profile/EditPhotoModal';
import { imageUploadErrorCode, useImageUpload } from '@/hooks/useImageUpload';
import { safeImageSrc } from '@/lib/sanitize';
import { isHeic, normalizeImageFiles } from '@/lib/imageNormalize';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/**
 * Translate from the error's code, never its message - the message is a
 * developer-facing default. `fallback` is the generic copy for this action.
 */
function pickErrorKey(error: unknown, fallback: 'chooseError' | 'takeError'): string {
  switch (imageUploadErrorCode(error)) {
    case 'permission-denied':
      return 'marketplace:photos.toast.permissionDenied';
    case 'camera-unavailable':
      return 'marketplace:photos.toast.cameraUnavailable';
    default:
      return `marketplace:photos.toast.${fallback}`;
  }
}

export type PhotoGalleryItem =
  | { type: 'file'; file: File }
  | { type: 'url'; url: string };

export type PhotoGalleryFieldProps = {
  value: PhotoGalleryItem[];
  onChange: (next: PhotoGalleryItem[]) => void;
  max?: number;
  label?: string;
  disabled?: boolean;
  idPrefix?: string;
  className?: string;
  /** Fired with the move that produced onChange's array, so callers can remap photo-indexed data (e.g. item tags). */
  onReorder?: (oldIndex: number, newIndex: number) => void;
  /** Fired with the removed index alongside onChange, for the same reason. */
  onRemove?: (index: number) => void;
};

function SortableGalleryThumbnail({
  id,
  item,
  objectUrl,
  index,
  disabled,
  onEdit,
  onRemove,
}: {
  id: string;
  item: PhotoGalleryItem;
  objectUrl: string;
  index: number;
  disabled?: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative shrink-0 w-[10.4rem] aspect-[4/3] rounded-lg overflow-hidden border border-border bg-muted',
        isDragging && 'opacity-90 z-50 shadow-overlay',
      )}
    >
      <img
        src={objectUrl}
        alt={index === 0 ? t('marketplace:photos.coverAlt') : t('marketplace:photos.photoAlt', { number: index + 1 })}
        className="w-full h-full object-cover pointer-events-none"
        onError={(e) => {
          e.currentTarget.src = '/placeholder.svg';
        }}
      />
      {index === 0 && (
        <span className="absolute top-1 left-1 px-1.5 py-0.5 text-[10px] font-medium bg-foreground text-background rounded">
          {t('marketplace:photos.coverBadge')}
        </span>
      )}
      <div
        {...attributes}
        {...listeners}
        className={cn(
          'absolute bottom-1 left-1 w-7 h-7 rounded-full bg-card/90 text-foreground flex items-center justify-center hover:bg-card shadow-raised touch-none',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-grab active:cursor-grabbing',
        )}
        aria-label={t('marketplace:photos.dragReorder')}
      >
        <GripVertical className="w-3.5 h-3.5" />
      </div>
      {item.type === 'file' && (
        <button
          type="button"
          onClick={onEdit}
          disabled={disabled}
          className="absolute bottom-1 left-10 w-7 h-7 rounded-full bg-card/90 text-foreground flex items-center justify-center before:absolute before:-inset-1.5 before:content-[''] hover:bg-card shadow-raised disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label={t('marketplace:photos.editPhoto')}
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="absolute top-1 right-1 w-7 h-7 rounded-full bg-card/90 text-foreground flex items-center justify-center before:absolute before:-inset-1.5 before:content-[''] hover:bg-red-500 hover:text-white shadow-raised disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={t('marketplace:photos.removePhoto')}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function PhotoGalleryField({
  value,
  onChange,
  max = 5,
  label,
  disabled = false,
  idPrefix = 'photo-gallery',
  className,
  onReorder,
  onRemove,
}: PhotoGalleryFieldProps) {
  const { t } = useTranslation();
  const { pickMany, pickOne, isCameraAvailable } = useImageUpload();
  const fileUrlCacheRef = useRef<Map<File, string>>(new Map());
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editImageSrc, setEditImageSrc] = useState<string | null>(null);
  const [editIndex, setEditIndex] = useState(0);
  const [isDropActive, setIsDropActive] = useState(false);

  const fileItems = value.filter((x): x is { type: 'file'; file: File } => x.type === 'file');
  const fileObjectUrls = useMemo(() => {
    const cache = fileUrlCacheRef.current;
    return fileItems.map(({ file }) => {
      if (!cache.has(file)) cache.set(file, URL.createObjectURL(file));
      return cache.get(file)!;
    });
  }, [fileItems]);

  useEffect(() => {
    const cache = fileUrlCacheRef.current;
    const currentSet = new Set(fileItems.map((x) => x.file));
    cache.forEach((url, file) => {
      if (!currentSet.has(file)) {
        URL.revokeObjectURL(url);
        cache.delete(file);
      }
    });
  }, [fileItems]);

  useEffect(() => {
    const cache = fileUrlCacheRef.current;
    return () => {
      cache.forEach((url) => URL.revokeObjectURL(url));
      cache.clear();
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const sortableId = useCallback((index: number) => `${idPrefix}-img-${index}`, [idPrefix]);

  const getDisplayUrl = useCallback(
    (item: PhotoGalleryItem, index: number): string => {
      if (item.type === 'url') {
        return safeImageSrc(item.url) || '/placeholder.svg';
      }
      const fileIdx = value.slice(0, index).filter((x) => x.type === 'file').length;
      return fileObjectUrls[fileIdx] ?? '/placeholder.svg';
    },
    [value, fileObjectUrls],
  );

  const handleFileSelect = useCallback(
    (files: File[]) => {
      if (files.length === 0 || disabled) return;
      const toAdd = files.slice(0, max - value.length).map((file) => ({ type: 'file' as const, file }));
      if (value.length + files.length > max) {
        toast.error(t('marketplace:photos.toast.maxPhotos', { max }));
      }
      onChange([...value, ...toAdd].slice(0, max));
    },
    [disabled, max, onChange, value, t],
  );

  const handlePickPhotos = useCallback(async () => {
    if (disabled || value.length >= max) return;
    try {
      const files = await pickMany({ source: 'prompt', limit: max, accept: 'image/*' });
      if (!files.length) return;
      handleFileSelect(files);
    } catch (error) {
      toast.error(t(pickErrorKey(error, 'chooseError')));
    }
  }, [disabled, handleFileSelect, max, pickMany, value.length, t]);

  // Single-shot camera capture - Capacitor's multi-pick is library-only, so this
  // gives the option to take a photo of the item instead of only uploading one.
  const handleTakePhoto = useCallback(async () => {
    if (disabled || value.length >= max) return;
    try {
      const file = await pickOne({ source: 'camera', accept: 'image/*', capture: 'environment' });
      if (!file) return;
      handleFileSelect([file]);
    } catch (error) {
      toast.error(t(pickErrorKey(error, 'takeError')));
    }
  }, [disabled, handleFileSelect, max, pickOne, value.length, t]);

  const removeImage = useCallback(
    (index: number) => {
      if (disabled) return;
      onChange(value.filter((_, i) => i !== index));
      onRemove?.(index);
    },
    [disabled, onChange, onRemove, value],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (disabled) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIdx = value.findIndex((_, i) => sortableId(i) === active.id);
      const newIdx = value.findIndex((_, i) => sortableId(i) === over.id);
      if (oldIdx !== -1 && newIdx !== -1) {
        onChange(arrayMove(value, oldIdx, newIdx));
        onReorder?.(oldIdx, newIdx);
      }
    },
    [disabled, onChange, onReorder, sortableId, value],
  );

  const openEditFile = useCallback(
    (index: number) => {
      if (disabled) return;
      const item = value[index];
      if (item?.type === 'file') {
        const fileIdx = value.slice(0, index).filter((x) => x.type === 'file').length;
        setEditImageSrc(fileObjectUrls[fileIdx] ?? URL.createObjectURL(item.file));
        setEditIndex(index);
        setEditModalOpen(true);
      }
    },
    [disabled, fileObjectUrls, value],
  );

  const handleEditSave = useCallback(
    (blob: Blob) => {
      const file = new File([blob], 'listing-photo.jpg', { type: blob.type });
      const next = [...value];
      const item = next[editIndex];
      if (item?.type === 'file') next[editIndex] = { type: 'file', file };
      onChange(next);
      setEditModalOpen(false);
      if (editImageSrc?.startsWith('blob:')) URL.revokeObjectURL(editImageSrc);
      setEditImageSrc(null);
    },
    [editImageSrc, editIndex, onChange, value],
  );

  const handleEditClose = useCallback(() => {
    setEditModalOpen(false);
    if (editImageSrc?.startsWith('blob:')) URL.revokeObjectURL(editImageSrc);
    setEditImageSrc(null);
  }, [editImageSrc]);

  const canAddMore = value.length < max;
  const isEmpty = value.length === 0;

  const handleDragOver = useCallback(
    (e: ReactDragEvent<HTMLElement>) => {
      if (disabled || !canAddMore) return;
      if (!Array.from(e.dataTransfer.types).includes('Files')) return;
      e.preventDefault();
      setIsDropActive(true);
    },
    [disabled, canAddMore],
  );
  const handleDragLeave = useCallback((e: ReactDragEvent<HTMLElement>) => {
    e.preventDefault();
    setIsDropActive(false);
  }, []);
  const handleDrop = useCallback(
    (e: ReactDragEvent<HTMLElement>) => {
      e.preventDefault();
      setIsDropActive(false);
      if (disabled) return;
      // A dropped .heic often has an empty type in Chrome/Firefox; keep it so
      // normalizeImageFiles can convert it or refuse it clearly.
      const dropped = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/') || isHeic(f));
      if (!dropped.length) return;
      void normalizeImageFiles(dropped).then((files) => {
        if (files.length) handleFileSelect(files);
      });
    },
    [disabled, handleFileSelect],
  );

  return (
    <div className={className}>
      <Label>{label ?? t('marketplace:photos.label')}</Label>
      {isEmpty ? (
        // Two compact, solid media choices match the mental model students
        // already know: take a photo now or choose existing photos. The library
        // choice remains a desktop drop target without looking like an empty box.
        <div
          className="mt-2 grid grid-cols-2 gap-3"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isCameraAvailable && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleTakePhoto()}
              disabled={disabled}
              className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-center transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-6 [&_svg]:text-foreground"
            >
              <Camera strokeWidth={1.75} aria-hidden />
              <span className="text-sm font-semibold text-foreground">{t('marketplace:photos.takePhoto')}</span>
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => void handlePickPhotos()}
            disabled={disabled}
            className={cn(
              'flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-center transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-6 [&_svg]:text-foreground',
              !isCameraAvailable && 'col-span-2',
              isDropActive && 'border-foreground bg-muted',
            )}
            aria-label={t('marketplace:photos.addAria')}
          >
            <ImagePlus strokeWidth={1.75} aria-hidden />
            <span className="text-sm font-semibold text-foreground">{t('marketplace:photos.addPhotos')}</span>
          </Button>
        </div>
      ) : (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            'mt-2 flex min-h-[120px] gap-x-3 gap-y-2 overflow-x-auto rounded-xl border border-border bg-card p-3 transition-colors',
            isDropActive && 'bg-muted',
          )}
        >
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext
              items={value.map((_, i) => sortableId(i))}
              strategy={horizontalListSortingStrategy}
            >
              {value.map((item, index) => (
                <SortableGalleryThumbnail
                  key={
                    item.type === 'url'
                      ? `url-${item.url.slice(-24)}-${index}`
                      : `file-${index}-${item.file.size}-${item.file.lastModified}`
                  }
                  id={sortableId(index)}
                  item={item}
                  objectUrl={getDisplayUrl(item, index)}
                  index={index}
                  disabled={disabled}
                  onEdit={() => openEditFile(index)}
                  onRemove={() => removeImage(index)}
                />
              ))}
            </SortableContext>
          </DndContext>
          {canAddMore && (
            <button
              type="button"
              onClick={() => void handlePickPhotos()}
              disabled={disabled}
              className="flex aspect-[4/3] w-[10.4rem] shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={t('marketplace:photos.addAria')}
            >
              <Plus className="w-8 h-8 text-muted-foreground" />
            </button>
          )}
        </div>
      )}
      {canAddMore && isCameraAvailable && !isEmpty ? (
        <button
          type="button"
          onClick={() => void handleTakePhoto()}
          disabled={disabled}
          className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-foreground/80 disabled:opacity-50"
        >
          <Camera className="h-4 w-4" aria-hidden />
          {t('marketplace:photos.takePhoto')}
        </button>
      ) : null}
      <p className="text-xs text-muted-foreground mt-1">{t('marketplace:photos.helpText', { max })}</p>
      {editImageSrc && (
        <EditPhotoModal
          open={editModalOpen}
          onClose={handleEditClose}
          imageSrc={editImageSrc}
          onSave={handleEditSave}
          aspect={4 / 3}
          autoDetectAspect
        />
      )}
    </div>
  );
}
