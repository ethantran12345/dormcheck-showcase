import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  Building2,
  CheckCircle,
  Loader2,
  MapPin,
  Trash2,
  Users,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { dormSlugFromName } from '@/lib/dormSlug';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { WidgetCard } from '@/components/my-home/WidgetCard';

const POST_LOOKING = 'looking-for-roommates' as const;
const HOUSING_ON = 'on-campus' as const;
const HOUSING_OFF = 'off-campus' as const;

export interface MineRoommateSearchPostRow {
  id: string;
  user_id: string;
  post_type: string;
  content: string;
  budget_max: number | null;
  address: string | null;
  housing_type: string | null;
  move_in_semester: string | null;
  is_active: boolean;
  interest_count: number;
  created_at: string;
}

const compactRoommateLocationChipClass =
  'inline-flex items-center gap-0.5 max-w-full px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-muted text-foreground border border-border hover:opacity-90 transition-opacity';

function RoommatePostLocationChip({
  address,
  housingType,
}: {
  address: string | null | undefined;
  housingType: string | null | undefined;
}) {
  const raw = address?.trim();
  if (!raw) return null;
  if (housingType === HOUSING_OFF) {
    const href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(raw)}`;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(compactRoommateLocationChipClass, 'cursor-pointer')}
      >
        <MapPin className="w-2.5 h-2.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate max-w-[120px]">{raw}</span>
      </a>
    );
  }
  if (housingType === HOUSING_ON) {
    return (
      <Link to={`/housing/${dormSlugFromName(raw)}`} className={cn(compactRoommateLocationChipClass, 'cursor-pointer')}>
        <MapPin className="w-2.5 h-2.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate max-w-[120px]">{raw}</span>
      </Link>
    );
  }
  return (
    <span className={compactRoommateLocationChipClass}>
      <MapPin className="w-2.5 h-2.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate max-w-[120px]">{raw}</span>
    </span>
  );
}

interface YourRoommatePostWidgetProps {
  userId: string;
}

export function YourRoommatePostWidget({ userId }: YourRoommatePostWidgetProps) {
  const queryClient = useQueryClient();
  const [deletingPost, setDeletingPost] = useState<MineRoommateSearchPostRow | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ['my-home-roommate-search-posts', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roommate_search_posts')
        .select(
          'id, user_id, post_type, content, budget_max, address, housing_type, move_in_semester, is_active, interest_count, created_at',
        )
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as MineRoommateSearchPostRow[];
    },
    enabled: !!userId,
  });


  const handleDeactivate = async (postId: string) => {
    setMutatingId(postId);
    try {
      const { error } = await supabase
        .from('roommate_search_posts')
        .update({ is_active: false })
        .eq('id', postId);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['roommate_search_posts'] });
      await queryClient.invalidateQueries({ queryKey: ['my-home-roommate-search-posts', userId] });
      toast.success('Post deactivated');
    } catch {
      toast.error('Could not deactivate', { description: 'Please try again.' });
    } finally {
      setMutatingId(null);
    }
  };

  const handleActivate = async (postId: string) => {
    setMutatingId(postId);
    try {
      const { error } = await supabase
        .from('roommate_search_posts')
        .update({ is_active: true })
        .eq('id', postId);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['roommate_search_posts'] });
      await queryClient.invalidateQueries({ queryKey: ['my-home-roommate-search-posts', userId] });
      toast.success('Post activated');
    } catch {
      toast.error('Could not activate', { description: 'Please try again.' });
    } finally {
      setMutatingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deletingPost) return;
    const id = deletingPost.id;
    setMutatingId(id);
    try {
      const { error } = await supabase.from('roommate_search_posts').delete().eq('id', id);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['roommate_search_posts'] });
      await queryClient.invalidateQueries({ queryKey: ['my-home-roommate-search-posts', userId] });
      setDeletingPost(null);
      toast.success('Post deleted');
    } catch {
      toast.error('Could not delete', { description: 'Please try again.' });
    } finally {
      setMutatingId(null);
    }
  };

  if (!isLoading && posts.length === 0) {
    return null;
  }

  return (
    <>
      <WidgetCard title="Your roommate post" icon={<Users className="h-4 w-4" />} tint="rose" accent>
        {isLoading && posts.length === 0 ? (
          <div className="space-y-3 py-1" aria-hidden>
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : (
          <div className="space-y-3">
            {posts.map((post) => {
              const isLooking = post.post_type === POST_LOOKING;
              const busy = mutatingId === post.id;
              return (
                <div
                  key={post.id}
                  className="flex gap-3 rounded-xl border border-border bg-card overflow-hidden shadow-raised hover:shadow-overlay transition-shadow"
                >
                  <div
                    className={cn(
                      'w-20 shrink-0 aspect-square flex items-center justify-center border-r border-border sm:w-24',
                      isLooking ? 'bg-muted' : 'bg-amber-50/90 dark:bg-amber-950/40',
                    )}
                  >
                    {isLooking ? (
                      <Users className="w-8 h-8 text-muted-foreground" aria-hidden />
                    ) : (
                      <Building2 className="w-8 h-8 text-amber-600" aria-hidden />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col justify-between py-2 pr-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            'shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full border',
                            isLooking
                              ? 'border-border text-foreground bg-muted'
                              : 'border-amber-500/50 text-amber-800 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
                          )}
                        >
                          {isLooking ? 'Looking for roommates' : 'Have a place, need people'}
                        </span>
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                            post.is_active ? 'bg-muted text-foreground' : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {post.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <p className="text-sm text-foreground mt-1.5 line-clamp-2 whitespace-pre-wrap break-words">
                        {post.content}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {post.housing_type === HOUSING_ON && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-muted text-foreground border border-border">
                            On-campus
                          </span>
                        )}
                        {post.housing_type === HOUSING_OFF && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-800 border border-blue-100">
                            Off-campus
                          </span>
                        )}
                        <RoommatePostLocationChip address={post.address} housingType={post.housing_type} />
                        {post.budget_max != null && post.budget_max > 0 && (
                          <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-muted text-foreground border border-border">
                            Max ${post.budget_max}/mo
                          </span>
                        )}
                        {post.move_in_semester?.trim() && (
                          <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-violet-50 text-violet-800 border border-violet-100">
                            Move-in: {post.move_in_semester}
                          </span>
                        )}
                      </div>
                      {(post.interest_count ?? 0) > 0 && (
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {post.interest_count} interested
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {post.is_active ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
                            onClick={() => void handleDeactivate(post.id)}
                            disabled={busy}
                          >
                            {busy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Ban className="w-3.5 h-3.5" />
                            )}
                            Deactivate
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 gap-1.5 text-foreground hover:text-foreground hover:bg-muted"
                            onClick={() => void handleActivate(post.id)}
                            disabled={busy}
                          >
                            {busy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <CheckCircle className="w-3.5 h-3.5" />
                            )}
                            Activate
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 gap-1.5 text-destructive hover:text-destructive"
                            onClick={() => setDeletingPost(post)}
                            disabled={busy}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </WidgetCard>

      <AlertDialog open={!!deletingPost} onOpenChange={(open) => !open && setDeletingPost(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete roommate search post?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this post. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void confirmDelete()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
