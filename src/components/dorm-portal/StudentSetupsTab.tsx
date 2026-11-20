import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ThumbImage } from '@/components/ui/thumb-image';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Heart, Flame, Upload, Camera, Sparkles, X, Loader2, Plus, Lock, Trash2, MapPin, ExternalLink, Settings2, Clipboard, Instagram } from 'lucide-react';
import { TikTokIcon } from '@/components/icons/TikTokIcon';
import { EmptyState } from '@/components/ui/EmptyState';
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
import { useLocation, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SetupTag } from '@/types';
import { Tables } from '@/integrations/supabase/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { ImageRejectedError, uploadAndScreen } from '@/lib/imageModeration';
import { useBlockedUserIds } from '@/hooks/useBlockedUsers';
import type { Database, Json } from '@/integrations/supabase/types';
import { sanitizeText, sanitizeOptional, safeHref, safeImageSrc } from '@/lib/sanitize';
import { canonicalTourUrl, parseTourUrl, type TourPlatform } from '@/lib/socialTour';
import { useAuth } from '@/hooks/useAuth';
import { useUniversity } from '@/contexts/UniversityContext';
import { useImageUpload } from '@/hooks/useImageUpload';
import { useModalOverlay } from '@/contexts/ModalOverlayContext';
import { toast } from 'sonner';
import { SetupDetailModal } from './SetupDetailModal';
import { ProductTagMarker } from '@/components/dorm-portal/ProductTagMarker';
import { SetupTagEntryCard } from '@/components/dorm-portal/SetupTagEntryCard';
import type { Dorm } from '@/types';
import { SneakPeekBlurWall } from '@/components/ui/sneak-peek-blur-wall';
import { fetchSetupsPreview, isSetupPreviewTeaserId, mapSetupPreviewPhotos } from '@/lib/publicPreviewRpcs';

interface StudentSetup {
  id: number;
  image_url: string;
  author_name: string;
  caption: string | null;
  likes: number;
  dorm_name: string;
  created_at: string;
  setup_likes?: Array<{ user_id: string }>;
  user_id?: string | null;
  tags?: SetupTag[] | null;
  tiktok_url?: string | null;
  report_uuid?: string | null;
}

interface SubBuilding {
  letter: string;
  address: string | null;
  mailingAddress: string | null;
  roomBreakdown: string | null;
  id: number;
}

interface StudentSetupsTabProps {
  dormName: string;
  dormId?: number;
  dorm?: Dorm;
  selectedSubBuilding?: SubBuilding;
}

/** Which platform badge (if any) a stored room-tour URL earns on a grid tile. */
function tourPlatformFor(url: string | null | undefined): TourPlatform | null {
  return parseTourUrl(url)?.platform ?? null;
}

type SortMode = 'votes' | 'recent';

/** The three feed views the segmented control exposes. "liked" is a filter layered
 *  on the current sort, so switching back to Top/Recent just clears it. */
type SetupView = SortMode | 'liked';

const SETUP_VIEWS: ReadonlyArray<{
  id: SetupView;
  icon: typeof Flame;
  labelKey: string;
}> = [
  { id: 'votes', icon: Flame, labelKey: 'housing:portal.setups.header.topVoted' },
  { id: 'recent', icon: Sparkles, labelKey: 'housing:portal.setups.header.recent' },
  { id: 'liked', icon: Heart, labelKey: 'housing:portal.setups.header.liked' },
];

const MAX_SETUP_PHOTOS = 5;

type UploadItem = { type: 'url'; url: string } | { type: 'file'; file: File };

function getUploadItemUrl(item: UploadItem): string {
  if (item.type === 'file') return URL.createObjectURL(item.file);
  const safe = safeImageSrc(item.url);
  return safe ?? '';
}

