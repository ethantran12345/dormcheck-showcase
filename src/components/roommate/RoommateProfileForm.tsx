import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ProfilePrompt } from '@/lib/roommatePrompts';
import type { TFunction } from 'i18next';
import type { LucideIcon } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sparkles,
  PartyPopper,
  BookOpen,
  DoorOpen,
  Moon,
  Thermometer,
  Cigarette,
  Ban,
  Camera,
  Pencil,
  Plus,
  X,
  MessageCircle,
  Trash2,
  GripVertical,
} from 'lucide-react';
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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Switch } from '@/components/ui/switch';
import { EditPhotoModal } from '@/components/profile/EditPhotoModal';
import { useImageUpload } from '@/hooks/useImageUpload';
import {
  type RoommateProfilePreviewData,
  RoommateProfilePreviewBlock,
} from '@/components/marketplace/FormLivePreview';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { roommateOptionLabel } from '@/components/roommate/optionLabels';

// Compatibility options live in src/lib/roommateOptions.ts (shared with the
// scoring lib); re-exported here so existing import sites keep working.
import {
  CLEANLINESS_OPTIONS,
  SOCIAL_OPTIONS,
  STUDY_OPTIONS,
  CONFLICT_STYLE_OPTIONS,
  GUESTS_OPTIONS,
  SLEEP_OPTIONS,
  SMOKING_OPTIONS,
  TEMP_OPTIONS,
  DEALBREAKER_OPTIONS,
  PRESET_DEALBREAKERS,
} from '@/lib/roommateOptions';

export {
  CLEANLINESS_OPTIONS,
  SOCIAL_OPTIONS,
  STUDY_OPTIONS,
  CONFLICT_STYLE_OPTIONS,
  GUESTS_OPTIONS,
  SLEEP_OPTIONS,
  SMOKING_OPTIONS,
  TEMP_OPTIONS,
  DEALBREAKER_OPTIONS,
  PRESET_DEALBREAKERS,
};

export type ProfilePhotoItem = { type: 'url'; url: string } | { type: 'file'; file: File };

export type RoommateLivePreviewInput = {
  displayName: string;
  major: string;
  gradeLevel: string;
  graduationYear: string;
  graduationSemester: 'Spring' | 'Fall';
  fallbackAvatarUrl: string | null;
};

export interface RoommateProfileFormValues {
  bio: string;
  tags: string[];
  instagramUsername: string;
  snapchatUsername: string;
  phoneNumber: string;
  /** Unified ordered list: URLs (saved) + Files (pending upload). Order is preserved on save. */
  profilePhotos: ProfilePhotoItem[];
  cleanliness: string | null;
  social_level: string | null;
  study_style: string | null;
  guests: string | null;
  sleep: string | null;
  smoking: string | null;
  temp: string | null;
  conflict_style: string | null;
  dealbreakers: string[];
  /** Optional profile enrichment (Phase 2): interest slugs + answered prompts. */
  interests: string[];
  prompts: ProfilePrompt[];
}

interface RoommateProfileFormProps {
  values: RoommateProfileFormValues;
  onChange: (values: RoommateProfileFormValues) => void;
  /** When set, show Delete Profile button and call this on confirm. */
  profileId?: string | null;
  onDeleteProfile?: () => void | Promise<void>;
  /** Show my profile to potential roommates (controls is_roommate_searching). Default false when null/undefined. */
  isRoommateSearching?: boolean;
  onRoommateSearchingChange?: (value: boolean) => void;
  /** When provided, renders the live roommate-card preview from these identity fields. */
  roommateLivePreview?: RoommateLivePreviewInput;
}

function OptionPill<T extends string>({
  selected,
  onClick,
  label,
}: {
  value: T;
  selected: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'h-auto gap-1.5 rounded-full border border-border bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground transition-all',
        'hover:border-border hover:bg-muted hover:text-muted-foreground'
      )}
    >
      {label}
    </Button>
  );
}

