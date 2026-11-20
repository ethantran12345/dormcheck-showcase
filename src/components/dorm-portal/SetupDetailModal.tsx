import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Heart, LogIn, ExternalLink, Trash2, Tag, Pencil, Plus, Check, X, MessageCircle, Flag, Instagram, Share2 } from 'lucide-react';
import { TikTokIcon } from '@/components/icons/TikTokIcon';
import { ReportContentDialog } from '@/components/ReportContentDialog';
import { ImageGalleryCarousel } from '@/components/ImageGalleryCarousel';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import type { SetupTag } from '@/types';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useBlockedUserIds } from '@/hooks/useBlockedUsers';
import type { TablesInsert } from '@/integrations/supabase/types';
import { sanitizeText, safeHrefWithHttpsFallback, safeImageSrc } from '@/lib/sanitize';
import { formatDistanceToNow, format } from 'date-fns';
import { useAuth } from '@/hooks/useAuth';
import { useChecklist } from '@/hooks/useChecklist';
import { toast } from 'sonner';
import { checklistExploreNameKey } from '@/lib/checklistExploreNameKey';
import { useModalOverlay } from '@/contexts/ModalOverlayContext';
import { useNavigate } from 'react-router';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { ProductTagMarker } from '@/components/dorm-portal/ProductTagMarker';
import { parseTourUrl } from '@/lib/socialTour';
import { shareLink } from '@/lib/shareLink';
import { categorizeProductName } from '@/lib/checklistSection';

// Instagram's tallest feed ratio (portrait 4:5). One constant so the media frame
// is trivial to retune live; drives the aspect-locked, cover-filled photo/video frame.
const SETUP_MEDIA_ASPECT = 4 / 5;

interface SetupDetailModalProps {
  setup: {
    id: number;
    image_url: string;
    author_name: string;
    caption: string | null;
    dorm_name?: string | null;
    likes: number;
    created_at?: string;
    user_id?: string;
    tags?: SetupTag[] | null;
    tiktok_url?: string | null;
    report_uuid?: string | null;
  };
  isOpen: boolean;
  onClose: () => void;
  onLike?: (setupId: number) => void;
  isLiked?: boolean;
  canDelete?: boolean;
  onDelete?: () => void;
  isDeleting?: boolean;
  onEdit?: () => void;
}

interface SetupPhoto {
  id: number;
  image_url: string;
}

interface SetupComment {
  id: number;
  author_name: string;
  content: string;
  created_at: string;
  user_id: string | null;
  parent_id?: number | null;
}

interface SetupProduct {
  id: number;
  product_name: string;
  product_url: string;
}