function SortableSetupThumbnail({
  id,
  item,
  index,
  isSelected,
  onSelect,
  onRemove,
}: {
  id: string;
  item: UploadItem;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
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
  const { t } = useTranslation();

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      className={cn(
        'relative shrink-0 w-20 h-20 rounded-lg overflow-hidden border-2 transition-all cursor-grab active:cursor-grabbing touch-none snap-start',
        isSelected ? 'border-primary ring-1 ring-primary/30' : 'border-transparent opacity-70 hover:opacity-100',
        isDragging && 'opacity-90 z-50 shadow-overlay'
      )}
      aria-label={index === 0 ? 'Cover photo, drag to reorder' : `Photo ${index + 1}, drag to reorder`}
    >
      <img src={getUploadItemUrl(item)} alt="" className="w-full h-full object-cover pointer-events-none" />
      {index === 0 && (
        <span
          className="absolute top-0.5 left-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-primary text-primary-foreground rounded shadow-raised"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {t('housing:portal.setups.upload.coverPhoto')}
        </span>
      )}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute top-0.5 right-0.5 w-6 h-6 rounded bg-card/90 text-foreground flex items-center justify-center hover:bg-red-500 hover:text-white shadow"
        aria-label={t('housing:portal.setups.upload.removePhotoBtn')}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

export function StudentSetupsTab({ dormName, dormId }: StudentSetupsTabProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { university } = useUniversity();
  const { pickMany } = useImageUpload();
  const modalOverlay = useModalOverlay();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sortMode, setSortMode] = useState<SortMode>('votes');
  const [showLikedOnly, setShowLikedOnly] = useState(false);
  const activeView: SetupView = showLikedOnly ? 'liked' : sortMode;
  const selectView = useCallback((view: SetupView) => {
    if (view === 'liked') {
      setShowLikedOnly(true);
      return;
    }
    setShowLikedOnly(false);
    setSortMode(view);
  }, []);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [setups, setSetups] = useState<StudentSetup[]>([]);
  // App Store 1.2: blocks must take effect INSTANTLY, everywhere. These feeds
  // fetch imperatively, so the ref keeps the fetch closure current without
  // re-triggering it, and the effect prunes what is already on screen the
  // moment a block lands (BlockUserButton invalidates the blocked-ids query).
  const { blockedUserIds } = useBlockedUserIds();
  const blockedUserIdsRef = useRef(blockedUserIds);
  blockedUserIdsRef.current = blockedUserIds;
  useEffect(() => {
    if (blockedUserIds.size === 0) return;
    setSetups((prev) =>
      prev.some((s) => s.user_id && blockedUserIds.has(s.user_id))
        ? prev.filter((s) => !s.user_id || !blockedUserIds.has(s.user_id))
        : prev,
    );
  }, [blockedUserIds]);

  const [likedSetupIds, setLikedSetupIds] = useState<Set<number>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(6);
  const [selectedSetupId, setSelectedSetupId] = useState<number | null>(null);
  const [deletingSetupId, setDeletingSetupId] = useState<number | null>(null);

  // Upload form state
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [caption, setCaption] = useState('');
  const [tiktokUrl, setTiktokUrl] = useState('');
  const [tiktokUrlError, setTiktokUrlError] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [tags, setTags] = useState<SetupTag[]>([]);
  const [popupState, setPopupState] = useState<{ photoIndex: number; x: number; y: number } | null>(null);
  const [editingTagIndex, setEditingTagIndex] = useState<number | null>(null);
  const [tempProductName, setTempProductName] = useState('');
  const [tempProductLink, setTempProductLink] = useState('');
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [editingSetupId, setEditingSetupId] = useState<number | null>(null);
  const [setupImageDimensions, setSetupImageDimensions] = useState<{ w: number; h: number } | null>(null);
  const setupImageRef = useRef<HTMLImageElement>(null);
  const isDraggingTagRef = useRef(false);
  const justDraggedTagRef = useRef(false);

  const setupUploadSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Check if current user already has a setup for this dorm (for Manage vs Upload)
  const { data: mySetup } = useQuery({
    queryKey: ['student_setups', 'my_setup', user?.id, dormId],
    queryFn: async () => {
      if (!user?.id || dormId == null) return null;
      const { data } = await supabase
        .from('student_setups')
        .select('id, image_url, author_name, caption, tags, tiktok_url, user_id, likes, dorm_name, created_at')
        .eq('user_id', user.id)
        .eq('dorm_id', dormId)
        .maybeSingle();
      if (!data) return null;
      const setup: StudentSetup = {
        id: data.id,
        image_url: data.image_url,
        author_name: data.author_name ?? '',
        caption: data.caption,
        likes: data.likes ?? 0,
        dorm_name: data.dorm_name ?? '',
        created_at: data.created_at ?? new Date().toISOString(),
        tags: (data.tags as unknown as SetupTag[] | null) ?? null,
        tiktok_url: data.tiktok_url ?? null,
        user_id: data.user_id,
      };
      return setup;
    },
    enabled: Boolean(user?.id && dormId != null),
  });

  useEffect(() => {
    fetchSetups();
  }, [dormName, dormId, user?.id]);

  // Deep link from the Room Gallery "Post your setup" CTA: ?share=1 opens the
  // upload dialog directly (signed-in users only, once per mount).
  const location = useLocation();
  const autoOpenedShareRef = useRef(false);
  useEffect(() => {
    if (autoOpenedShareRef.current || !user) return;
    if (new URLSearchParams(location.search).get('share') !== '1') return;
    autoOpenedShareRef.current = true;
    setUploadDialogOpen(true);
  }, [user, location.search]);

  // Shared setup link: ?setup=<id> opens that setup's detail view once the feed
  // has loaded. Runs once per mount so closing the modal doesn't reopen it.
  const autoOpenedSetupRef = useRef(false);
  useEffect(() => {
    if (autoOpenedSetupRef.current || setups.length === 0) return;
    const raw = new URLSearchParams(location.search).get('setup');
    if (!raw) return;
    const id = Number(raw);
    if (!Number.isFinite(id) || !setups.some((s) => s.id === id)) return;
    autoOpenedSetupRef.current = true;
    setSelectedSetupId(id);
  }, [location.search, setups]);

  useEffect(() => {
    if (user) {
      setAuthorName(user.user_metadata?.full_name || user.email?.split('@')[0] || '');
    }
  }, [user]);

  useEffect(() => {
    setSetupImageDimensions(null);
  }, [selectedPhotoIndex]);

  useEffect(() => {
    setVisibleCount(6);
  }, [sortMode, showLikedOnly]);

  useEffect(() => {
    if (likedSetupIds.size === 0) setShowLikedOnly(false);
  }, [likedSetupIds.size]);

  const fetchSetups = async () => {
    setIsLoading(true);
    try {
      if (!user) {
        const preview = await fetchSetupsPreview(university.id);
        const list = mapSetupPreviewPhotos(preview.photo_urls);
        setSetups(list);
        setLikedSetupIds(new Set());
        return;
      }

      let query = supabase
        .from('student_setups')
        .select('*, setup_likes(user_id)')
        .eq('university_id', university.id);
      if (dormId != null) {
        query = query.or(`dorm_id.eq.${dormId},dorm_name.eq.${dormName}`);
      } else {
        query = query.eq('dorm_name', dormName);
      }
      const { data, error } = await query;

      if (error) {
        console.error(error);
        throw error;
      }
      
      // Moderation-hidden rows (test/admin/non-room content) never render.
      // Optional-chained so the filter also holds before the is_hidden
      // migration reaches prod.
      const visible = (data || []).filter((setup) => {
        if ((setup as { is_hidden?: boolean }).is_hidden) return false;
        // App Store 1.2: a blocked user's setups disappear from this feed.
        const authorId = (setup as { user_id?: string | null }).user_id;
        return !authorId || !blockedUserIdsRef.current.has(authorId);
      });
      const list = visible.map((setup) => {
        const s = setup as unknown as Tables<'student_setups'> & { setup_likes?: Array<{ user_id: string }> };
        const setupLikes = s.setup_likes || [];
        const likesCount = setupLikes.length;

        return {
          id: s.id,
          image_url: s.image_url,
          author_name: s.author_name,
          caption: s.caption,
          likes: likesCount,
          dorm_name: s.dorm_name,
          created_at: s.created_at,
          setup_likes: setupLikes,
          user_id: s.user_id ?? null,
          tags: (s?.tags as unknown as SetupTag[] | null) ?? null,
          tiktok_url: s.tiktok_url ?? null,
          // Optional-chained so reporting stays disabled (not broken) before
          // the report_uuid migration reaches prod.
          report_uuid: (setup as { report_uuid?: string | null }).report_uuid ?? null,
        };
      });
      
      setSetups(list);

      // Update likedSetupIds for optimistic UI updates
      if (user?.id) {
        const likedIds = new Set<number>();
        list.forEach((setup: StudentSetup) => {
          if (setup.setup_likes?.some((like: { user_id: string }) => like.user_id === user.id)) {
            likedIds.add(setup.id);
          }
        });
        setLikedSetupIds(likedIds);
      } else {
        setLikedSetupIds(new Set());
      }
    } catch (error) {
      console.error('Error fetching student setups:', error);
      console.error(error);
      toast.error('Failed to load setups');
      setSetups([]);
    } finally {
      setIsLoading(false);
    }
  };

  /** Lightweight room-photo sanity check: reject tiny images and extreme
   *  aspect ratios (banners/logos), the cheapest signal that a file is not a
   *  real room photo. */
  const validateRoomPhoto = (file: File): Promise<boolean> =>
    new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const { naturalWidth: w, naturalHeight: h } = img;
        const aspect = w / h;
        resolve(w >= 300 && h >= 300 && aspect >= 1 / 3 && aspect <= 3);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(false);
      };
      img.src = url;
    });

  const handleFileSelect = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const checks = await Promise.all(files.map((f) => validateRoomPhoto(f)));
    const rejectedCount = checks.filter((ok) => !ok).length;
    if (rejectedCount > 0) {
      toast.error(
        rejectedCount === 1
          ? t('housing:portal.setups.upload.photoValidationError')
          : t('housing:portal.setups.upload.photoValidationErrorMultiple', { n: rejectedCount }),
      );
    }
    files = files.filter((_, i) => checks[i]);
    if (files.length === 0) return;
    setUploadItems(prev => {
      const toAdd = files.slice(0, Math.max(0, MAX_SETUP_PHOTOS - prev.length));
      const combined = [...prev, ...toAdd.map(f => ({ type: 'file' as const, file: f }))];
      if (prev.length + files.length > MAX_SETUP_PHOTOS) {
        toast.error(t('housing:portal.setups.upload.maxPhotosError', { MAX_SETUP_PHOTOS }));
      }
      return combined.slice(0, MAX_SETUP_PHOTOS);
    });
  }, [t]);

  const handlePickSetupPhotos = useCallback(async () => {
    try {
      const files = await pickMany({ source: 'prompt', limit: MAX_SETUP_PHOTOS, accept: 'image/*' });
      if (!files.length) return;
      handleFileSelect(files);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to choose photos');
    }
  }, [handleFileSelect, pickMany]);

  const removeFile = (index: number) => {
    setUploadItems(prev => prev.filter((_, i) => i !== index));
    setTags(prev =>
      prev
        .filter(t => (t.photo_index ?? 0) !== index)
        .map(t => {
          const pi = t.photo_index ?? 0;
          if (pi > index) return { ...t, photo_index: pi - 1 };
          return t;
        })
    );
    setPopupState(prev => {
      if (!prev) return null;
      if (prev.photoIndex === index) return null;
      if (prev.photoIndex > index) return { ...prev, photoIndex: prev.photoIndex - 1 };
      return prev;
    });
    setSelectedPhotoIndex(prev => {
      if (prev === index) return 0;
      if (prev > index) return prev - 1;
      return prev;
    });
  };

  const reorderUploadItems = useCallback((oldIndex: number, newIndex: number) => {
    if (oldIndex === newIndex) return;
    setUploadItems(prev => {
      if (oldIndex < 0 || oldIndex >= prev.length || newIndex < 0 || newIndex >= prev.length) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
    setTags(prev =>
      prev.map(t => {
        const pi = t.photo_index ?? 0;
        if (pi === oldIndex) return { ...t, photo_index: newIndex };
        if (oldIndex < newIndex) {
          if (pi > oldIndex && pi <= newIndex) return { ...t, photo_index: pi - 1 };
        } else {
          if (pi >= newIndex && pi < oldIndex) return { ...t, photo_index: pi + 1 };
        }
        return t;
      })
    );
    setPopupState(prev => {
      if (!prev) return null;
      if (prev.photoIndex === oldIndex) return { ...prev, photoIndex: newIndex };
      let ni = prev.photoIndex;
      if (oldIndex < newIndex) {
        if (ni > oldIndex && ni <= newIndex) ni--;
      } else {
        if (ni >= newIndex && ni < oldIndex) ni++;
      }
      return { ...prev, photoIndex: ni };
    });
    setSelectedPhotoIndex(prev => {
      if (prev === oldIndex) return newIndex;
      let ni = prev;
      if (oldIndex < newIndex) {
        if (ni > oldIndex && ni <= newIndex) ni--;
      } else {
        if (ni >= newIndex && ni < oldIndex) ni++;
      }
      return ni;
    });
  }, []);

  const handleSetupDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = uploadItems.findIndex((_, i) => `setup-upload-${i}` === active.id);
    const newIndex = uploadItems.findIndex((_, i) => `setup-upload-${i}` === over.id);
    if (oldIndex !== -1 && newIndex !== -1) reorderUploadItems(oldIndex, newIndex);
  }, [uploadItems, reorderUploadItems]);

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>, photoIndex: number) => {
    e.stopPropagation();
    // Releasing a dot drag can surface as a click — don't drop a second tag.
    if (justDraggedTagRef.current) return;
    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    const x = Math.max(0, Math.min(1, offsetX / rect.width));
    const y = Math.max(0, Math.min(1, offsetY / rect.height));
    setPopupState({ photoIndex, x, y });
    setEditingTagIndex(null);
    setTempProductName('');
    setTempProductLink('');
  };

  // Drag the placement dot to reposition the tag before/while editing. Pointer
  // events cover both mouse (desktop web) and touch (iOS Capacitor shell).
  const handleTagDotPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.preventDefault();
    isDraggingTagRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleTagDotPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!isDraggingTagRef.current) return;
    const img = setupImageRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setPopupState(prev => (prev ? { ...prev, x, y } : prev));
    if (editingTagIndex !== null) {
      setTags(prev => prev.map((t, i) => (i === editingTagIndex ? { ...t, x, y } : t)));
    }
  };

  const handleTagDotPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (!isDraggingTagRef.current) return;
    isDraggingTagRef.current = false;
    justDraggedTagRef.current = true;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    // Clear on the next tick so the trailing synthetic click is suppressed but
    // genuine later clicks still place tags.
    window.setTimeout(() => {
      justDraggedTagRef.current = false;
    }, 0);
  };

  const handleTagMarkerClick = (e: React.MouseEvent, tagIndex: number) => {
    e.stopPropagation();
    const tag = tags[tagIndex];
    if (!tag) return;
    setPopupState({
      photoIndex: tag.photo_index ?? 0,
      x: tag.x,
      y: tag.y,
    });
    setEditingTagIndex(tagIndex);
    setTempProductName(tag.product_name);
    setTempProductLink(tag.product_link);
  };

  const handleSaveTag = () => {
    if (!popupState || !tempProductName.trim() || !tempProductLink.trim()) return;
    const newTag: SetupTag = {
      x: popupState.x,
      y: popupState.y,
      product_name: tempProductName.trim(),
      product_link: tempProductLink.trim(),
      photo_index: popupState.photoIndex,
    };
    if (editingTagIndex !== null) {
      setTags(prev => prev.map((t, i) => (i === editingTagIndex ? newTag : t)));
      setEditingTagIndex(null);
    } else {
      setTags(prev => [...prev, newTag]);
    }
    setPopupState(null);
    setTempProductName('');
    setTempProductLink('');
  };

  const handleCancelTag = () => {
    setPopupState(null);
    setEditingTagIndex(null);
    setTempProductName('');
    setTempProductLink('');
  };

  const handleRemoveTagFromPopup = () => {
    if (editingTagIndex !== null) {
      removeTag(editingTagIndex);
      setEditingTagIndex(null);
    }
    setPopupState(null);
    setTempProductName('');
    setTempProductLink('');
  };

  const removeTag = (tagIndex: number) => {
    setTags(prev => prev.filter((_, i) => i !== tagIndex));
  };

  const openEditModal = useCallback(async (setup: StudentSetup) => {
    if (!user || setup.user_id !== user.id) return;
    setEditingSetupId(setup.id);
    setCaption(setup.caption ?? '');
    setTiktokUrl(setup.tiktok_url ?? '');
    setTiktokUrlError('');
    setAuthorName(setup.author_name ?? '');
    setTags((setup?.tags as SetupTag[]) ?? []);

    const { data: photoData } = await supabase
      .from('setup_photos')
      .select('image_url')
      .eq('setup_id', setup.id)
      .order('created_at', { ascending: true });

    const urls: string[] =
      photoData && photoData.length > 0
        ? photoData.map((p: { image_url: string }) => p.image_url)
        : setup.image_url
          ? [setup.image_url]
          : [];

    setUploadItems(urls.slice(0, MAX_SETUP_PHOTOS).map(url => ({ type: 'url' as const, url })));
    setSelectedPhotoIndex(0);
    setPopupState(null);
    setEditingTagIndex(null);
    setTempProductName('');
    setTempProductLink('');
    setUploadDialogOpen(true);
  }, [user]);

  const handleUploadDialogChange = useCallback((open: boolean) => {
    if (!open) {
      setUploadItems([]);
      setCaption('');
      setTiktokUrl('');
      setTiktokUrlError('');
      setTags([]);
      setPopupState(null);
      setEditingTagIndex(null);
      setTempProductName('');
      setTempProductLink('');
      setSelectedPhotoIndex(0);
      setEditingSetupId(null);
    }
    setUploadDialogOpen(open);
    modalOverlay?.setHideBottomNav(open);
  }, [modalOverlay]);

  const handleUpload = async () => {
    if (uploadItems.length === 0) {
      toast.error(t('housing:portal.setups.upload.noPhotosError'));
      return;
    }
    if (!authorName.trim()) {
      toast.error(t('housing:portal.setups.upload.noNameError'));
      return;
    }
    if (!user?.id) {
      toast.error(t('housing:portal.setups.upload.notSignedInError'));
      return;
    }

    const trimmedTiktok = tiktokUrl.trim();
    let tiktokUrlToSave: string | null = null;
    if (trimmedTiktok) {
      // One field, two platforms: a TikTok video link or an Instagram Reel.
      const tour = canonicalTourUrl(trimmedTiktok);
      if (!tour) {
        setTiktokUrlError(t('housing:portal.setups.upload.tourErrorMsg'));
        return;
      }
      tiktokUrlToSave = tour.url;
    } else {
      setTiktokUrlError('');
    }

    // One setup per building: when creating (not editing), block if user already has a setup for this dorm
    if (!editingSetupId && dormId != null) {
      const { data: existing } = await supabase
        .from('student_setups')
        .select('id')
        .eq('dorm_id', dormId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (existing) {
        toast.error(t('housing:portal.setups.upload.duplicateSetupError'));
        return;
      }
    }

    setIsUploading(true);
    const uploadedPaths: string[] = [];

    try {
      const finalUrls: string[] = [];

      for (const item of uploadItems) {
        if (item.type === 'url') {
          const safe = safeImageSrc(item.url);
          if (safe) finalUrls.push(safe);
        } else {
          const file = item.file;
          const fileExt = file.name.split('.').pop();
          const fileName = `${user.id}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

          // Screened before the setup row is written, so a refused photo never
          // reaches the public setups grid. `uploadAndScreen` deletes the object
          // and throws; the catch below reports it and nothing is saved.
          finalUrls.push(
            await uploadAndScreen({
              bucket: 'setup-photos',
              path: fileName,
              file,
              context: 'setup_photo',
              // student_setups.id is a bigint, and moderation_actions.content_id
              // is a uuid, so the uploader is the only key that fits.
              contentId: user.id,
            }),
          );
          uploadedPaths.push(fileName);
        }
      }

      if (finalUrls.length === 0) {
        toast.error(t('housing:portal.setups.upload.noValidImagesError'));
        setIsUploading(false);
        return;
      }

      if (editingSetupId) {
        // Update existing setup
        const { error: updateError } = await supabase
          .from('student_setups')
          .update({
            image_url: finalUrls[0],
            author_name: sanitizeText(authorName),
            caption: sanitizeOptional(caption),
            tags: (tags.length > 0 ? tags : null) as unknown as Json,
            tiktok_url: tiktokUrlToSave,
          })
          .eq('id', editingSetupId)
          .eq('user_id', user.id);

        if (updateError) {
          throw new Error(`Failed to update setup: ${updateError.message}`);
        }

        // Replace setup_photos: capture existing first so we can purge storage
        // objects for any photo the user dropped, then delete + insert new.
        const { data: existingPhotos } = await supabase
          .from('setup_photos')
          .select('image_url')
          .eq('setup_id', editingSetupId);

        await supabase.from('setup_photos').delete().eq('setup_id', editingSetupId);

        const photoInserts = finalUrls.map(url => ({
          setup_id: editingSetupId,
          image_url: url,
        }));
        const { error: photosError } = await supabase.from('setup_photos').insert(photoInserts);
        if (photosError) {
          console.error('Failed to update setup photos:', photosError);
        }

        // Best-effort: remove storage objects for photos no longer referenced.
        // Non-storage (pasted http) URLs resolve to null and are skipped.
        const keep = new Set(finalUrls);
        const removedPaths = (existingPhotos ?? [])
          .map((p: { image_url: string | null }) => p.image_url)
          .filter((u): u is string => Boolean(u) && !keep.has(u as string))
          .map(url => getStoragePathFromPublicUrl(url))
          .filter((p): p is string => Boolean(p));
        if (removedPaths.length > 0) {
          const { error: storageError } = await supabase.storage
            .from('setup-photos')
            .remove(removedPaths);
          if (storageError) {
            console.error('Failed to purge removed setup images from storage:', storageError);
          }
        }

        toast.success(t('housing:portal.setups.upload.updateSuccessMsg'));
      } else {
        // Insert new setup (use dorm_id when available for ID-based tracking)
        const insertPayload: Database['public']['Tables']['student_setups']['Insert'] = {
          dorm_name: dormName,
          image_url: finalUrls[0],
          author_name: sanitizeText(authorName),
          caption: sanitizeOptional(caption),
          likes: 0,
          tags: (tags.length > 0 ? tags : null) as unknown as Json,
          tiktok_url: tiktokUrlToSave,
          user_id: user.id,
          ...(dormId != null ? { dorm_id: dormId } : {}),
        };
        const { data: setupData, error: setupError } = await supabase
          .from('student_setups')
          .insert(insertPayload)
          .select()
          .single();

        if (setupError) {
          if (
            setupError.code === '23505' ||
            /unique constraint|duplicate key|already exists/i.test(setupError.message)
          ) {
            toast.error(t('housing:portal.setups.upload.duplicateSetupError'));
            return;
          }
          throw new Error(`Failed to create setup: ${setupError.message}`);
        }

        const photoInserts = finalUrls.map(url => ({
          setup_id: setupData.id,
          image_url: url,
        }));
        const { error: photosError } = await supabase.from('setup_photos').insert(photoInserts);
        if (photosError) {
          console.error('Failed to insert additional photos:', photosError);
        }

        toast.success(t('housing:portal.setups.upload.uploadSuccessMsg'));
      }

      setUploadDialogOpen(false);
      setUploadItems([]);
      setCaption('');
      setTiktokUrl('');
      setTiktokUrlError('');
      setTags([]);
      setPopupState(null);
      setEditingSetupId(null);
      fetchSetups();
      await queryClient.invalidateQueries({ queryKey: ['student_setups', 'my_setup', user?.id, dormId] });
    } catch (error) {
      if (uploadedPaths.length > 0) {
        const { error: cleanupError } = await supabase.storage
          .from('setup-photos')
          .remove(uploadedPaths);
        if (cleanupError) console.error('Setup photo orphan cleanup error:', cleanupError);
      }
      console.error('Upload error:', error);
      // A safety-screen refusal gets its own sentence rather than the generic
      // upload error, which would read as "try again" for a photo that cannot pass.
      if (error instanceof ImageRejectedError) toast.error(error.message);
      else toast.error(t('housing:portal.setups.upload.uploadErrorMsg'));
    } finally {
      setIsUploading(false);
    }
  };

  // Memoized so the clone+sort and filter only recompute when their real inputs
  // change, not on every unrelated state update (uploading, tags, deleting, …).
  const sortedSetups = useMemo(() => {
    return [...setups].sort((a, b) => {
      if (sortMode === 'votes') return b.likes - a.likes;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [setups, sortMode]);

  const filteredSetups = useMemo(
    () => (showLikedOnly ? sortedSetups.filter((s) => likedSetupIds.has(s.id)) : sortedSetups),
    [sortedSetups, showLikedOnly, likedSetupIds],
  );

  const visibleSetups = filteredSetups.slice(0, visibleCount);
  const hasMore = visibleCount < filteredSetups.length;

  const handleLoadMore = () => {
    setVisibleCount(prev => prev + 6);
  };

  const getStoragePathFromPublicUrl = (url: string | null | undefined): string | null => {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      const marker = '/setup-photos/';
      const idx = parsed.pathname.indexOf(marker);
      if (idx === -1) return null;
      return parsed.pathname.substring(idx + marker.length);
    } catch {
      return null;
    }
  };

  const handleDeleteSetup = async (setupId: number) => {
    if (!user) {
      toast(t('housing:portal.setups.detail.signInToManageSetups'));
      navigate('/auth');
      return;
    }

    const setup = setups.find(s => s.id === setupId);
    if (!setup) return;

    if (setup.user_id && setup.user_id !== user.id) {
      toast.error(t('housing:portal.setups.detail.onlyDeleteOwnMsg'));
      return;
    }

    const confirmDelete = window.confirm(t('housing:portal.setups.detail.deleteConfirmMsg'));
    if (!confirmDelete) return;

    setDeletingSetupId(setupId);

    try {
      // Collect all image URLs (cover + additional photos)
      const imageUrls = new Set<string>();
      if (setup.image_url) {
        imageUrls.add(setup.image_url);
      }

      const { data: photoData, error: photosError } = await supabase
        .from('setup_photos')
        .select('image_url')
        .eq('setup_id', setupId);

      if (photosError) {
        console.error('Failed to load setup photos for deletion:', photosError);
      } else {
        (photoData || []).forEach((photo: { image_url: string }) => {
          if (photo.image_url) {
            imageUrls.add(photo.image_url);
          }
        });
      }

      // Delete the setup record (RLS ensures only owner can delete)
      const { error: deleteError } = await supabase
        .from('student_setups')
        .delete()
        .eq('id', setupId);

      if (deleteError) {
        console.error('Delete setup error:', deleteError);
        toast.error(t('housing:portal.setups.detail.deleteErrorMsg'));
        return;
      }

      // Optimistically remove from local state and close modal if needed
      setSetups(prev => prev.filter(s => s.id !== setupId));
      if (selectedSetupId === setupId) {
        setSelectedSetupId(null);
      }

      // Invalidate any cached queries for student setups
      try {
        await queryClient.invalidateQueries({ queryKey: ['student_setups'] });
        await queryClient.invalidateQueries({ queryKey: ['student_setups', 'my_setup', user?.id, dormId] });
      } catch (invalidateError) {
        console.error('Failed to invalidate student_setups query:', invalidateError);
      }

      // Cleanup storage images (best-effort)
      const paths = Array.from(imageUrls)
        .map(url => getStoragePathFromPublicUrl(url))
        .filter((p): p is string => Boolean(p));

      if (paths.length > 0) {
        const { error: storageError } = await supabase.storage
          .from('setup-photos')
          .remove(paths);

        if (storageError) {
          console.error('Failed to delete setup images from storage:', storageError);
        }
      }

      toast.success(t('housing:portal.setups.detail.deleteSuccessMsg'));
    } catch (err) {
      console.error('Unexpected error deleting setup:', err);
      toast.error(t('housing:portal.setups.detail.deleteUnexpectedErrorMsg'));
    } finally {
      setDeletingSetupId(null);
    }
  };

  const handleLike = async (setupId: number) => {
    if (!user) {
      toast(t('housing:portal.setups.detail.signInToLike'));
      navigate('/auth');
      return;
    }
    const currentlyLiked = likedSetupIds.has(setupId);

    // Optimistic UI update: update likedSetupIds immediately
    setLikedSetupIds(prev => {
      const next = new Set(prev);
      if (currentlyLiked) next.delete(setupId);
      else next.add(setupId);
      return next;
    });
    
    // Optimistic UI update: update setup_likes array and likes count immediately
    setSetups(prev =>
      prev.map(s => {
        if (s.id === setupId) {
          const currentLikes = s.setup_likes || [];
          let updatedLikes: Array<{ user_id: string }>;
          
          if (currentlyLiked) {
            // Remove like
            updatedLikes = currentLikes.filter((like: { user_id: string }) => like.user_id !== user.id);
          } else {
            // Add like
            updatedLikes = [...currentLikes, { user_id: user.id }];
          }
          
          return {
            ...s,
            setup_likes: updatedLikes,
            likes: updatedLikes.length,
          };
        }
        return s;
      })
    );

    try {
      if (currentlyLiked) {
        const { error } = await supabase
          .from('setup_likes')
          .delete()
          .eq('setup_id', setupId)
          .eq('user_id', user.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('setup_likes').insert({
          setup_id: setupId,
          user_id: user.id,
        });
        if (error) throw error;
      }
      // Note: We no longer update the likes column in student_setups
      // The count is now derived from setup_likes array length
    } catch (err) {
      // Rollback optimistic update on error
      setLikedSetupIds(prev => {
        const next = new Set(prev);
        if (currentlyLiked) next.add(setupId);
        else next.delete(setupId);
        return next;
      });
      setSetups(prev =>
        prev.map(s => {
          if (s.id === setupId) {
            const currentLikes = s.setup_likes || [];
            let updatedLikes: Array<{ user_id: string }>;
            
            if (currentlyLiked) {
              // Rollback: add back the like
              updatedLikes = [...currentLikes, { user_id: user.id }];
            } else {
              // Rollback: remove the like
              updatedLikes = currentLikes.filter((like: { user_id: string }) => like.user_id !== user.id);
            }
            
            return {
              ...s,
              setup_likes: updatedLikes,
              likes: updatedLikes.length,
            };
          }
          return s;
        })
      );
      console.error('Like failed:', err);
      toast.error(t('housing:portal.setups.detail.likeErrorMsg'));
    }
  };

  const selectedSetup =
    selectedSetupId != null && !isSetupPreviewTeaserId(selectedSetupId)
      ? setups.find((s) => s.id === selectedSetupId) ?? null
      : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // One CTA definition, rendered in whichever slot the width allows. Always
  // labelled - the icon alone does not say what the button does.
  const shareCta = user ? (
    mySetup ? (
      <Button
        size="sm"
        className="shrink-0 gap-1.5 rounded-pill"
        onClick={() => {
          const fullSetup: StudentSetup = {
            ...mySetup,
            likes: 0,
            dorm_name: dormName,
            created_at: '',
            setup_likes: [],
          };
          openEditModal(fullSetup);
        }}
      >
        <Settings2 className="h-4 w-4 shrink-0" aria-hidden />
        {t('housing:portal.setups.header.manage')}
      </Button>
    ) : (
      <Button
        size="sm"
        className="shrink-0 gap-1.5 rounded-pill"
        onClick={() => setUploadDialogOpen(true)}
      >
        <Upload className="h-4 w-4 shrink-0" aria-hidden />
        {t('housing:portal.setups.header.share')}
      </Button>
    )
  ) : (
    <Button
      size="sm"
      className="shrink-0 gap-1.5 rounded-pill"
      onClick={() => {
        toast(t('housing:portal.setups.empty.noSignInToShare'));
        navigate('/auth');
      }}
    >
      <Lock className="h-4 w-4 shrink-0" aria-hidden />
      {t('housing:portal.setups.header.signIn')}
    </Button>
  );

  return (
    <div className="space-y-3 sm:space-y-4 animate-fade-in">
      {/* Feed header - one segmented control for the three views, one labelled CTA.
          The CTA never renders icon-only: on mobile it drops to its own full-width
          row below the segments (an unlabelled green square read as a mystery
          button). Sticky to the safe-area top - the hall's back/save controls now
          live inside the hero and scroll away, so there is no bar to clear. */}
      <div className="sticky top-[env(safe-area-inset-top)] z-20 space-y-2 border-b border-border/50 bg-background/95 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          {/* View segmented control - Top / Recent / Liked */}
          <div className="flex min-w-0 flex-1 gap-0.5 rounded-pill border border-border bg-muted/40 p-0.5 sm:flex-none">
            {SETUP_VIEWS.map((view) => {
              const active = activeView === view.id;
              const Icon = view.icon;
              return (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => selectView(view.id)}
                  aria-pressed={active}
                  className={cn(
                    'inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-pill px-2.5 text-xs font-semibold transition-colors sm:flex-none sm:px-3',
                    active
                      ? 'bg-card text-foreground shadow-raised'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      active && view.id === 'liked' && 'fill-current',
                      active && 'text-primary',
                    )}
                    aria-hidden
                  />
                  <span className="truncate">{t(view.labelKey)}</span>
                </button>
              );
            })}
          </div>

          {/* Same CTA, inline from sm up */}
          <div className="ml-auto hidden shrink-0 sm:block">{shareCta}</div>
        </div>

        {/* Mobile: the CTA gets its own full-width row so it keeps its label */}
        <div className="sm:hidden [&>button]:w-full">{shareCta}</div>
      </div>

      <Dialog open={uploadDialogOpen} onOpenChange={handleUploadDialogChange}>
        <DialogContent className="fixed inset-0 top-0 left-0 right-0 bottom-0 z-[10061] w-full h-full max-w-none m-0 rounded-none translate-x-0 translate-y-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-w-6xl sm:w-[95vw] sm:h-[85vh] md:h-[80vh] sm:rounded-xl p-0 gap-0 overflow-hidden flex flex-col [&>:last-child]:top-[max(0.75rem,env(safe-area-inset-top))] [&>:last-child]:right-[max(0.75rem,env(safe-area-inset-right))] sm:[&>:last-child]:top-4 sm:[&>:last-child]:right-4">
              <DialogHeader className="sr-only">
                <DialogTitle>{t('housing:portal.setups.upload.dialogTitle')}</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col md:grid md:grid-cols-[1.5fr_1fr] flex-1 min-h-0 overflow-hidden">
                {/* LEFT: Image area (60%) - fixed height on mobile so only form scrolls */}
                <div className="relative flex-1 min-h-[280px] md:min-h-0 max-h-[52vh] sm:max-h-none shrink-0 sm:shrink bg-muted flex flex-col overflow-hidden">
                  {uploadItems.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => void handlePickSetupPhotos()}
                      className="flex-1 flex flex-col items-center justify-center p-8 cursor-pointer hover:bg-accent/80 transition-colors"
                    >
                      <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                        <Camera className="w-10 h-10 text-primary" />
                      </div>
                      <p className="font-medium text-foreground">{t('housing:portal.setups.upload.tapUpload')}</p>
                      <p className="text-sm text-muted-foreground mt-1">{t('housing:portal.setups.upload.photosLimitHint', { MAX_SETUP_PHOTOS })}</p>
                    </button>
                  ) : (
                    <>
                      {/* Large image with click-to-tag - shared wrapper has exact image aspect ratio; tags % are relative to photo only. No overflow-hidden so the floating entry card + marker labels can extend past the photo box without being clipped. */}
                      <div className="flex-1 relative flex items-center justify-center bg-muted min-h-0 [container-type:size]">
                        <div
                          className="relative flex-shrink-0 flex items-center justify-center"
                          style={
                            setupImageDimensions
                              ? {
                                  width: 'min(100cqw, 100cqh * (var(--img-w) / var(--img-h)))',
                                  height: 'min(100cqh, 100cqw * (var(--img-h) / var(--img-w)))',
                                  ['--img-w' as string]: setupImageDimensions.w,
                                  ['--img-h' as string]: setupImageDimensions.h,
                                }
                              : { width: '100%', height: '100%' }
                          }
                        >
                          <img
                            ref={setupImageRef}
                            src={uploadItems[selectedPhotoIndex] ? getUploadItemUrl(uploadItems[selectedPhotoIndex]) : (uploadItems[0] ? getUploadItemUrl(uploadItems[0]) : '')}
                            alt={`Photo ${(selectedPhotoIndex ?? 0) + 1}`}
                            className="block w-full h-full object-contain cursor-crosshair"
                            onClick={(e) => handleImageClick(e, selectedPhotoIndex ?? 0)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                const x = 0.5;
                                const y = 0.5;
                                setPopupState({ photoIndex: selectedPhotoIndex ?? 0, x, y });
                                setEditingTagIndex(null);
                                setTempProductName('');
                                setTempProductLink('');
                              }
                            }}
                            role="button"
                            tabIndex={0}
                            onLoad={(e) => {
                              const img = e.currentTarget;
                              setSetupImageDimensions({ w: img.naturalWidth, h: img.naturalHeight });
                            }}
                          />
                          <div className="absolute inset-0 pointer-events-none">
                            {tags.map((tag, i) =>
                              (tag.photo_index ?? 0) === (selectedPhotoIndex ?? 0) ? (
                                <ProductTagMarker
                                  key={i}
                                  xPct={tag.x * 100}
                                  yPct={tag.y * 100}
                                  label={tag.product_name}
                                  onClick={(e) => handleTagMarkerClick(e, i)}
                                  ariaLabel={`Edit tag: ${tag.product_name}`}
                                />
                              ) : null
                            )}
                            {popupState?.photoIndex === (selectedPhotoIndex ?? 0) && (
                              <button
                                type="button"
                                onPointerDown={handleTagDotPointerDown}
                                onPointerMove={handleTagDotPointerMove}
                                onPointerUp={handleTagDotPointerUp}
                                onPointerCancel={handleTagDotPointerUp}
                                aria-label="Drag to reposition tag"
                                className="absolute h-6 w-6 rounded-full bg-primary/80 border-2 border-white shadow-overlay ring-2 ring-primary/30 pointer-events-auto cursor-grab touch-none focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/50"
                                style={{
                                  left: `${popupState.x * 100}%`,
                                  top: `${popupState.y * 100}%`,
                                  transform: 'translate(-50%, -50%)',
                                }}
                              />
                            )}
                          </div>
                          {popupState?.photoIndex === (selectedPhotoIndex ?? 0) && (
                            <SetupTagEntryCard
                              x={popupState.x}
                              y={popupState.y}
                              photoIndex={popupState.photoIndex}
                              isEditing={editingTagIndex !== null}
                              productName={tempProductName}
                              productLink={tempProductLink}
                              onProductNameChange={setTempProductName}
                              onProductLinkChange={setTempProductLink}
                              onSave={handleSaveTag}
                              onCancel={handleCancelTag}
                              onRemoveOrCancel={handleRemoveTagFromPopup}
                            />
                          )}
                        </div>
                        {!popupState && (
                          <p className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-white/90 bg-black/50 backdrop-blur-sm px-3 py-1.5 rounded-full">
                            {t('housing:portal.setups.upload.clickTag')}
                          </p>
                        )}
                      </div>
                      {/* Thumbnail strip - max 5 photos, drag to reorder, remove/replace before publishing */}
                      <div className="flex gap-2 p-3 pb-2 overflow-x-auto snap-x snap-mandatory border-t border-border bg-card  shrink-0 items-center">
                        <DndContext
                          sensors={setupUploadSensors}
                          collisionDetection={closestCenter}
                          onDragEnd={handleSetupDragEnd}
                        >
                          <SortableContext
                            items={uploadItems.map((_, i) => `setup-upload-${i}`)}
                            strategy={horizontalListSortingStrategy}
                          >
                            {uploadItems.map((item, index) => (
                              <SortableSetupThumbnail
                                key={`setup-${index}-${item.type === 'file' ? `${item.file.name}-${item.file.size}` : item.url}`}
                                id={`setup-upload-${index}`}
                                item={item}
                                index={index}
                                isSelected={(selectedPhotoIndex ?? 0) === index}
                                onSelect={() => setSelectedPhotoIndex(index)}
                                onRemove={() => removeFile(index)}
                              />
                            ))}
                          </SortableContext>
                        </DndContext>
                        {uploadItems.length < MAX_SETUP_PHOTOS && (
                          <button
                            type="button"
                            onClick={() => void handlePickSetupPhotos()}
                            className="shrink-0 w-16 h-16 rounded-md border-2 border-dashed border-border flex items-center justify-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors snap-start"
                            aria-label={t('housing:portal.setups.upload.addPhotosBtn')}
                          >
                            <Plus className="w-6 h-6 text-muted-foreground" />
                          </button>
                        )}
                        <span className="shrink-0 text-xs font-light text-muted-foreground ml-1">
                          {t('housing:portal.setups.upload.photoCountLabel', { current: uploadItems.length, max: MAX_SETUP_PHOTOS })}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* RIGHT: Scrollable sidebar (40%) - flex-1 fills remaining height; footer pinned at bottom */}
                <div className="flex flex-1 flex-col min-h-0 overflow-hidden border-t md:border-t-0 md:border-l border-border bg-card">
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6 space-y-5 sm:space-y-8 pb-[calc(var(--keyboard-height,0px)+max(0.75rem,env(safe-area-inset-bottom)))]">
                    {/* Profile card: Your Name */}
                    <div className="flex items-center gap-3 sm:gap-4">
                      <div className="w-9 h-9 sm:w-12 sm:h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-lg font-semibold text-primary">
                          {(authorName || '?').charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <label htmlFor="setup-author-name" className="block text-xs font-medium text-muted-foreground mb-1">{t('housing:portal.setups.upload.yourName')}</label>
                        <Input
                          id="setup-author-name"
                          value={authorName}
                          onChange={(e) => setAuthorName(e.target.value)}
                          placeholder={t('housing:portal.setups.upload.yourNamePlaceholder')}
                          className="h-10 rounded-lg border-border bg-muted/50 focus:ring-2 focus:ring-malachite-600/50 focus:border-malachite-600 focus:bg-card"
                        />
                      </div>
                    </div>

                    {/* Caption */}
                    <div>
                      <label htmlFor="setup-caption" className="block text-sm font-medium text-foreground mb-2">{t('housing:portal.setups.upload.caption')}</label>
                      <Textarea
                        id="setup-caption"
                        value={caption}
                        onChange={(e) => setCaption(e.target.value)}
                        placeholder={t('housing:portal.setups.upload.captionPlaceholder')}
                        rows={2}
                        className="rounded-lg border-border resize-none focus:ring-2 focus:ring-malachite-600/50 focus:border-malachite-600"
                      />
                    </div>

                    <div>
                      <label htmlFor="setup-tiktok-url" className="block text-sm font-medium text-foreground mb-2">
                        {t('housing:portal.setups.upload.tourLabel')}
                      </label>
                      <Input
                        id="setup-tiktok-url"
                        type="url"
                        inputMode="url"
                        value={tiktokUrl}
                        onChange={(e) => {
                          setTiktokUrl(e.target.value);
                          if (tiktokUrlError) setTiktokUrlError('');
                        }}
                        placeholder={t('housing:portal.setups.upload.tourPlaceholder')}
                        className={cn(
                          'h-10 rounded-lg border-border bg-muted/50 focus:ring-2 focus:ring-malachite-600/50 focus:border-malachite-600 focus:bg-card',
                          tiktokUrlError && 'border-red-500 focus:border-red-500 focus:ring-red-500/30',
                        )}
                        aria-invalid={Boolean(tiktokUrlError)}
                        aria-describedby={tiktokUrlError ? 'tiktok-url-error' : undefined}
                      />
                      {tiktokUrlError ? (
                        <p id="tiktok-url-error" className="mt-1.5 text-sm text-red-600">
                          {tiktokUrlError}
                        </p>
                      ) : (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {t('housing:portal.setups.upload.tourHint')}
                        </p>
                      )}
                    </div>

                    {/* Desktop tag entry now renders as a floating card anchored at the
                        tap point over the photo (SetupTagEntryCard); the mobile bottom
                        sheet below still handles narrow viewports. */}

                    {/* Tagged products - horizontal chips above location, no label */}
                    {uploadItems.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {tags.map((tag, i) => {
                          const tagHref = safeHref(tag.product_link);
                          return (tag.photo_index ?? 0) === (selectedPhotoIndex ?? 0) ? (
                            <div
                              key={i}
                              className="inline-flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-full bg-muted/80 border border-border text-foreground shadow-raised"
                            >
                              <span className="text-sm font-medium truncate max-w-[140px]">
                                {tag.product_name}
                              </span>
                              {tagHref ? (
                                <a
                                  href={tagHref}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
                                >
                                  View
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => removeTag(i)}
                                className="p-1 text-muted-foreground hover:text-red-500 rounded-full transition-colors"
                                aria-label="Remove tag"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          ) : null;
                        })}
                      </div>
                    )}

                  </div>

                  <div className="shrink-0 border-t border-border bg-card p-4 pb-[calc(var(--keyboard-height,0px)+max(0.75rem,env(safe-area-inset-bottom)))]">
                    <Button
                      className="w-full rounded-full h-12 min-h-12 font-medium bg-primary hover:bg-primary/90 text-primary-foreground touch-manipulation"
                      onClick={handleUpload}
                      disabled={isUploading || uploadItems.length === 0}
                    >
                      {isUploading ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {editingSetupId ? 'Updating...' : 'Uploading...'}
                        </>
                      ) : editingSetupId ? (
                        'Update Setup'
                      ) : (
                        'Upload Setup'
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Mobile tag entry bottom sheet - same state/handlers as inline desktop form */}
              {popupState && (
                <>
                  <button
                    type="button"
                    className="sm:hidden absolute inset-0 z-40 bg-black/30 animate-in fade-in duration-200"
                    onClick={handleCancelTag}
                    aria-label="Cancel tagging"
                  />
                  <div className="sm:hidden absolute inset-x-0 bottom-0 z-50 space-y-4 rounded-t-2xl bg-card p-4 pb-[calc(var(--keyboard-height,0px)+max(0.75rem,env(safe-area-inset-bottom)))] shadow-overlay animate-in slide-in-from-bottom duration-300">
                    <div className="relative">
                      <button
                        type="button"
                        onClick={handleRemoveTagFromPopup}
                        className="absolute top-0 right-0 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground touch-manipulation"
                        aria-label={editingTagIndex !== null ? 'Remove this tag' : 'Cancel'}
                      >
                        <X className="h-4 w-4" />
                      </button>
                      <div className="flex items-center gap-2 pr-10">
                        <MapPin className="h-5 w-5 shrink-0 text-primary" />
                        <span className="font-semibold text-foreground">
                          {t('housing:portal.setups.productTags.tagOnPhoto', { index: popupState.photoIndex + 1 })}
                        </span>
                      </div>
                    </div>
                    <Input
                      value={tempProductName}
                      onChange={(e) => setTempProductName(e.target.value)}
                      placeholder={t('housing:portal.setups.productTags.productName')}
                      className="h-12 rounded-xl"
                    />
                    <div className="flex gap-2">
                      <Input
                        value={tempProductLink}
                        onChange={(e) => setTempProductLink(e.target.value)}
                        placeholder={t('housing:portal.setups.productTags.linkUrl')}
                        className="h-12 min-w-0 flex-1 rounded-xl"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            const text = await navigator.clipboard.readText();
                            if (text?.trim()) setTempProductLink(text.trim());
                            else toast.error(t('common:state.clipboardEmpty'));
                          } catch {
                            toast.error(t('common:state.clipboardFailed'));
                          }
                        }}
                        className="h-12 min-h-12 shrink-0 rounded-xl px-4"
                      >
                        <Clipboard className="mr-2 h-4 w-4" />
                        {t('housing:portal.setups.upload.pasteLink')}
                      </Button>
                    </div>
                    <div className="flex gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleCancelTag}
                        className="h-12 min-h-12 flex-1 rounded-full px-4"
                      >
                        {t('common:actions.cancel')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleSaveTag}
                        disabled={!tempProductName.trim() || !tempProductLink.trim()}
                        className="h-12 min-h-12 flex-1 rounded-full bg-indigo-600 px-4 font-semibold text-white hover:bg-indigo-700 disabled:bg-muted disabled:text-muted-foreground"
                      >
                        {t('housing:portal.setups.productTags.tagSaveBtn')}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </DialogContent>
      </Dialog>

      {/* Photo Grid */}
      {setups.length === 0 ? (
        <EmptyState
          className="py-10 sm:py-12"
          icon={Camera}
          title={t('housing:portal.setups.empty.firstToPost')}
          description={t('housing:portal.setups.empty.noSetupsMsg', { dormName })}
        />
      ) : filteredSetups.length === 0 && showLikedOnly ? (
        <EmptyState
          className="py-10 sm:py-12"
          icon={Heart}
          title={t('housing:portal.setups.empty.noLikedMsg')}
          description={t('housing:portal.setups.empty.likeHint')}
          action={
            <Button variant="outline" size="sm" onClick={() => setShowLikedOnly(false)}>
              {t('housing:portal.setups.empty.showAll')}
            </Button>
          }
        />
      ) : (
        <>
          <SneakPeekBlurWall
            isAuthenticated={!!user}
            className="w-full"
            title="Get Inspired by Real Setups"
            description="Sign in to explore dorm photos, see item details, and save your favorites."
          >
            {/* Instagram-style tile grid: every cell is a fixed square so one
                tall portrait photo can never stretch a column (the old
                `columns-*` masonry let a single setup fill the whole viewport
                height and leave the next column empty). True aspect ratios are
                shown in the detail view, not the grid. */}
            <div className="grid grid-cols-3 gap-0.5">
              {visibleSetups.map((setup, index) => (
              <div
                key={setup.id}
                onClick={() => {
                  if (!user) {
                    navigate('/auth');
                    return;
                  }
                  setSelectedSetupId(setup.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (!user) {
                      navigate('/auth');
                      return;
                    }
                    setSelectedSetupId(setup.id);
                  }
                }}
                role="button"
                tabIndex={0}
                className="group relative aspect-square cursor-pointer overflow-hidden bg-stone-100 animate-scale-in dark:bg-stone-800"
                style={{ animationDelay: `${index * 30}ms` }}
              >
                <ThumbImage
                  src={safeImageSrc(setup.image_url)}
                  thumbWidth={600}
                  alt={`Room by ${setup.author_name}`}
                  className="h-full w-full object-cover"
                />

                {/* Room-tour signal, mirroring Instagram's reel badge. */}
                {tourPlatformFor(setup.tiktok_url) === 'instagram' ? (
                  <span className="pointer-events-none absolute right-1.5 top-1.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
                    <Instagram className="h-4 w-4" strokeWidth={2} aria-hidden />
                  </span>
                ) : tourPlatformFor(setup.tiktok_url) === 'tiktok' ? (
                  <span className="pointer-events-none absolute right-1.5 top-1.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
                    <TikTokIcon className="h-4 w-4" />
                  </span>
                ) : null}

                {/* Desktop hover: likes, the way Instagram surfaces them on web.
                    Touch devices get no hover state and open the setup instead. */}
                <div className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 sm:flex">
                  <span className="flex items-center gap-1.5 text-white">
                    <Heart className="h-5 w-5 fill-white" strokeWidth={0} aria-hidden />
                    <span className="text-sm font-semibold tabular-nums">{setup.likes}</span>
                  </span>
                </div>
              </div>
            ))}
            </div>
          </SneakPeekBlurWall>

          {/* Load More Button */}
          {hasMore && (
            <div className="flex justify-center pt-4">
              <Button
                variant="outline"
                onClick={handleLoadMore}
                className="gap-2"
              >
                {t('housing:portal.setups.detail.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Setup Detail Modal */}
      {selectedSetup && (
        <SetupDetailModal
          setup={selectedSetup}
          isOpen={!!selectedSetup}
          onClose={() => setSelectedSetupId(null)}
          onLike={handleLike}
          isLiked={likedSetupIds.has(selectedSetup.id)}
          canDelete={Boolean(user && selectedSetup.user_id && selectedSetup.user_id === user.id)}
          onDelete={() => void handleDeleteSetup(selectedSetup.id)}
          isDeleting={deletingSetupId === selectedSetup.id}
          onEdit={user && selectedSetup.user_id === user.id ? () => openEditModal(selectedSetup) : undefined}
        />
      )}
    </div>
  );
}