/**
 * Ordinal compatibility field as a slider (Phase 3). Pure presentation over the
 * SAME stored enum strings - slider index i maps to options[i], so no data or
 * stored value changes. When the field is unset the thumb parks at the midpoint
 * for display only; no value is written until the user moves it (first
 * interaction sets it). Keyboard-operable via Radix; the current value is shown
 * as text, never by color alone.
 */
function CompatibilitySlider({
  icon: Icon,
  title,
  options,
  value,
  onChange,
  t,
}: {
  icon: LucideIcon;
  title: string;
  options: readonly string[];
  value: string | null;
  onChange: (value: string) => void;
  t: TFunction;
}) {
  const lastIndex = options.length - 1;
  const currentIndex = value ? options.indexOf(value) : -1;
  const sliderIndex = currentIndex >= 0 ? currentIndex : Math.round(lastIndex / 2);
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        <Label className="text-sm text-muted-foreground">{title}</Label>
      </div>
      <div className="px-1">
        <Slider
          aria-label={title}
          value={[sliderIndex]}
          min={0}
          max={lastIndex}
          step={1}
          onValueChange={(vals) => onChange(options[vals[0]])}
          className="py-1"
        />
        <div className="mt-2 flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">{roommateOptionLabel(t, options[0])}</span>
          <span
            className={cn(
              'font-semibold',
              currentIndex >= 0 ? 'text-foreground' : 'text-muted-foreground/60',
            )}
          >
            {currentIndex >= 0
              ? roommateOptionLabel(t, value as string)
              : t('roommates:profileForm.sliderUnset')}
          </span>
          <span className="text-muted-foreground">{roommateOptionLabel(t, options[lastIndex])}</span>
        </div>
      </div>
    </div>
  );
}

function DealbreakerChip({
  label,
  selected,
  onToggle,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onToggle}
      aria-pressed={selected}
      className={cn(
        'h-auto gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium transition-all',
        selected
          ? 'bg-foreground text-background hover:bg-foreground hover:text-background'
          : 'bg-muted text-muted-foreground hover:border-border hover:bg-muted hover:text-muted-foreground'
      )}
    >
      {label}
    </Button>
  );
}

const MAX_PHOTOS = 5;

function SortableProfilePhotoThumbnail({
  id,
  objectUrl,
  index,
  onEdit,
  onRemove,
}: {
  id: string;
  item: ProfilePhotoItem;
  objectUrl: string;
  index: number;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Import translation function for photo labels
  const { t } = useTranslation();

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative shrink-0 w-[10.4rem] aspect-[3/4] rounded-lg overflow-hidden border border-border bg-muted group',
        isDragging && 'opacity-60 z-50 shadow-overlay ring-2 ring-primary/30'
      )}
    >
      <img
        src={objectUrl}
        alt={index === 0 ? t('roommates:profileForm.coverPhotoAlt') : t('roommates:profileForm.photoAlt', { n: index + 1 })}
        className="w-full h-full object-cover pointer-events-none"
        onError={(e) => { e.currentTarget.src = '/placeholder.svg'; }}
      />
      {index === 0 && (
        <span className="absolute top-1 left-1 px-1.5 py-0.5 text-[10px] font-medium bg-foreground text-background rounded shadow-raised">
          {t('roommates:profileForm.coverLabel')}
        </span>
      )}
      <div
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
          }
        }}
        className="absolute bottom-1 left-1 w-7 h-7 rounded-full bg-card/90 text-foreground flex items-center justify-center hover:bg-card shadow-raised cursor-grab active:cursor-grabbing touch-none"
        aria-label={t('roommates:profileForm.dragReorderAria')}
        role="button"
        tabIndex={0}
      >
        <GripVertical className="w-3.5 h-3.5" />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={(e) => { e.stopPropagation(); onEdit(); }}
        className="absolute bottom-1 left-9 h-7 w-7 rounded-full bg-card/90 text-foreground shadow-raised hover:bg-card [&_svg]:size-3.5"
        aria-label={t('roommates:profileForm.editPhotoAria')}
      >
        <Pencil />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="absolute right-1 top-1 h-7 w-7 rounded-full bg-card/90 text-foreground shadow-raised hover:bg-red-500 hover:text-white [&_svg]:size-3.5"
        aria-label={t('roommates:profileForm.removePhotoAria')}
      >
        <X />
      </Button>
    </div>
  );
}

