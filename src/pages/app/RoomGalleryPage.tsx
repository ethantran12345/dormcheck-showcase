import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { AppPageHeader } from '@/components/app/AppPageHeader';
import { PageToolbar } from '@/components/app/PageToolbar';
import { useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  Heart,
  Flame,
  Sparkles,
  Pencil,
  Trash2,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  AdaptiveOverlay,
  AdaptiveOverlayContent,
} from '@/components/ui/adaptive-overlay';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { supabase } from '@/integrations/supabase/client';
import { useBlockedUserIds } from '@/hooks/useBlockedUsers';
import { safeImageSrc } from '@/lib/sanitize';
import { useAuth } from '@/hooks/useAuth';
import { useUniversity } from '@/contexts/UniversityContext';
import { toast } from 'sonner';
import { SetupDetailModal } from '@/components/dorm-portal/SetupDetailModal';
import type { SetupTag } from '@/types';
import { dormSlugFromName } from '@/lib/dormSlug';
import { useCurrentUserBuilding } from '@/hooks/useCurrentUserBuilding';
import { useIsMobile } from '@/hooks/use-mobile';
import { SneakPeekBlurWall } from '@/components/ui/sneak-peek-blur-wall';
import {
  fetchSetupsPreview,
  isSetupPreviewTeaserId,
  mapSetupPreviewPhotos,
} from '@/lib/publicPreviewRpcs';

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
  is_hidden?: boolean;
  report_uuid?: string | null;
}

type SortMode = 'votes' | 'recent';

const PAGE_SIZE = 20;
/** Total likes across the gallery before "Top Voted" becomes the default sort.
 *  With near-zero vote volume a votes-first list is a sorted list of nothing. */
const VOTE_SORT_THRESHOLD = 10;

function mapRowToSetup(setup: Record<string, unknown>): StudentSetup {
  const setupLikes = (setup.setup_likes as Array<{ user_id: string }> | undefined) || [];
  return {
    id: setup.id as number,
    image_url: setup.image_url as string,
    author_name: (setup.author_name as string) ?? '',
    caption: (setup.caption as string | null) ?? null,
    likes: setupLikes.length,
    dorm_name: (setup.dorm_name as string) ?? '',
    created_at: (setup.created_at as string) ?? '',
    setup_likes: setupLikes,
    user_id: (setup.user_id as string | null) ?? null,
    tags: (setup?.tags as SetupTag[] | null) ?? null,
    tiktok_url: (setup.tiktok_url as string | null | undefined) ?? null,
    is_hidden: Boolean(setup.is_hidden),
    report_uuid: (setup.report_uuid as string | null | undefined) ?? null,
  };
}

/** Moderation-hidden rows and placeholder/logo art never render in the gallery.
 *  (Client-side so it also holds before the is_hidden migration reaches prod.) */
function isVisibleRoomPhoto(setup: StudentSetup): boolean {
  if (setup.is_hidden) return false;
  const url = setup.image_url?.toLowerCase() ?? '';
  if (!url) return false;
  if (url.includes('placeholder') || url.includes('dormcheck-logo') || url.includes('wordmark')) {
    return false;
  }
  return true;
}