export function SetupDetailModal({
  setup,
  isOpen,
  onClose,
  onLike,
  isLiked = false,
  canDelete = false,
  onDelete,
  isDeleting = false,
  onEdit,
}: SetupDetailModalProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { addItem, items: personalChecklistItems } = useChecklist();
  const navigate = useNavigate();
  const modalOverlay = useModalOverlay();
  const queryClient = useQueryClient();

  const [photos, setPhotos] = useState<SetupPhoto[]>([]);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [comments, setComments] = useState<SetupComment[]>([]);
  // App Store 1.2: blocks apply instantly. The ref keeps the imperative
  // fetchComments closure current; the effect prunes a thread already on
  // screen the moment the viewer blocks its author.
  const { blockedUserIds } = useBlockedUserIds();
  const blockedUserIdsRef = useRef(blockedUserIds);
  blockedUserIdsRef.current = blockedUserIds;
  useEffect(() => {
    if (blockedUserIds.size === 0) return;
    setComments((prev) =>
      prev.some((c) => c.user_id && blockedUserIds.has(c.user_id))
        ? prev.filter((c) => !c.user_id || !blockedUserIds.has(c.user_id))
        : prev,
    );
  }, [blockedUserIds]);
  type CommentLikeInfo = { like_count: number; liked_by_me: boolean; liked_by_author: boolean };
  const [commentLikes, setCommentLikes] = useState<Record<number, CommentLikeInfo>>({});
  const [, setProducts] = useState<SetupProduct[]>([]);

  const [newComment, setNewComment] = useState('');
  const [replyingToId, setReplyingToId] = useState<number | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [isLoadingPhotos, setIsLoadingPhotos] = useState(true);
  const [isLoadingComments, setIsLoadingComments] = useState(true);
  const [, setIsLoadingProducts] = useState(true);
  const [showProductTags, setShowProductTags] = useState(false);
  const [hoveredTagIndex, setHoveredTagIndex] = useState<number | null>(null);
  const [addingChecklistNameKey, setAddingChecklistNameKey] = useState<string | null>(null);
  const [tagsVisible, setTagsVisible] = useState(false);
  // Comments start collapsed, like an Instagram post: the thread is one tap
  // away behind "View all N comments" instead of pushing the photo off-screen.
  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const [showHeartBurst, setShowHeartBurst] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevCommentCountRef = useRef(0);
  const singleTapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapTimeRef = useRef(0);
  const isMobile = useIsMobile();

  const personalChecklistNameKeys = useMemo(() => {
    const next = new Set<string>();
    for (const row of personalChecklistItems) {
      const k = checklistExploreNameKey(row.item);
      if (k) next.add(k);
    }
    return next;
  }, [personalChecklistItems]);

  const handleAddTaggedProductToChecklist = useCallback(
    async (tag: SetupTag) => {
      if (!user) return;
      const nameKey = checklistExploreNameKey(tag.product_name);
      if (!nameKey) return;
      if (personalChecklistNameKeys.has(nameKey)) {
        toast(t('housing:portal.setups.detail.alreadyInChecklistMsg'));
        return;
      }
      setAddingChecklistNameKey(nameKey);
      try {
        const linkRaw = safeHrefWithHttpsFallback(tag.product_link);
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console -- guarded by import.meta.env.DEV above.
          console.debug('[SetupDetailModal] add to checklist from tag', {
            product_name: tag.product_name,
            product_link: tag.product_link,
            link_passed_to_addItem: linkRaw,
          });
        }
        const ok = await addItem(
          categorizeProductName(tag.product_name),
          tag.product_name,
          linkRaw ?? undefined,
          null,
          false,
          { needs_purchase: true },
        );
        if (!ok) return;
      } finally {
        setAddingChecklistNameKey(null);
      }
    },
    [user, personalChecklistNameKeys, addItem, t],
  );

  const { data: authorProfile } = useQuery({
    queryKey: ['profiles', 'avatar', setup.user_id],
    queryFn: async () => {
      if (!setup.user_id) return null;
      const { data, error } = await supabase
        .from('public_profiles')
        .select('avatar_url')
        .eq('id', setup.user_id)
        .maybeSingle();
      if (error || !data) return null;
      return data as { avatar_url: string | null };
    },
    enabled: isOpen && !!setup.user_id,
  });

  const avatarUrl = authorProfile?.avatar_url ?? null;

  const fetchPhotos = async () => {
    setIsLoadingPhotos(true);
    const { data, error } = await supabase
      .from('setup_photos')
      .select('id, image_url')
      .eq('setup_id', setup.id)
      .order('created_at', { ascending: true });

    if (error || !data || data.length === 0) {
      setPhotos([{ id: 0, image_url: setup.image_url }]);
    } else {
      setPhotos(data);
    }
    setIsLoadingPhotos(false);
  };

  const fetchComments = async () => {
    const { data, error } = await supabase
      .from('setup_comments')
      .select('id, author_name, content, created_at, user_id, parent_id')
      .eq('setup_id', setup.id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching comments:', error);
      setIsLoadingComments(false);
      return;
    }
    // App Store 1.2: a blocked user's comments disappear from the thread.
    setComments(
      ((data as SetupComment[]) || []).filter(
        (c) => !c.user_id || !blockedUserIdsRef.current.has(c.user_id),
      ),
    );
    setIsLoadingComments(false);
    void fetchCommentLikes();
    // t() call to register translation keys for comment-related strings
    void t('housing:portal.setups.detail.comments');
  };

  const fetchCommentLikes = async () => {
    const { data, error } = await supabase.rpc('get_setup_comment_likes', {
      p_setup_id: setup.id,
      p_author_id: setup.user_id ?? null,
    });
    if (error) {
      console.error('Error fetching comment likes:', error);
      return;
    }
    const map: Record<number, CommentLikeInfo> = {};
    for (const row of (data ?? []) as Array<{
      comment_id: number;
      like_count: number;
      liked_by_me: boolean;
      liked_by_author: boolean;
    }>) {
      map[row.comment_id] = {
        like_count: Number(row.like_count) || 0,
        liked_by_me: !!row.liked_by_me,
        liked_by_author: !!row.liked_by_author,
      };
    }
    setCommentLikes(map);
  };

  const fetchProducts = async () => {
    setIsLoadingProducts(true);
    const { data, error } = await supabase
      .from('setup_products')
      .select('id, product_name, product_url')
      .eq('setup_id', setup.id);

    if (error) {
      console.error('Error fetching products:', error);
    } else {
      setProducts(data || []);
    }
    setIsLoadingProducts(false);
  };

  useEffect(() => {
    if (isOpen && setup.id) {
      setCurrentPhotoIndex(0);
      prevCommentCountRef.current = 0;
      setShowProductTags(false);
      setTagsVisible(false);
      setHoveredTagIndex(null);
      setNewComment('');
      setReplyingToId(null);
      setIsLoadingComments(true);
      setIsLoadingProducts(true);
      setIsLoadingPhotos(true);
      Promise.all([fetchPhotos(), fetchComments(), fetchProducts()]);
    }
  }, [isOpen, setup.id]);

  useEffect(() => {
    setHoveredTagIndex(null);
  }, [currentPhotoIndex]);

  // Auto-scroll to the newest comment only when one is ADDED after the initial
  // load. On the inline mobile layout the scroll container is the whole page, so
  // scrolling on first populate would jump past the photo straight to comments.
  useEffect(() => {
    const prev = prevCommentCountRef.current;
    prevCommentCountRef.current = comments.length;
    if (comments.length > prev && prev > 0 && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [comments.length]);

  const handleSendComment = async () => {
    if (!user) return;
    const sanitizedContent = sanitizeText(newComment);
    if (!sanitizedContent || isSending) return;

    const authorName = user.user_metadata?.full_name ?? user.email ?? 'User';
    const commentPayload: TablesInsert<'setup_comments'> = {
      setup_id: setup.id,
      user_id: user.id,
      author_name: authorName,
      content: sanitizedContent,
    };
    if (replyingToId != null) {
      commentPayload.parent_id = Number(replyingToId);
    }

    const tempId = Date.now();
    const optimisticComment: SetupComment = {
      id: tempId,
      author_name: authorName,
      content: sanitizedContent,
      created_at: new Date().toISOString(),
      user_id: user.id,
      parent_id: replyingToId ?? undefined,
    };
    setComments((prev) => [...prev, optimisticComment]);
    setNewComment('');
    setReplyingToId(null);
    setIsSending(true);

    const { data, error } = await supabase
      .from('setup_comments')
      .insert(commentPayload)
      .select()
      .single();

    if (error) {
      console.error('Failed to send comment:', error);
      setComments((prev) => prev.filter((c) => c.id !== tempId));
      setIsSending(false);
      return;
    }

    if (data) {
      await fetchComments();
    }
    setIsSending(false);
  };

  const handleDeleteComment = async (comment: SetupComment) => {
    if (!user || comment.user_id !== user.id) return;
    setDeletingId(comment.id);
    const { error } = await supabase
      .from('setup_comments')
      .delete()
      .eq('id', comment.id);

    if (error) {
      console.error('Failed to delete comment:', error);
      setDeletingId(null);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ['setup_comments', setup.id] });
    await fetchComments();
    setDeletingId(null);
  };

  const toggleCommentLike = async (commentId: number) => {
    if (!user) {
      navigate('/auth');
      return;
    }
    const cur = commentLikes[commentId] ?? { like_count: 0, liked_by_me: false, liked_by_author: false };
    const willLike = !cur.liked_by_me;
    const isAuthorMe = Boolean(setup.user_id && user.id === setup.user_id);
    setCommentLikes((prev) => ({
      ...prev,
      [commentId]: {
        like_count: Math.max(0, cur.like_count + (willLike ? 1 : -1)),
        liked_by_me: willLike,
        liked_by_author: isAuthorMe ? willLike : cur.liked_by_author,
      },
    }));
    try {
      if (willLike) {
        const { error } = await supabase
          .from('setup_comment_likes')
          .insert({ comment_id: commentId, user_id: user.id });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('setup_comment_likes')
          .delete()
          .eq('comment_id', commentId)
          .eq('user_id', user.id);
        if (error) throw error;
      }
    } catch (e) {
      setCommentLikes((prev) => ({ ...prev, [commentId]: cur }));
      console.error('toggle comment like failed', e);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendComment();
    }
  };

  const showDelete = canDelete || (user && setup.user_id === user.id);
  const canReport = Boolean(user && setup.user_id !== user.id && setup.id > 0);
  const [reportOpen, setReportOpen] = useState(false);
  // Tags can arrive from older/partial rows without a product_name even though
  // the type says otherwise; a nameless tag is unusable (no shelf entry, no
  // checklist add, no label) and crashes the .trim()/.toLowerCase() paths below.
  // Drop them once here so every downstream consumer is safe.
  const tags = ((setup as { tags?: SetupTag[] | null }).tags ?? []).filter(
    (t): t is SetupTag => Boolean(t?.product_name?.trim()),
  );

  const photoUrls = useMemo(
    () =>
      photos.map(
        (p) => safeImageSrc(p.image_url || setup.image_url) || '/placeholder.svg',
      ),
    [photos, setup.image_url],
  );

  const tagsForPhoto = useCallback(
    (photoIndex: number) => tags.filter((t) => (t.photo_index ?? 0) === photoIndex),
    [tags],
  );

  // Per-photo focal point for the cover-filled 4:5 frame. Aligned to photoUrls.
  // TODO(setup-ux): honor stored focal points once setup_photos.focal_x/focal_y
  // exist (reposition control ships in StudentSetupsTab). Until then, center.
  const imagePositions = useMemo(
    () =>
      photos.map((p) => {
        const fx = (p as { focal_x?: number | null }).focal_x;
        const fy = (p as { focal_y?: number | null }).focal_y;
        return typeof fx === 'number' && typeof fy === 'number' ? `${fx}% ${fy}%` : '50% 50%';
      }),
    [photos],
  );

  // The "room tour" is surfaced as a plain outbound link (next to "Shop this
  // room"), not an inline embed — the embed couldn't be cropped to a clean
  // video-only frame across arbitrary aspect ratios. Two platforms are
  // supported, TikTok and Instagram Reels; the stored column is named
  // `tiktok_url` for legacy reasons and holds either. See @/lib/socialTour.
  const tour = parseTourUrl(setup.tiktok_url);
  const tourHref = tour ? safeHrefWithHttpsFallback(tour.url) : null;
  const showTourLink = Boolean(tourHref);

  useEffect(() => {
    if (!isOpen) {
      setShowHeartBurst(false);
      setTagsVisible(false);
      setCommentsExpanded(false);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (singleTapTimeoutRef.current) clearTimeout(singleTapTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    modalOverlay?.setHideBottomNav(isOpen);
    return () => { modalOverlay?.setHideBottomNav(false); };
  }, [isOpen, modalOverlay]);

  // Every product tagged across the whole setup, de-duped by name+link so the
  // shelf shows all shopping info at once (not gated to the current photo). Keep
  // the first occurrence and remember its photo for the "on photo N" hint.
  const uniqueSetupTags = (() => {
    const seen = new Set<string>();
    const out: SetupTag[] = [];
    for (const t of tags) {
      const key = `${t.product_name.trim().toLowerCase()}|${(t.product_link ?? '').trim().toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    return out;
  })();

  const productShelfBlock = uniqueSetupTags.length > 0 ? (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('housing:portal.setups.detail.shopThisRoom')}</p>
      <ul className="divide-y divide-border">
        {uniqueSetupTags.map((tag, i) => {
          const nameKey = checklistExploreNameKey(tag.product_name);
          const inChecklist = Boolean(nameKey && personalChecklistNameKeys.has(nameKey));
          const isAddingThis = Boolean(nameKey && addingChecklistNameKey === nameKey);
          const tagHref = safeHrefWithHttpsFallback(tag.product_link);
          const photoIndex = tag.photo_index ?? 0;
          return (
            <li
              key={i}
              className="flex items-center gap-3 py-2"
            >
              <div className="min-w-0 flex-1">
                {tagHref ? (
                  <a
                    href={tagHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80"
                  >
                    <span className="truncate">{tag.product_name}</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  </a>
                ) : (
                  <span className="block truncate text-sm font-medium text-foreground">
                    {tag.product_name}
                  </span>
                )}
                {photos.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setCurrentPhotoIndex(photoIndex)}
                    className="mt-1 inline-flex min-h-[24px] items-center text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {t('housing:portal.setups.detail.onPhotoLabel', { index: photoIndex + 1 })}
                  </button>
                ) : null}
              </div>
              {user ? (
                inChecklist ? (
                  <span
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"
                    aria-label={`${tag.product_name} is in your checklist`}
                  >
                    <Check className="h-4 w-4" strokeWidth={2.5} />
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleAddTaggedProductToChecklist(tag)}
                    disabled={isAddingThis || !nameKey}
                    className="inline-flex h-11 min-h-[44px] w-11 min-w-[44px] shrink-0 items-center justify-center rounded-full border border-border bg-card text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                    aria-label={t('housing:portal.setups.detail.addToChecklistLabel', { productName: tag.product_name })}
                  >
                    <Plus className="h-4 w-4" strokeWidth={2} />
                  </button>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  ) : null;

  const tourLinkBlock = showTourLink && tour ? (
    <a
      href={tourHref ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      className="-mx-1 flex min-h-[44px] items-center gap-3 rounded-control px-1 py-2 transition-colors hover:bg-muted"
    >
      <span className="shrink-0 text-foreground">
        {tour.platform === 'instagram' ? (
          <Instagram className="h-5 w-5" strokeWidth={2} aria-hidden />
        ) : (
          <TikTokIcon className="h-5 w-5" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {tour.platform === 'instagram'
          ? t('housing:portal.setups.detail.tourLinkInstagram')
          : t('housing:portal.setups.detail.tourLinkTikTok')}
      </span>
      <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </a>
  ) : null;

  const commentsThread = (
    <>
      {isLoadingComments ? (
        <div className="text-muted-foreground text-center py-8">{t('common:state.loading')}</div>
      ) : comments.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-sm text-foreground">{t('housing:portal.setups.detail.noCommentsMsg')}</p>
          <p className="text-xs mt-1 text-muted-foreground">{t('housing:portal.setups.detail.beFirstToComment')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {comments.map((comment) => {
            const isReply = comment.parent_id != null;
            const canDeleteComment = user && comment.user_id === user.id;
            const isAuthor = Boolean(setup.user_id && comment.user_id && setup.user_id === comment.user_id);
            const likeInfo = commentLikes[comment.id] ?? { like_count: 0, liked_by_me: false, liked_by_author: false };
            return (
              <div
                key={comment.id}
                className={cn(
                  'flex gap-3 rounded-lg p-2 -mx-2',
                  isReply && 'ml-8 bg-muted',
                )}
              >
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-foreground text-xs font-bold shrink-0">
                  {comment.author_name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-foreground">
                      {comment.author_name}
                    </span>
                    {isAuthor && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary shrink-0">
                        {t('housing:portal.setups.detail.authorLabel')}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(comment.created_at), {
                        addSuffix: true,
                      })}
                    </span>
                    <div className="flex items-center gap-1 ml-auto">
                      {user && (
                        <button
                          type="button"
                          onClick={() => setReplyingToId(comment.id)}
                          className="text-[10px] text-muted-foreground hover:text-primary transition-colors"
                        >
                          {t('housing:portal.setups.detail.replyBtn')}
                        </button>
                      )}
                      {canDeleteComment && (
                        <button
                          type="button"
                          onClick={() => handleDeleteComment(comment)}
                          disabled={deletingId === comment.id}
                          className="p-1 text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-50"
                          aria-label={t('housing:portal.setups.detail.deleteCommentLabel')}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5 break-words">{comment.content}</p>
                  {likeInfo.liked_by_author && (
                    <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-[#FF6B6B]">
                      <Heart className="h-3 w-3 fill-[#FF6B6B] text-[#FF6B6B]" strokeWidth={0} />
                      {t('housing:portal.setups.detail.likedByAuthor')}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => toggleCommentLike(comment.id)}
                  className="flex shrink-0 flex-col items-center gap-0.5 self-start pt-0.5"
                  aria-label={likeInfo.liked_by_me ? t('housing:portal.setups.detail.unlikeCommentLabel') : t('housing:portal.setups.detail.likeCommentLabel')}
                >
                  <Heart
                    className={cn(
                      'h-4 w-4',
                      likeInfo.liked_by_me ? 'fill-[#FF6B6B] text-[#FF6B6B]' : 'text-muted-foreground',
                    )}
                    strokeWidth={likeInfo.liked_by_me ? 0 : 2}
                  />
                  {likeInfo.like_count > 0 && (
                    <span className="text-[10px] tabular-nums text-muted-foreground">{likeInfo.like_count}</span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  /**
   * Instagram's collapse: the thread is hidden until asked for. With no
   * comments there is nothing to announce, so the block disappears entirely
   * rather than showing an empty-state box — the composer below is the prompt.
   */
  const commentsListBlock =
    commentsExpanded || isLoadingComments ? (
      commentsThread
    ) : comments.length > 0 ? (
      // `h-auto` clears Button's default h-10 so the 44px min-height below is
      // what actually sizes this row.
      <Button
        type="button"
        variant="ghost"
        onClick={() => setCommentsExpanded(true)}
        className="-mx-1 flex h-auto min-h-[44px] w-full items-center justify-start px-1 text-left text-sm font-normal text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground"
        aria-expanded={false}
      >
        {t('housing:portal.setups.detail.viewAllComments', { count: comments.length })}
      </Button>
    ) : null;

  const commentInputBlock = (
    <div className="p-4 bg-card">
      {user ? (
        <div className="space-y-2">
          {replyingToId != null && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                {t('housing:portal.setups.detail.replyingTo', { userName: comments.find((c) => c.id === replyingToId)?.author_name ?? 'comment' })}
              </span>
              <button
                type="button"
                onClick={() => setReplyingToId(null)}
                className="text-primary hover:text-primary/80"
              >
                {t('housing:portal.setups.detail.cancelReplyBtn')}
              </button>
            </div>
          )}
          <div className="flex items-center gap-2 bg-muted rounded-full px-4 py-2 border border-border">
            <input
              type="text"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder={
                replyingToId != null
                  ? t('housing:portal.setups.detail.replyLabel')
                  : t('housing:portal.setups.detail.commentAsLabel', { userName: user.user_metadata?.full_name ?? 'User' })
              }
              className="flex-1 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground"
            />
            <button
              onClick={handleSendComment}
              disabled={!newComment.trim() || isSending}
              className={cn(
                'flex h-11 min-h-[44px] w-11 min-w-[44px] shrink-0 items-center justify-center rounded-full',
                newComment.trim()
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => navigate('/auth')}
          className="w-full flex justify-between items-center bg-muted border border-border rounded-full px-4 py-3 text-sm text-foreground hover:bg-muted transition-colors"
        >
          {t('housing:portal.setups.detail.signInToComment')}
          <LogIn className="w-4 h-4 text-muted-foreground shrink-0" />
        </button>
      )}
    </div>
  );

  const handleLikeClick = () => {
    if (!user) navigate('/auth');
    else if (onLike) onLike(setup.id);
  };

  const triggerHeartBurst = useCallback(() => {
    setShowHeartBurst(true);
    window.setTimeout(() => setShowHeartBurst(false), 700);
  }, []);

  const handleDoubleTapLike = useCallback(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    if (!isLiked && onLike) onLike(setup.id);
    triggerHeartBurst();
  }, [user, isLiked, onLike, setup.id, navigate, triggerHeartBurst]);

  const handleMobilePhotoTap = useCallback(() => {
    const now = Date.now();
    const timeSinceLast = now - lastTapTimeRef.current;

    if (timeSinceLast > 0 && timeSinceLast < 300) {
      if (singleTapTimeoutRef.current) {
        clearTimeout(singleTapTimeoutRef.current);
        singleTapTimeoutRef.current = null;
      }
      lastTapTimeRef.current = 0;
      handleDoubleTapLike();
      return;
    }

    lastTapTimeRef.current = now;
    if (singleTapTimeoutRef.current) clearTimeout(singleTapTimeoutRef.current);
    singleTapTimeoutRef.current = setTimeout(() => {
      singleTapTimeoutRef.current = null;
      setTagsVisible((visible) => !visible);
    }, 300);
  }, [handleDoubleTapLike]);

  const handleMobileTagClick = useCallback(
    (e: React.MouseEvent, tag: SetupTag) => {
      e.stopPropagation();
      const tagHref = safeHrefWithHttpsFallback(tag.product_link);
      if (tagHref) window.open(tagHref, '_blank', 'noopener,noreferrer');
    },
    [],
  );

  const renderMobileTagsOverlay = (slideIndex: number) => {
    if (!tagsVisible) return null;
    return tagsForPhoto(slideIndex).map((tag, i) => (
      <ProductTagMarker
        key={`${tag.product_name}-${i}`}
        xPct={tag.x * 100}
        yPct={tag.y * 100}
        label={tag.product_name}
        onClick={(e) => handleMobileTagClick(e, tag)}
      />
    ));
  };

  const renderDesktopTagsOverlay = (slideIndex: number) => {
    const photoTags = tagsForPhoto(slideIndex);
    if (!showProductTags || photoTags.length === 0) return null;
    return (
      <div className="absolute inset-0 pointer-events-none">
        {photoTags.map((tag, i) => (
          <div
            key={i}
            className="absolute w-0 h-0 pointer-events-auto"
            style={{ left: `${tag.x * 100}%`, top: `${tag.y * 100}%` }}
            onMouseEnter={() => setHoveredTagIndex(i)}
            onMouseLeave={() => setHoveredTagIndex(null)}
          >
            <motion.div
              className="absolute left-1/2 top-1/2 w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-card border border-border shadow-raised"
              aria-hidden
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
            />
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{
                scale: 1,
                opacity: 1,
                y: hoveredTagIndex === i ? -6 : 0,
              }}
              transition={{
                scale: { type: 'spring', stiffness: 400, damping: 25 },
                y: { type: 'spring', stiffness: 400, damping: 30 },
              }}
              style={{ transformOrigin: '50% 100%' }}
              className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[200px] rounded-lg bg-card/95 backdrop-blur-md border border-border shadow-overlay p-3"
            >
              <p className="font-semibold text-sm text-foreground truncate">
                {tag.product_name}
              </p>
              {(() => {
                const tagHref = safeHrefWithHttpsFallback(tag.product_link);
                return tagHref ? (
                  <a
                    href={tagHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium"
                  >
                    {t('housing:portal.setups.detail.viewItem')}
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                ) : (
                  <span className="mt-2 text-xs text-muted-foreground">{tag.product_name}</span>
                );
              })()}
            </motion.div>
          </div>
        ))}
      </div>
    );
  };

  /**
   * Share a link that reopens THIS setup. The dorm page reads `?setup=<id>` on
   * mount and opens the detail view, so the link works for anyone who can see
   * the dorm — no separate public route to keep in sync.
   */
  const handleShare = useCallback(async () => {
    let url: string;
    try {
      const parsed = new URL(window.location.href);
      parsed.searchParams.set('setup', String(setup.id));
      url = parsed.toString();
    } catch {
      toast.error(t('housing:portal.setups.detail.shareErrorMsg'));
      return;
    }

    const result = await shareLink(url, {
      title: t('housing:portal.setups.detail.shareText', {
        authorName: setup.author_name,
        dormName: setup.dorm_name ?? '',
      }),
      text: setup.caption ?? undefined,
    });

    if (result === 'copied') toast.success(t('housing:portal.setups.detail.shareCopiedMsg'));
    else if (result === 'failed') toast.error(t('housing:portal.setups.detail.shareErrorMsg'));
  }, [setup.id, setup.author_name, setup.dorm_name, setup.caption, t]);

  const uploadedLabel = setup.created_at
    ? format(new Date(setup.created_at), 'MMMM d, yyyy')
    : null;

  const renderPhotoCarousel = (variant: 'mobile' | 'desktop') => (
    <div
      className={cn(
        'relative flex items-center justify-center overflow-hidden bg-black',
        variant === 'mobile'
          ? 'w-full'
          : 'w-full h-full md:h-full md:min-h-0 shrink-0 pt-[env(safe-area-inset-top)] md:pt-0',
      )}
    >
      {isLoadingPhotos ? (
        <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" aria-label={t('common:state.loading')} />
      ) : (
        <>
          {/* Aspect-locked media frame: photos cover-fill it edge-to-edge (no
              letterbox); the TikTok trailing slide centers its 9:16 within. On
              mobile the frame is full-bleed width; on desktop it's full height. */}
          <div
            className={cn(
              'relative overflow-hidden',
              variant === 'mobile' ? 'w-full' : 'h-full max-w-full',
            )}
            style={{ aspectRatio: SETUP_MEDIA_ASPECT }}
          >
            <ImageGalleryCarousel
              images={photoUrls}
              imagePositions={imagePositions}
              alt={`Room setup by ${setup.author_name}`}
              objectFit="cover"
              showArrows="desktop-only"
              className="h-full w-full"
              dotsClassName={variant === 'mobile' ? 'bottom-4' : 'bottom-14 md:bottom-4'}
              onSlideChange={setCurrentPhotoIndex}
              onSlideTap={variant === 'mobile' ? () => handleMobilePhotoTap() : undefined}
              renderOverlay={(slideIndex) =>
                variant === 'mobile'
                  ? renderMobileTagsOverlay(slideIndex)
                  : renderDesktopTagsOverlay(slideIndex)
              }
            />
          </div>
          {/* Instagram anchors the "this post has tagged products" affordance to
              the photo's bottom-left corner, not the caption. Tapping it toggles
              the pins on the image itself. */}
          {(setup.tags?.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setTagsVisible((visible) => !visible);
              }}
              className={cn(
                'absolute bottom-3 left-3 z-20 flex h-7 w-7 items-center justify-center rounded-pill backdrop-blur-sm transition-colors',
                tagsVisible ? 'bg-white text-stone-900' : 'bg-black/55 text-white',
              )}
              aria-label={tagsVisible ? t('housing:portal.setups.detail.hideTagsLabel') : t('housing:portal.setups.detail.showTagsLabel')}
              aria-pressed={tagsVisible}
            >
              <Tag className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          )}
          {variant === 'mobile' && (
            <AnimatePresence>
              {showHeartBurst && (
                <motion.div
                  key="heart-burst"
                  className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: [0, 1, 1, 0], scale: [0, 1.2, 1, 1] }}
                  exit={{ opacity: 0, scale: 1 }}
                  transition={{ duration: 0.7, ease: 'easeOut' }}
                >
                  <Heart className="h-24 w-24 text-[#FF6B6B] fill-[#FF6B6B]" strokeWidth={0} />
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </>
      )}
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="fixed inset-0 z-[10061] flex h-[100dvh] min-h-0 w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-card p-0 text-foreground md:inset-auto md:left-1/2 md:top-1/2 md:h-[85vh] md:min-h-0 md:w-[95vw] md:max-w-6xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl [&>:last-child]:hidden">
          <DialogTitle className="sr-only">{t('housing:portal.setups.detail.setupDetails')}</DialogTitle>

        {isMobile ? (
          /* Instagram-style: media at the top, then the like/comment bar,
             caption, product shelf, and comments all scroll inline below it in
             one column (no full-bleed black takeover, no tap-to-open sheet). */
          <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-card">
            <div className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted"
                aria-label={t('common:actions.close')}
              >
                <X className="h-5 w-5" />
              </button>
              <Avatar className="h-8 w-8 shrink-0 rounded-full border border-border">
                <AvatarImage src={safeImageSrc(avatarUrl) ?? undefined} alt={setup.author_name} />
                <AvatarFallback className="bg-stone-100 text-malachite-800 dark:bg-stone-800 dark:text-malachite-300 text-xs font-bold">
                  {setup.author_name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{setup.author_name}</p>
              {showDelete && onEdit && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onEdit();
                  }}
                  className="shrink-0 p-1.5 text-muted-foreground hover:text-primary"
                  aria-label={t('housing:portal.setups.card.editLabel')}
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}
              {showDelete && onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={isDeleting}
                  className="shrink-0 p-1.5 text-muted-foreground hover:text-red-500 disabled:opacity-50"
                  aria-label={t('housing:portal.setups.card.deleteLabel')}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
              {canReport && (
                <button
                  type="button"
                  onClick={() => setReportOpen(true)}
                  className="shrink-0 p-1.5 text-muted-foreground hover:text-foreground"
                  aria-label={t('housing:portal.setups.detail.reportSetup')}
                >
                  <Flag className="h-4 w-4" />
                </button>
              )}
            </div>

            <div
              ref={scrollContainerRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-card"
            >
              <div className="relative w-full bg-black">
                {renderPhotoCarousel('mobile')}
              </div>

              <div className="px-4 pt-3">
                <div className="mb-2 flex items-center gap-5">
                  <button
                    type="button"
                    onClick={handleLikeClick}
                    className="inline-flex items-center gap-2 text-foreground"
                    aria-label={isLiked ? t('housing:portal.setups.card.unlikeLabel') : t('housing:portal.setups.card.likeLabel')}
                  >
                    <Heart
                      className={cn(
                        'h-6 w-6',
                        isLiked
                          ? 'text-[#FF6B6B] fill-[#FF6B6B]'
                          : 'fill-none stroke-foreground text-foreground stroke-[1.5]',
                      )}
                      strokeWidth={isLiked ? 0 : 1.5}
                    />
                    <span className="text-sm font-semibold tabular-nums">{setup.likes}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCommentsExpanded(true)}
                    className="inline-flex items-center gap-2 text-foreground"
                    aria-label={t('housing:portal.setups.detail.comments')}
                  >
                    <MessageCircle className="h-6 w-6" strokeWidth={2} />
                    <span className="text-sm font-semibold tabular-nums">{comments.length}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleShare()}
                    className="inline-flex items-center justify-center text-foreground"
                    aria-label={t('housing:portal.setups.detail.shareLabel')}
                  >
                    <Share2 className="h-6 w-6" strokeWidth={2} />
                  </button>
                </div>

                {setup.caption ? (
                  <p className="text-sm leading-snug text-foreground">{setup.caption}</p>
                ) : null}
                {uploadedLabel ? (
                  <p className="mt-1 text-xs text-muted-foreground">{t('housing:portal.setups.detail.uploadedLabel', { date: uploadedLabel })}</p>
                ) : null}
              </div>

              <div className="px-4 pb-4 pt-4 space-y-4">
                {tourLinkBlock}
                {productShelfBlock}
                {commentsListBlock}
              </div>
            </div>

            <div
              className="shrink-0 border-t border-border bg-card"
              style={{
                paddingBottom:
                  'calc(var(--keyboard-height, 0px) + max(0.75rem, env(safe-area-inset-bottom, 0px)))',
              }}
            >
              {commentInputBlock}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 grid-rows-[60dvh_minmax(0,1fr)] md:grid-rows-none md:grid-cols-[1fr_400px] flex-1 min-h-0 w-full overflow-hidden">
            {/* LEFT COLUMN: PHOTO CAROUSEL - top-aligned, full-width on mobile */}
            <div className="relative w-full min-h-0 bg-black flex flex-col md:h-full">
              {/* `[&_svg]:size-5` is REQUIRED, not decorative: Button's base carries
                  `[&_svg]:size-4`, a descendant rule that outranks the `h-5 w-5` on
                  the glyph itself, so without it this X silently shrinks 20px -> 16px. */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="absolute left-[max(0.75rem,env(safe-area-inset-left,0px))] top-[max(0.75rem,env(safe-area-inset-top))] z-50 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm transition-colors hover:bg-black/60 md:left-4 md:top-3 [&_svg]:size-5 [&_svg]:text-white"
                aria-label={t('common:actions.close')}
              >
                <X />
              </Button>
              {renderPhotoCarousel('desktop')}
            {!isLoadingPhotos && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowProductTags((prev) => !prev)}
                className={cn(
                  // `[&_svg]:size-5` restates the 20px glyph over Button's base
                  // `[&_svg]:size-4` descendant rule, which the icon's own w-5 h-5
                  // cannot outrank.
                  'absolute bottom-3 left-3 md:bottom-4 md:left-4 w-10 h-10 rounded-lg flex items-center justify-center bg-black/20 backdrop-blur-md transition-colors z-10 border border-white/20 hover:bg-black/30 [&_svg]:size-5 [&_svg]:text-white/90',
                  showProductTags && 'ring-2 ring-white/50 bg-black/30'
                )}
                aria-label={showProductTags ? t('housing:portal.setups.detail.hideTagsLabel') : t('housing:portal.setups.detail.showTagsLabel')}
              >
                <Tag />
              </Button>
            )}
            <div className="absolute bottom-3 right-3 md:bottom-4 md:right-4 flex items-center gap-2 z-10">
              <button
                onClick={handleLikeClick}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-raised transition-colors hover:bg-accent"
                aria-label={isLiked ? t('housing:portal.setups.card.unlikeLabel') : t('housing:portal.setups.card.likeLabel')}
              >
                <Heart
                  className={cn(
                    'w-5 h-5',
                    isLiked ? 'text-[#FF6B6B] fill-[#FF6B6B]' : 'text-muted-foreground fill-none stroke-muted-foreground stroke-[1.5]'
                  )}
                  strokeWidth={isLiked ? 0 : 1.5}
                />
              </button>
              <span className="font-medium text-white drop-shadow-md">{setup.likes}</span>
            </div>
          </div>

          {/* RIGHT COLUMN: SIDEBAR - h-full overflow-hidden; nav hidden when modal open, footer flush */}
          <div className="flex flex-col h-full overflow-hidden border-l border-border bg-card min-h-0">
            {/* 1. Header */}
            <div className="flex-none p-4 md:p-6 border-b border-border bg-card z-20 flex justify-between items-start shrink-0">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <Avatar className="h-10 w-10 shrink-0 rounded-full border-2 border-border  shadow-raised">
                  <AvatarImage src={safeImageSrc(avatarUrl) ?? undefined} alt={setup.author_name} />
                  <AvatarFallback className="bg-stone-100 text-malachite-800 dark:bg-stone-800 dark:text-malachite-300 font-bold text-sm">
                    {setup.author_name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 pt-0.5">
                  <h3 className="font-medium text-foreground truncate">{setup.author_name}</h3>
                  {setup.caption && (
                    <p className="text-sm text-foreground leading-relaxed mt-1 line-clamp-3">
                      {setup.caption}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {showDelete && onEdit && (
                  <button
                    onClick={() => {
                      onClose();
                      onEdit();
                    }}
                    className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-full transition-colors"
                    aria-label={t('housing:portal.setups.card.editLabel')}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
                {showDelete && onDelete && (
                  <button
                    onClick={onDelete}
                    disabled={isDeleting}
                    className="p-2 text-muted-foreground hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                    aria-label={t('housing:portal.setups.card.deleteLabel')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                {canReport && (
                  <button
                    type="button"
                    onClick={() => setReportOpen(true)}
                    className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full transition-colors"
                    aria-label={t('housing:portal.setups.detail.reportSetup')}
                  >
                    <Flag className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* 2. Room tour link + Product Shelf + Comments - flex-1 overflow-y-auto, independent scroll */}
            <div
              ref={scrollContainerRef}
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-card p-4 pb-6 space-y-4 md:space-y-6 md:p-6 md:pt-8"
            >
              {tourLinkBlock}
              {productShelfBlock}
              {commentsListBlock}
            </div>

            {/* 3. Footer - pinned to bottom, pb-safe for iOS home indicator */}
            <div className="z-30 flex-none shrink-0 border-t border-border bg-card pb-[calc(var(--keyboard-height,0px)+max(5rem,env(safe-area-inset-bottom)))] md:pb-[calc(var(--keyboard-height,0px)+max(0.75rem,env(safe-area-inset-bottom,0px)))]">
              {commentInputBlock}
            </div>
          </div>
        </div>
        )}
        <ReportContentDialog
          open={reportOpen}
          onOpenChange={setReportOpen}
          contentType="student_setup"
          contentId={setup.report_uuid ?? null}
          contentLabel="this setup"
        />
      </DialogContent>
    </Dialog>
  );
}
