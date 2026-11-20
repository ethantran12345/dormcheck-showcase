import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { safeImageSrc } from '@/lib/sanitize';
import { VerifiedStudentBadge } from '@/components/marketplace/VerifiedStudentBadge';
import { StarRatingDisplay } from '@/components/marketplace/StarRating';
import { useSellerRatingStats } from '@/hooks/useSellerRatings';

function getSellerInitials(name: string): string {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  // 'S' for Student, not 'P' for Pitt — this initial is shown to every tenant.
  if (tokens.length === 0) return 'S';
  if (tokens.length === 1) return tokens[0].charAt(0).toUpperCase();
  return (tokens[0].charAt(0) + tokens[tokens.length - 1].charAt(0)).toUpperCase();
}

type SellerInfoCardProps = {
  sellerId: string;
  displayName: string;
  /** The LISTING's university_id, so the verified badge names the seller's
   *  school rather than the viewer's. Required once the marketplace can show
   *  another school's listings — see VerifiedStudentBadge. */
  sellerUniversityId?: string | null;
  /** Scrolls or expands the ratings section when the rating chip is clicked. */
  onShowRatings?: () => void;
  className?: string;
};

/** Seller identity block: avatar, name, verified badge, rating summary chip. */
export function SellerInfoCard({
  sellerId,
  displayName,
  sellerUniversityId,
  onShowRatings,
  className,
}: SellerInfoCardProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: stats } = useSellerRatingStats(sellerId);

  // Jobs completed as the provider. Read through the RPC, never counted
  // client-side: a tenant-scoped count(*) reports a different number to every
  // viewer, and a reputation figure that moves with who is looking is worse
  // than none. `null` (not 0) while it loads, so the chip does not flash "0".
  const { data: completedJobs } = useQuery({
    queryKey: ['service_completion_count', sellerId],
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc('service_completion_count', {
        p_user_id: sellerId,
      });
      if (error) throw error;
      return data ?? 0;
    },
    enabled: !!user?.id && !!sellerId,
    staleTime: 60_000,
  });

  const { data: avatarUrl } = useQuery({
    queryKey: ['public_profile_avatar', sellerId],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from('public_profiles')
        .select('id, avatar_url')
        .eq('id', sellerId)
        .maybeSingle();
      if (error) throw error;
      return data?.avatar_url ?? null;
    },
    enabled: !!user?.id && !!sellerId,
    staleTime: 60_000,
  });

  const safeAvatar = safeImageSrc(avatarUrl ?? undefined);

  return (
    <div className={cn('flex items-center gap-3 rounded-xl border border-border bg-card p-3', className)}>
      {safeAvatar ? (
        <img
          src={safeAvatar}
          alt=""
          className="h-11 w-11 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
          {getSellerInitials(displayName)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{displayName}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <VerifiedStudentBadge universityId={sellerUniversityId} />
          {stats ? (
            <button
              type="button"
              onClick={onShowRatings}
              className={cn(
                'rounded-md',
                onShowRatings &&
                  'transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600'
              )}
              aria-label={t('marketplace:seller.ratingsChipAria', {
                value: stats.avgStars,
                count: stats.ratingCount,
              })}
              disabled={!onShowRatings}
            >
              <StarRatingDisplay value={stats.avgStars} count={stats.ratingCount} size="sm" />
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">{t('marketplace:seller.noRatingsYet')}</span>
          )}
          {/* Only once there is one. A "0 jobs completed" chip on a student who
              has never offered a service is a scarlet letter for doing nothing
              wrong, and it is on every seller card in the marketplace. */}
          {!!completedJobs && completedJobs > 0 && (
            <span className="text-xs text-muted-foreground">
              {t('marketplace:seller.completedJobs', { count: completedJobs })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