function GallerySetupCard({
  setup,
  onOpen,
  likedSetupIds,
  onLike,
  isOwner,
  onEdit,
  onDelete,
  isDeleting,
  onDormClick,
}: {
  setup: StudentSetup;
  onOpen: () => void;
  likedSetupIds: Set<number>;
  onLike: (id: number) => void;
  isOwner: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  isDeleting?: boolean;
  onDormClick?: (dormName: string) => void;
}) {
  const liked = likedSetupIds.has(setup.id);

  return (
    <div className="group relative cursor-pointer overflow-hidden rounded-xl bg-card transition-shadow sm:border sm:border-border sm:shadow-raised sm:hover:shadow-overlay">
      {/* The whole card opens the setup through this one full-size button. The
          card itself used to be role="button" WRAPPING the save/edit/delete/dorm
          buttons (axe nested-interactive, a hard fail in the weekly crawl);
          those controls now sit above it (z-10) as siblings, not descendants. */}
      <Button
        type="button"
        variant="ghost"
        onClick={onOpen}
        aria-label={`Open room by ${setup.author_name}`}
        className="absolute inset-0 z-[1] h-auto w-auto rounded-xl p-0 hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600"
      />
      <div className="relative aspect-[4/3] overflow-hidden">
        <img
          src={safeImageSrc(setup.image_url) || '/placeholder.svg'}
          alt={`Room by ${setup.author_name}`}
          className="w-full h-full object-cover"
        />
        <div className="pointer-events-none hidden sm:block absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="absolute bottom-0 left-0 right-0 p-3">
            {setup.caption ? (
              <p className="text-white text-sm font-medium line-clamp-3">{setup.caption}</p>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void onLike(setup.id);
          }}
          className="absolute top-2 right-2 z-10 flex h-10 items-center gap-1 rounded-full bg-card/90 px-2.5 shadow-raised transition-colors"
          aria-label={`${liked ? 'Remove from your inspiration board' : 'Save to your inspiration board'} (${setup.likes})`}
          title={liked ? 'Saved to your inspiration board' : 'Save to your inspiration board'}
        >
          <Heart
            className={cn(
              'h-4 w-4 shrink-0',
              liked
                ? 'fill-red-500 text-red-500'
                : 'fill-none stroke-muted-foreground stroke-[1.5] text-muted-foreground hover:text-red-500',
            )}
            strokeWidth={liked ? 0 : 1.5}
          />
          <span className="text-xs font-semibold tabular-nums text-muted-foreground">{setup.likes}</span>
        </button>
        {isOwner && (onEdit || onDelete) ? (
          <div className="hidden sm:flex absolute top-2 right-[4.5rem] z-10 gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {onEdit ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-card/90 shadow-raised text-muted-foreground transition-colors hover:text-malachite-600"
                aria-label="Edit setup"
              >
                <Pencil className="h-4 w-4" />
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                disabled={isDeleting}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full bg-card/90 shadow-raised text-muted-foreground transition-colors hover:text-red-500',
                  isDeleting && 'cursor-not-allowed opacity-50',
                )}
                aria-label="Delete setup"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-2 pt-6 sm:hidden">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-white">{setup.author_name}</p>
            {setup.dorm_name ? (
              <p className="truncate text-[10px] text-white/80">{setup.dorm_name}</p>
            ) : null}
          </div>
        </div>
      </div>
      <div className="hidden px-3 py-2 sm:block">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{setup.author_name}</p>
          {setup.dorm_name ? (
            onDormClick ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDormClick(setup.dorm_name);
                }}
                className="relative z-10 text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5 mt-0.5 inline-block max-w-full whitespace-normal break-words leading-4 text-left hover:bg-malachite-50 hover:text-malachite-800 transition-colors"
                aria-label={`View ${setup.dorm_name} dorm page`}
              >
                {setup.dorm_name}
              </button>
            ) : (
              <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5 mt-0.5 inline-block max-w-full whitespace-normal break-words leading-4">
                {setup.dorm_name}
              </span>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function RoomGalleryPage() {
  const { user } = useAuth();
  const { university } = useUniversity();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const { building: currentBuilding } = useCurrentUserBuilding();

  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const sortTouchedRef = useRef(false);
  const [search, setSearch] = useState<string>('');
  const [galleryFiltersOpen, setGalleryFiltersOpen] = useState(false);
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
  const [showLikedOnly, setShowLikedOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedSetupId, setSelectedSetupId] = useState<number | null>(null);
  const [deletingSetupId, setDeletingSetupId] = useState<number | null>(null);

  const fetchSetups = useCallback(async () => {
    setIsLoading(true);
    try {
      if (!user) {
        const preview = await fetchSetupsPreview(university.id);
        const list = mapSetupPreviewPhotos(preview.photo_urls);
        setSetups(list.filter(isVisibleRoomPhoto));
        setLikedSetupIds(new Set());
        return;
      }

      const { data, error } = await supabase
        .from('student_setups')
        .select('*, setup_likes(user_id)')
        .eq('university_id', university.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const list = (data || [])
        .map((row) => mapRowToSetup(row as Record<string, unknown>))
        .filter(isVisibleRoomPhoto)
        // App Store 1.2: a blocked user's setups disappear from the gallery.
        .filter((s) => !s.user_id || !blockedUserIdsRef.current.has(s.user_id));
      setSetups(list);

      // Top Voted is only a meaningful default once real vote volume exists.
      if (!sortTouchedRef.current) {
        const totalLikes = list.reduce((sum, s) => sum + s.likes, 0);
        setSortMode(totalLikes >= VOTE_SORT_THRESHOLD ? 'votes' : 'recent');
      }

      if (user?.id) {
        const likedIds = new Set<number>();
        list.forEach((s) => {
          if (s.setup_likes?.some((like) => like.user_id === user.id)) {
            likedIds.add(s.id);
          }
        });
        setLikedSetupIds(likedIds);
      } else {
        setLikedSetupIds(new Set());
      }
    } catch (e) {
      console.error('Error fetching student setups:', e);
      toast.error('Failed to load setups');
      setSetups([]);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void fetchSetups();
  }, [fetchSetups]);

  /** Reserve scrollbar width so Radix scroll-lock padding does not shift layout sideways. */
  useEffect(() => {
    const html = document.documentElement;
    const previousGutter = html.style.scrollbarGutter;
    html.style.scrollbarGutter = 'stable';

    const stripScrollLockPadding = () => {
      if (!document.body.hasAttribute('data-scroll-locked')) return;
      document.body.style.paddingRight = '0px';
      document.body.style.marginRight = '0px';
    };

    stripScrollLockPadding();
    const observer = new MutationObserver(stripScrollLockPadding);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-scroll-locked', 'style'],
    });

    return () => {
      observer.disconnect();
      html.style.scrollbarGutter = previousGutter;
    };
  }, []);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, sortMode, showLikedOnly]);

  useEffect(() => {
    if (likedSetupIds.size === 0) setShowLikedOnly(false);
  }, [likedSetupIds.size]);

  const sortedSetups = useMemo(() => {
    return [...setups].sort((a, b) => {
      if (sortMode === 'votes') return b.likes - a.likes;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [setups, sortMode]);

  const filteredSetups = useMemo(() => {
    let list = sortedSetups;
    const q = search.trim().toLowerCase();
    if (user && q) {
      list = list.filter((s) => s.dorm_name.toLowerCase().includes(q));
    }
    if (showLikedOnly) {
      list = list.filter((s) => likedSetupIds.has(s.id));
    }
    return list;
  }, [sortedSetups, search, showLikedOnly, likedSetupIds, user]);

  const visibleSetups = filteredSetups.slice(0, user ? visibleCount : filteredSetups.length);
  const hasMore = Boolean(user) && visibleCount < filteredSetups.length;

  const handleLoadMore = () => {
    setVisibleCount((prev) => prev + PAGE_SIZE);
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
      toast('Please sign in to manage your setups');
      navigate('/auth');
      return;
    }

    const setup = setups.find((s) => s.id === setupId);
    if (!setup) return;

    if (setup.user_id && setup.user_id !== user.id) {
      toast.error('You can only delete your own setups');
      return;
    }

    if (!window.confirm('Are you sure you want to delete this setup?')) return;

    setDeletingSetupId(setupId);

    try {
      const imageUrls = new Set<string>();
      if (setup.image_url) imageUrls.add(setup.image_url);

      const { data: photoData, error: photosError } = await supabase
        .from('setup_photos')
        .select('image_url')
        .eq('setup_id', setupId);

      if (photosError) {
        console.error('Failed to load setup photos for deletion:', photosError);
      } else {
        (photoData || []).forEach((photo: { image_url: string }) => {
          if (photo.image_url) imageUrls.add(photo.image_url);
        });
      }

      const { error: deleteError } = await supabase.from('student_setups').delete().eq('id', setupId);

      if (deleteError) {
        console.error('Delete setup error:', deleteError);
        toast.error('Unable to delete setup. Please try again.');
        return;
      }

      setSetups((prev) => prev.filter((s) => s.id !== setupId));
      if (selectedSetupId === setupId) setSelectedSetupId(null);

      try {
        await queryClient.invalidateQueries({ queryKey: ['student_setups'] });
      } catch (invalidateError) {
        console.error('Failed to invalidate student_setups query:', invalidateError);
      }

      const paths = Array.from(imageUrls)
        .map((url) => getStoragePathFromPublicUrl(url))
        .filter((p): p is string => Boolean(p));

      if (paths.length > 0) {
        const { error: storageError } = await supabase.storage.from('setup-photos').remove(paths);
        if (storageError) console.error('Failed to delete setup images from storage:', storageError);
      }

      toast.success('Setup deleted');
    } catch (err) {
      console.error('Unexpected error deleting setup:', err);
      toast.error('Something went wrong while deleting this setup.');
    } finally {
      setDeletingSetupId(null);
    }
  };

  const handleLike = async (setupId: number) => {
    if (!user) {
      toast('Please sign in to like');
      navigate('/auth');
      return;
    }
    const currentlyLiked = likedSetupIds.has(setupId);

    setLikedSetupIds((prev) => {
      const next = new Set(prev);
      if (currentlyLiked) next.delete(setupId);
      else next.add(setupId);
      return next;
    });

    setSetups((prev) =>
      prev.map((s) => {
        if (s.id !== setupId) return s;
        const currentLikes = s.setup_likes || [];
        const updatedLikes = currentlyLiked
          ? currentLikes.filter((like) => like.user_id !== user.id)
          : [...currentLikes, { user_id: user.id }];
        return { ...s, setup_likes: updatedLikes, likes: updatedLikes.length };
      }),
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
    } catch (err) {
      setLikedSetupIds((prev) => {
        const next = new Set(prev);
        if (currentlyLiked) next.add(setupId);
        else next.delete(setupId);
        return next;
      });
      setSetups((prev) =>
        prev.map((s) => {
          if (s.id !== setupId) return s;
          const currentLikes = s.setup_likes || [];
          const updatedLikes = currentlyLiked
            ? [...currentLikes, { user_id: user.id }]
            : currentLikes.filter((like) => like.user_id !== user.id);
          return { ...s, setup_likes: updatedLikes, likes: updatedLikes.length };
        }),
      );
      console.error('Like failed:', err);
      toast.error('Could not update like');
    }
  };

  /** Post CTA: land on the user's own hall's dorm page with the setups tab open
   *  (the upload flow lives there); fall back to housing explore when we don't
   *  know their hall. */
  const handlePostSetup = useCallback(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    if (currentBuilding?.residenceHallName) {
      const slug = dormSlugFromName(currentBuilding.residenceHallName);
      navigate(`/campus/${slug}?tab=setups&share=1`);
      return;
    }
    navigate('/housing?tab=on-campus');
  }, [user, currentBuilding, navigate]);

  // Bottom-nav + FAB deep-link: `/gallery?post=1` opens the post-setup flow,
  // then strips the param so back/refresh don't re-trigger it.
  const [postSearchParams, setPostSearchParams] = useSearchParams();
  useEffect(() => {
    if (postSearchParams.get('post') !== '1') return;
    const next = new URLSearchParams(postSearchParams);
    next.delete('post');
    setPostSearchParams(next, { replace: true });
    handlePostSetup();
  }, [postSearchParams, setPostSearchParams, handlePostSetup]);

  const openDormPage = useCallback(
    (dormName: string) => {
      const slug = dormSlugFromName(dormName);
      if (slug) navigate(`/campus/${slug}`);
    },
    [navigate],
  );

  const openEditForSetup = useCallback(
    (setup: StudentSetup) => {
      const slug = dormSlugFromName(setup.dorm_name);
      setSelectedSetupId(null);
      navigate(`/campus/${slug}`);
    },
    [navigate],
  );

  const selectedSetup =
    selectedSetupId != null && !isSetupPreviewTeaserId(selectedSetupId)
      ? setups.find((s) => s.id === selectedSetupId) ?? null
      : null;

  const selectSort = useCallback((mode: SortMode) => {
    sortTouchedRef.current = true;
    setSortMode(mode);
  }, []);

  const clearGalleryFilters = useCallback(() => {
    selectSort('recent');
  }, [selectSort]);

  const galleryFiltersFields = (
    <div>
      <h3 className="text-sm font-semibold text-foreground mb-3">Sort by</h3>
      <ToggleGroup
        type="single"
        value={sortMode}
        onValueChange={(v) => {
          // Sort is always one active mode — ignore a deselect back to empty.
          if (v) selectSort(v as SortMode);
        }}
        className="grid grid-cols-2 gap-2"
      >
        {([
          { mode: 'votes' as const, label: 'Top Voted', icon: Flame },
          { mode: 'recent' as const, label: 'Recent', icon: Sparkles },
        ]).map(({ mode, label, icon: Icon }) => (
          <ToggleGroupItem
            key={mode}
            value={mode}
            className={cn(
              'h-10 min-w-0 gap-1.5 rounded-lg border text-sm font-medium transition-colors',
              'border-border bg-card text-muted-foreground hover:text-foreground',
              'data-[state=on]:border-malachite-600 data-[state=on]:bg-malachite-50 data-[state=on]:text-malachite-800',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );

  const filtersButtonClass =
    'shrink-0 h-11 gap-2 rounded-full border border-malachite-600 bg-card px-4 text-sm font-medium text-malachite-800 shadow-none hover:bg-malachite-50 dark:hover:bg-muted hover:text-malachite-800 [&_svg]:text-malachite-800 dark:text-malachite-300 dark:[&_svg]:text-malachite-300 dark:hover:text-malachite-300';

  const filtersButtonInner = (
    <>
      <SlidersHorizontal className="w-4 h-4 shrink-0" />
      Filters
    </>
  );

  // Mobile: the trigger lives inside the search bar (PageToolbar renders the
  // inline sliders icon); this node only mounts the controlled bottom drawer.
  // Desktop: popover anchored to the Filters pill.
  const filtersControl = isMobile ? (
      <AdaptiveOverlay
        open={galleryFiltersOpen}
        onOpenChange={setGalleryFiltersOpen}
        shouldScaleBackground={false}
        mobileVariant="drawer"
      >
        <AdaptiveOverlayContent
          priority
          hideDefaultHandle
          className="h-auto max-h-[85vh] w-full rounded-t-2xl pb-0"
        >
          <div className="mx-auto mt-4 h-2 w-[100px] shrink-0 rounded-full bg-muted" />
          <div className="shrink-0 p-4 pb-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-lg font-semibold">Filters</span>
              <button
                type="button"
                onClick={clearGalleryFilters}
                className="cursor-pointer text-sm text-malachite-800 hover:underline"
              >
                Clear all
              </button>
            </div>
          </div>
          <div className="overflow-y-auto overscroll-contain p-4 pt-0 max-h-[min(56vh,calc(85vh-10rem))]">
            {galleryFiltersFields}
          </div>
          <div className="shrink-0 border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button
              type="button"
              className="w-full bg-malachite-800 hover:bg-malachite-900 text-white"
              onClick={() => setGalleryFiltersOpen(false)}
            >
              Show results
            </Button>
          </div>
        </AdaptiveOverlayContent>
      </AdaptiveOverlay>
  ) : (
    <Popover open={galleryFiltersOpen} onOpenChange={setGalleryFiltersOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className={filtersButtonClass}>
          {filtersButtonInner}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="flex max-h-[min(70vh,560px)] w-[min(92vw,360px)] flex-col gap-0 p-0"
      >
        <div className="shrink-0 border-b border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-base font-semibold">Filters</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={clearGalleryFilters}
                className="cursor-pointer text-sm text-malachite-800 hover:underline"
              >
                Clear all
              </button>
              <button
                type="button"
                onClick={() => setGalleryFiltersOpen(false)}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                aria-label="Close filters"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 scrollbar-thin">
          {galleryFiltersFields}
        </div>
        <div className="shrink-0 border-t border-border p-4">
          <Button
            type="button"
            className="w-full bg-malachite-800 hover:bg-malachite-900 text-white"
            onClick={() => setGalleryFiltersOpen(false)}
          >
            Show results
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );

  // Reasoned exception to the PageContainer roles (contract:
  // src/components/ui/page-container.tsx). A photo gallery is deliberately
  // full-bleed on phones — max-w-none so the setups run edge to edge — and only
  // takes a measure at sm and up. No role expresses "none, then wide".
  return (
    <div className="mx-auto w-full max-w-none space-y-3 overflow-x-hidden px-2 pb-4 pt-3 sm:max-w-7xl sm:space-y-6 sm:px-4 sm:pb-6 sm:pt-3">
      <AppPageHeader
        title="Student Setups"
        bookmark
        actions={
          user ? (
            <Button
              type="button"
              onClick={handlePostSetup}
              className="hidden h-11 shrink-0 gap-2 rounded-full bg-malachite-800 px-4 font-semibold text-white hover:bg-malachite-900 md:inline-flex"
            >
              <Camera className="h-4 w-4 shrink-0" />
              <span>Post your setup</span>
            </Button>
          ) : null
        }
      >
        <PageToolbar
          className="mt-3"
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search by building"
          searchAriaLabel="Search setups by building"
          onFilterClick={() => setGalleryFiltersOpen((prev) => !prev)}
          filterActive={sortMode !== 'recent'}
          filterAriaLabel="Filters"
          filter={filtersControl}
          onPostClick={user ? handlePostSetup : undefined}
          postAriaLabel="Post your setup"
          trailing={
            user && likedSetupIds.size > 0 ? (
              <Button
                type="button"
                variant="outline"
                aria-pressed={showLikedOnly}
                className={cn(
                  'h-11 shrink-0 gap-1.5 rounded-full border px-3 text-xs font-medium shadow-none',
                  showLikedOnly
                    ? 'border-malachite-600 bg-malachite-50 text-malachite-800 hover:bg-malachite-50 hover:text-malachite-800'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setShowLikedOnly((prev) => !prev)}
              >
                <Heart className={cn('h-3.5 w-3.5 shrink-0', showLikedOnly && 'fill-red-500 text-red-500')} />
                Saved
              </Button>
            ) : null
          }
        />
      </AppPageHeader>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="overflow-hidden rounded-xl sm:border sm:border-border sm:bg-card sm:shadow-raised"
            >
              <div className="aspect-[4/3] animate-pulse bg-muted" />
              <div className="px-3 py-2 space-y-2">
                <div className="h-3.5 w-2/3 animate-pulse bg-muted rounded" />
                <div className="h-3 w-1/2 animate-pulse bg-muted rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ) : setups.length === 0 ? (
        <div className="text-center py-12 space-y-3">
          <p className="font-medium text-foreground">
            {currentBuilding?.residenceHallName
              ? `Be one of the first to post your ${currentBuilding.residenceHallName} setup`
              : 'Be one of the first to post your room setup'}
          </p>
          <p className="text-sm text-muted-foreground">
            Real rooms help other students picture living here.
          </p>
          <Button
            type="button"
            onClick={handlePostSetup}
            className="gap-2 bg-malachite-800 text-white hover:bg-malachite-900"
          >
            <Camera className="h-4 w-4 shrink-0" />
            Post your setup
          </Button>
        </div>
      ) : filteredSetups.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <p className="font-medium text-foreground">No setups match your search</p>
          <p className="text-sm text-muted-foreground">Try a different building or clear your filters.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => {
              setSearch('');
              setShowLikedOnly(false);
              clearGalleryFilters();
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <>
          <SneakPeekBlurWall
            isAuthenticated={!!user}
            className="w-full"
            title="Get Inspired by Real Setups"
            description="Sign in to explore dorm photos, see item details, and save your favorites."
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
              {visibleSetups.map((setup) => (
                <GallerySetupCard
                  key={setup.id}
                  setup={setup}
                  onOpen={() => {
                    if (!user) {
                      navigate('/auth');
                      return;
                    }
                    setSelectedSetupId(setup.id);
                  }}
                  likedSetupIds={likedSetupIds}
                  onLike={handleLike}
                  isOwner={Boolean(user && setup.user_id && setup.user_id === user.id)}
                  onEdit={
                    user && setup.user_id === user.id ? () => openEditForSetup(setup) : undefined
                  }
                  onDelete={
                    user && setup.user_id === user.id
                      ? () => void handleDeleteSetup(setup.id)
                      : undefined
                  }
                  isDeleting={deletingSetupId === setup.id}
                  onDormClick={user ? openDormPage : undefined}
                />
              ))}
            </div>
          </SneakPeekBlurWall>

          {hasMore ? (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={handleLoadMore} className="gap-2">
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}

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
          onEdit={
            user && selectedSetup.user_id === user.id
              ? () => openEditForSetup(selectedSetup)
              : undefined
          }
        />
      )}
    </div>
  );
}
