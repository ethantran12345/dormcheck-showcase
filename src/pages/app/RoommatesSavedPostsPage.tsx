import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Heart, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useBlockedUserIds } from '@/hooks/useBlockedUsers';
import { useIsMobile } from '@/hooks/use-mobile';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import {
  PostCard,
  RoommatePostDetail,
  useStartDm,
  fetchInterestedRoommatePosts,
  patchInterestOptimistic,
  rollbackInterestOptimistic,
  type RoommateSearchPost,
} from '@/components/roommates/FindingRoommates';
import { ReportContentDialog } from '@/components/ReportContentDialog';

export default function RoommatesSavedPostsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { blockedUserIds } = useBlockedUserIds();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const startDm = useStartDm();
  const [reportTarget, setReportTarget] = useState<{ contentId: string; contentLabel: string } | null>(null);

  const [detailPost, setDetailPost] = useState<RoommateSearchPost | null>(null);

  const { data: interestedPosts = [], isLoading } = useQuery({
    queryKey: ['roommate_search_interested_posts_feed', user?.id],
    queryFn: () => fetchInterestedRoommatePosts(user!.id),
    enabled: !!user?.id,
  });

  const visibleInterestedPosts = useMemo(
    () => interestedPosts.filter((p) => !p.user_id || !blockedUserIds.has(p.user_id)),
    [interestedPosts, blockedUserIds],
  );

  const handleToggleInterest = async (post: RoommateSearchPost) => {
    if (!user?.id || post.user_id === user.id) return;
    const interested = false;
    await queryClient.cancelQueries({ queryKey: ['roommate_search_my_interests', user.id] });
    await queryClient.cancelQueries({ queryKey: ['roommate_search_posts'] });
    await queryClient.cancelQueries({ queryKey: ['roommate_search_interested_posts_feed', user.id] });
    const ctx = patchInterestOptimistic(queryClient, user.id, post.id, interested);
    try {
      const { error } = await supabase
        .from('roommate_search_interests')
        .delete()
        .eq('post_id', post.id)
        .eq('user_id', user.id);
      if (error) throw error;
      toast(t('roommates:saved.interestWithdrawn'));
      queryClient.invalidateQueries({ queryKey: ['roommate_search_posts'] });
      queryClient.invalidateQueries({ queryKey: ['roommate_search_my_interests'] });
      queryClient.invalidateQueries({ queryKey: ['roommate_search_interested_posts_feed'] });
    } catch {
      rollbackInterestOptimistic(queryClient, ctx);
      toast.error(t('roommates:saved.couldNotWithdraw'));
    }
  };

  const handleClose = () => {
    navigate('/roommates');
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="w-full px-4 sm:px-8 py-6 pb-8 md:pb-12">
        <div className="flex items-start justify-between gap-4 z-10 bg-background pt-2 pb-4 -mx-4 px-4 sm:-mx-8 sm:px-8 border-b border-border/50 shadow-[0_1px_0_0_var(--border)]">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Heart className="w-6 h-6 text-muted-foreground shrink-0" strokeWidth={1.75} />
              {t('roommates:saved.title')}
            </h1>
            <p className="text-sm text-muted-foreground mt-1 text-left">
              {t('roommates:saved.subtitle')}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-11 w-11 rounded-full shrink-0"
            onClick={handleClose}
            aria-label={t('roommates:saved.backAriaLabel')}
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {!user ? (
          <Card className="mt-8 rounded-2xl border p-6">
            <p className="text-sm text-muted-foreground">{t('roommates:saved.signInMessage')}</p>
            <div className="mt-4">
              <Button onClick={() => navigate('/auth')}>{t('common:actions.continue')}</Button>
            </div>
          </Card>
        ) : isLoading ? (
          <Card className="mt-8 rounded-2xl border p-6 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t('roommates:saved.loading')}
          </Card>
        ) : visibleInterestedPosts.length === 0 ? (
          <Card className="mt-8 rounded-2xl border p-6 text-sm text-muted-foreground">
            {t('roommates:saved.empty')}
          </Card>
        ) : (
          <div className="mt-8 space-y-4">
            {visibleInterestedPosts.map((post) => {
              const isMine = post.user_id === user.id;
              return (
                <PostCard
                  key={post.id}
                  post={post}
                  isMine={isMine}
                  onEdit={undefined}
                  onDeactivate={undefined}
                  onOpenInterests={() => {}}
                  onViewDetails={() => setDetailPost(post)}
                  interestCount={post.interest_count ?? 0}
                  hasMyInterest
                  onToggleInterest={isMine ? undefined : () => void handleToggleInterest(post)}
                  onMessage={
                    !isMine
                      ? () => void startDm(post.user_id, user.id)
                      : undefined
                  }
                />
              );
            })}
          </div>
        )}
      </div>

      <ReportContentDialog
        open={!!reportTarget}
        onOpenChange={(open) => !open && setReportTarget(null)}
        contentType="roommate_post"
        contentId={reportTarget?.contentId ?? null}
        contentLabel={reportTarget?.contentLabel ?? 'this content'}
      />

      <RoommatePostDetail
        post={detailPost}
        open={!!detailPost}
        onClose={() => setDetailPost(null)}
        isMobile={isMobile}
        isMine={!!detailPost && detailPost.user_id === user?.id}
        hasMyInterest={!!detailPost}
        onEdit={() => {}}
        onDeactivate={() => {}}
        onOpenInterests={() => {}}
        interestCount={detailPost?.interest_count ?? 0}
        onMessage={
          detailPost && user?.id && detailPost.user_id !== user.id
            ? () => void startDm(detailPost.user_id, user.id)
            : undefined
        }
        onReport={
          user?.id && detailPost && detailPost.user_id !== user.id
            ? () => setReportTarget({ contentId: detailPost.id, contentLabel: 'this post' })
            : undefined
        }
        onToggleInterest={
          detailPost && detailPost.user_id !== user?.id
            ? () => void handleToggleInterest(detailPost)
            : undefined
        }
      />
    </div>
  );
}