export function RoommateProfileForm({
  values,
  onChange,
  profileId,
  onDeleteProfile,
  isRoommateSearching = false,
  onRoommateSearchingChange,
  roommateLivePreview,
}: RoommateProfileFormProps) {
  const { t } = useTranslation();
  const { showRoommates } = useFeatureFlags();
  const { pickMany } = useImageUpload();
  const update = <K extends keyof RoommateProfileFormValues>(
    key: K,
    value: RoommateProfileFormValues[K]
  ) => onChange({ ...values, [key]: value });

  const [customBoundaryInput, setCustomBoundaryInput] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const toggleDealbreaker = (option: string) => {
    const next = values.dealbreakers.includes(option)
      ? values.dealbreakers.filter((d) => d !== option)
      : [...values.dealbreakers, option];
    update('dealbreakers', next);
  };

  const customDealbreakers = values.dealbreakers.filter((d) => !(PRESET_DEALBREAKERS as readonly string[]).includes(d));

  const addCustomBoundary = () => {
    const trimmed = customBoundaryInput.trim();
    if (!trimmed || values.dealbreakers.includes(trimmed)) return;
    update('dealbreakers', [...values.dealbreakers, trimmed]);
    setCustomBoundaryInput('');
  };

  const removeDealbreaker = (d: string) => {
    update('dealbreakers', values.dealbreakers.filter((x) => x !== d));
  };

  const profilePhotos = values.profilePhotos ?? [];
  const totalPhotos = profilePhotos.length;
  const canAddMore = totalPhotos < MAX_PHOTOS;

  const fileItems = profilePhotos.filter((x): x is { type: 'file'; file: File } => x.type === 'file');
  const fileUrlCacheRef = useRef<Map<File, string>>(new Map());
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

  const roommatePreviewPhotoUrls = useMemo(() => {
    const urls = values.profilePhotos
      .map((item) => {
        if (item.type === 'url') return item.url;
        const fileIdx = fileItems.findIndex((x) => x.file === item.file);
        return fileIdx >= 0 ? fileObjectUrls[fileIdx] : null;
      })
      .filter((url): url is string => !!url);
    if (urls.length > 0) return urls;
    return roommateLivePreview?.fallbackAvatarUrl ? [roommateLivePreview.fallbackAvatarUrl] : [];
  }, [values.profilePhotos, fileItems, fileObjectUrls, roommateLivePreview?.fallbackAvatarUrl]);

  const roommatePreviewListing = useMemo<RoommateProfilePreviewData | null>(() => {
    if (!roommateLivePreview) return null;
    return {
      displayName: roommateLivePreview.displayName,
      major: roommateLivePreview.major,
      gradeLevel: roommateLivePreview.gradeLevel,
      graduationYear: roommateLivePreview.graduationYear,
      bio: values.bio,
      dealbreakers: values.dealbreakers,
      photoUrls: roommatePreviewPhotoUrls,
      instagramUsername: values.instagramUsername,
      snapchatUsername: values.snapchatUsername,
    };
  }, [
    roommateLivePreview,
    values.bio,
    values.dealbreakers,
    values.instagramUsername,
    values.snapchatUsername,
    roommatePreviewPhotoUrls,
  ]);

  const handlePhotoSelect = useCallback((selectedFiles: File[]) => {
    const toAdd = selectedFiles.slice(0, MAX_PHOTOS - totalPhotos).map((file) => ({ type: 'file' as const, file }));
    if (toAdd.length) update('profilePhotos', [...profilePhotos, ...toAdd]);
  }, [profilePhotos, totalPhotos, update]);

  const handlePickPhotos = useCallback(async () => {
    try {
      const files = await pickMany({ source: 'prompt', limit: MAX_PHOTOS, accept: 'image/*' });
      if (!files.length) return;
      handlePhotoSelect(files);
    } catch (error) {
      // Keep the existing form UX quiet unless the picker itself fails.
      console.error('[RoommateProfileForm] pickMany failed', error);
    }
  }, [handlePhotoSelect, pickMany]);

  const reorderProfilePhotos = useCallback(
    (oldIndex: number, newIndex: number) => {
      if (oldIndex === newIndex || oldIndex < 0 || newIndex < 0 || oldIndex >= profilePhotos.length || newIndex >= profilePhotos.length) return;
      update('profilePhotos', arrayMove(profilePhotos, oldIndex, newIndex));
    },
    [profilePhotos, update]
  );

  const handleProfilePhotoDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = profilePhotos.findIndex((_, i) => `profile-photo-${i}` === active.id);
      const newIndex = profilePhotos.findIndex((_, i) => `profile-photo-${i}` === over.id);
      if (oldIndex !== -1 && newIndex !== -1) reorderProfilePhotos(oldIndex, newIndex);
    },
    [profilePhotos, reorderProfilePhotos]
  );

  const removePhotoAtIndex = useCallback(
    (index: number) => {
      update('profilePhotos', profilePhotos.filter((_, i) => i !== index));
    },
    [profilePhotos, update]
  );

  const openEditAtIndex = useCallback(
    (index: number) => {
      const item = profilePhotos[index];
      if (!item) return;
      setEditCombinedIndex(index);
      if (item.type === 'url') {
        setEditImageSrc(item.url);
      } else {
        const fileIdx = fileItems.findIndex((x) => x.file === item.file);
        setEditImageSrc(fileObjectUrls[fileIdx] ?? URL.createObjectURL(item.file));
      }
      setEditModalOpen(true);
    },
    [profilePhotos, fileItems, fileObjectUrls]
  );

  const profilePhotoSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editImageSrc, setEditImageSrc] = useState<string | null>(null);
  const [editCombinedIndex, setEditCombinedIndex] = useState(0);

  const handleEditSave = useCallback(
    (blob: Blob) => {
      const file = new File([blob], 'profile-photo.jpg', { type: blob.type });
      const next = [...profilePhotos];
      if (editCombinedIndex >= 0 && editCombinedIndex < next.length) {
        next[editCombinedIndex] = { type: 'file' as const, file };
      }
      update('profilePhotos', next);
      setEditModalOpen(false);
      if (editImageSrc && editImageSrc.startsWith('blob:')) URL.revokeObjectURL(editImageSrc);
      setEditImageSrc(null);
    },
    [editCombinedIndex, profilePhotos, editImageSrc, update]
  );

  const handleEditClose = useCallback(() => {
    setEditModalOpen(false);
    if (editImageSrc && editImageSrc.startsWith('blob:')) URL.revokeObjectURL(editImageSrc);
    setEditImageSrc(null);
  }, [editImageSrc]);

  if (!showRoommates) return null;

  return (
    <div className="space-y-6">
      {/* Multi-Photo Gallery (up to 5) */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
          {t('roommates:profileForm.photosLabel')}
        </Label>
        <div className="mt-1 flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handlePickPhotos()}
            disabled={!canAddMore}
          >
            <Camera className="w-4 h-4" />
            {profilePhotos.length > 0
              ? t('roommates:profileForm.photosCount', { count: profilePhotos.length, max: MAX_PHOTOS })
              : t('roommates:profileForm.choosePhoto')}
          </Button>
        </div>
        <div className="flex gap-x-4 gap-y-2 p-3 overflow-x-auto border border-border rounded-xl bg-muted/30  min-h-[156px]">
          <DndContext
            sensors={profilePhotoSensors}
            collisionDetection={closestCenter}
            onDragEnd={handleProfilePhotoDragEnd}
          >
            <SortableContext
              items={profilePhotos.map((_, i) => `profile-photo-${i}`)}
              strategy={horizontalListSortingStrategy}
            >
              {profilePhotos.map((item, index) => {
                const objectUrl = item.type === 'url' ? item.url : fileObjectUrls[fileItems.findIndex((x) => x.file === item.file)];
                return (
                  <SortableProfilePhotoThumbnail
                    key={item.type === 'url' ? `url-${item.url.slice(-24)}` : `file-${index}-${item.file.size}`}
                    id={`profile-photo-${index}`}
                    item={item}
                    objectUrl={objectUrl ?? '/placeholder.svg'}
                    index={index}
                    onEdit={() => openEditAtIndex(index)}
                    onRemove={() => removePhotoAtIndex(index)}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
          {canAddMore && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => void handlePickPhotos()}
              className="aspect-[3/4] h-auto w-[10.4rem] shrink-0 cursor-pointer rounded-lg border-2 border-dashed border-border bg-muted/30 text-muted-foreground transition-colors hover:bg-accent hover:text-muted-foreground [&_svg]:size-8"
              aria-label={t('roommates:profileForm.addPhotosAria')}
            >
              <Plus />
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {t('roommates:profileForm.photosHelper', { max: MAX_PHOTOS })}
        </p>
      </div>

      {/* Compatibility Snapshot */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-foreground">{t('roommates:profileForm.compatibilityTitle')}</h4>
        <div className="space-y-4">
          <CompatibilitySlider
            icon={Sparkles}
            title={t('roommates:profileForm.cleanlinessTitle')}
            options={CLEANLINESS_OPTIONS}
            value={values.cleanliness}
            onChange={(v) => update('cleanliness', v)}
            t={t}
          />
          <CompatibilitySlider
            icon={PartyPopper}
            title={t('roommates:profileForm.socialTitle')}
            options={SOCIAL_OPTIONS}
            value={values.social_level}
            onChange={(v) => update('social_level', v)}
            t={t}
          />
          <div>
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="w-4 h-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
              <Label className="text-sm text-muted-foreground">{t('roommates:profileForm.studyTitle')}</Label>
            </div>
            <div className="flex flex-wrap gap-2">
              {STUDY_OPTIONS.map((opt) => (
                <OptionPill
                  key={opt}
                  value={opt}
                  label={roommateOptionLabel(t, opt)}
                  selected={values.study_style === opt}
                  onClick={() =>
                    update('study_style', values.study_style === opt ? null : opt)
                  }
                />
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <MessageCircle className="w-4 h-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
              <Label className="text-sm text-muted-foreground">{t('roommates:profileForm.conflictTitle')}</Label>
            </div>
            <div className="flex flex-wrap gap-2">
              {CONFLICT_STYLE_OPTIONS.map((opt) => (
                <OptionPill
                  key={opt}
                  value={opt}
                  label={roommateOptionLabel(t, opt)}
                  selected={values.conflict_style === opt}
                  onClick={() =>
                    update('conflict_style', values.conflict_style === opt ? null : opt)
                  }
                />
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <DoorOpen className="w-4 h-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
              <Label className="text-sm text-muted-foreground">{t('roommates:profileForm.guestsTitle')}</Label>
            </div>
            <div className="flex flex-wrap gap-2">
              {GUESTS_OPTIONS.map((opt) => (
                <OptionPill
                  key={opt}
                  value={opt}
                  label={roommateOptionLabel(t, opt)}
                  selected={values.guests === opt}
                  onClick={() => update('guests', values.guests === opt ? null : opt)}
                />
              ))}
            </div>
          </div>
          <CompatibilitySlider
            icon={Moon}
            title={t('roommates:profileForm.sleepTitle')}
            options={SLEEP_OPTIONS}
            value={values.sleep}
            onChange={(v) => update('sleep', v)}
            t={t}
          />
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Cigarette className="w-4 h-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
              <Label className="text-sm text-muted-foreground">{t('roommates:profileForm.smokingTitle')}</Label>
            </div>
            <div className="flex flex-wrap gap-2">
              {SMOKING_OPTIONS.map((opt) => (
                <OptionPill
                  key={opt}
                  value={opt}
                  label={roommateOptionLabel(t, opt)}
                  selected={values.smoking === opt}
                  onClick={() => update('smoking', values.smoking === opt ? null : opt)}
                />
              ))}
            </div>
          </div>
          <CompatibilitySlider
            icon={Thermometer}
            title={t('roommates:profileForm.tempTitle')}
            options={TEMP_OPTIONS}
            value={values.temp}
            onChange={(v) => update('temp', v)}
            t={t}
          />
        </div>
      </div>

      {/* Dealbreakers / My Boundaries */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Ban className="w-4 h-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
          <h4 className="text-sm font-semibold text-foreground">{t('roommates:profileForm.boundariesTitle')}</h4>
        </div>
        <p className="text-xs text-muted-foreground">{t('roommates:profileForm.boundariesPresetLabel')}</p>
        <div className="flex flex-wrap gap-2">
          {DEALBREAKER_OPTIONS.map((opt) => (
            <DealbreakerChip
              key={opt}
              label={roommateOptionLabel(t, opt)}
              selected={values.dealbreakers.includes(opt)}
              onToggle={() => toggleDealbreaker(opt)}
            />
          ))}
        </div>
        {/* Custom boundary input */}
        <div className="flex items-center gap-2">
          <Input
            // IPP-3: a placeholder is not an accessible name — it disappears the
            // moment you type and screen readers may skip it entirely. The visible
            // design here is deliberately label-less (an inline "add another" pill),
            // so the name goes on aria-label rather than adding visible chrome.
            aria-label={t('roommates:profileForm.boundariesAddAria')}
            placeholder={t('roommates:profileForm.boundariesCustomPlaceholder')}
            className="h-9 rounded-full border-dashed border-border text-sm max-w-[220px]"
            value={customBoundaryInput}
            onChange={(e) => setCustomBoundaryInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCustomBoundary();
              }
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={addCustomBoundary}
            className="h-9 w-9 rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            aria-label={t('roommates:profileForm.boundariesAddAria')}
          >
            <Plus />
          </Button>
        </div>
        {/* Custom pills - border-dashed, removable */}
        {customDealbreakers.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {customDealbreakers.map((d) => (
              <span
                key={d}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-destructive/10 text-destructive border border-dashed border-destructive/30"
              >
                {d}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeDealbreaker(d)}
                  className="h-auto w-auto rounded-full p-0.5 transition-colors hover:bg-destructive/20 hover:text-destructive [&_svg]:size-3.5"
                  aria-label={t('roommates:profileForm.removeBoundaryAria', { boundary: d })}
                >
                  <X />
                </Button>
              </span>
            ))}
          </div>
        )}
      </div>

      {onRoommateSearchingChange != null && (
        <div className="flex items-start gap-3 pt-4 border-t border-border">
          <Switch
            checked={isRoommateSearching}
            onCheckedChange={onRoommateSearchingChange}
            aria-label={t('roommates:profileForm.showProfileAria')}
          />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">{t('roommates:profileForm.showProfileLabel')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('roommates:profileForm.showProfileHelper')}
            </p>
          </div>
        </div>
      )}

      {roommateLivePreview && roommatePreviewListing && (
        <div className="pt-4 border-t border-border">
          <RoommateProfilePreviewBlock listing={roommatePreviewListing} />
        </div>
      )}

      {profileId != null && onDeleteProfile && (
        <>
          <div className="pt-4 border-t border-border">
            <Button
              type="button"
              variant="ghost"
              className="w-full rounded-xl border-2 border-red-200 bg-red-50/50 text-red-600 hover:border-red-500 hover:text-red-600 hover:bg-red-50/80 py-3 gap-2 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800"
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={deleting}
            >
              <Trash2 className="w-4 h-4" />
              {t('roommates:profileForm.deleteProfileButton')}
            </Button>
          </div>
          <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('roommates:profileForm.deleteConfirmTitle')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('roommates:profileForm.deleteConfirmDescription')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>{t('common:actions.cancel')}</AlertDialogCancel>
                <Button
                  variant="destructive"
                  disabled={deleting}
                  onClick={async () => {
                    setDeleting(true);
                    try {
                      await onDeleteProfile();
                      setDeleteConfirmOpen(false);
                    } finally {
                      setDeleting(false);
                    }
                  }}
                >
                  {deleting ? t('roommates:profileForm.deletingLabel') : t('common:actions.delete')}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}

      {editImageSrc && (
        <EditPhotoModal
          open={editModalOpen}
          onClose={handleEditClose}
          imageSrc={editImageSrc}
          onSave={handleEditSave}
          autoDetectAspect
        />
      )}
    </div>
  );
}
