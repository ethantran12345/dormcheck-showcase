import { forwardRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import { Flag, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ReportContentDialog } from '@/components/ReportContentDialog';
import { StarRatingDisplay, StarRatingInput } from '@/components/marketplace/StarRating';
import { cn } from '@/lib/utils';
import { safeImageSrc } from '@/lib/sanitize';
import { useAuth } from '@/hooks/useAuth';
import {
  useCanRateSeller,
  useDeleteSellerRating,
  useMyRatingFor,
  useSellerRatingStats,
  useSellerReviews,
  useUpsertSellerRating,
} from '@/hooks/useSellerRatings';

const COMMENT_MAX = 750;

type SellerRatingsSectionProps = {
  sellerId: string;
  sellerName: string;
  /** Listing that prompted the rating; stored as context on new ratings. */
  listingId?: string;
  className?: string;
};

/**
 * Seller ratings: summary, rate/edit form (only for eligible viewers), and the
 * written reviews list. Eligibility is a UX check; RLS enforces the real gate.
 */
export const SellerRatingsSection = forwardRef<HTMLDivElement, SellerRatingsSectionProps>(
  function SellerRatingsSection({ sellerId, sellerName, listingId, className }, ref) {
    const { t } = useTranslation();
    const { user } = useAuth();
    const { data: stats } = useSellerRatingStats(sellerId);
    const { data: reviews = [], isLoading: reviewsLoading } = useSellerReviews(sellerId);
    const { data: myRating } = useMyRatingFor(sellerId);
    const { canRate } = useCanRateSeller(sellerId);
    const upsertRating = useUpsertSellerRating();
    const deleteRating = useDeleteSellerRating();

    const [formOpen, setFormOpen] = useState(false);
    const [stars, setStars] = useState(0);
    const [comment, setComment] = useState('');
    const [reportRatingId, setReportRatingId] = useState<string | null>(null);

    useEffect(() => {
      if (formOpen) {
        setStars(myRating?.stars ?? 0);
        setComment(myRating?.comment ?? '');
      }
    }, [formOpen, myRating]);

    const handleSubmit = async () => {
      if (!stars) {
        toast.error(t('marketplace:ratings.toast.pickStars'));
        return;
      }
      try {
        await upsertRating.mutateAsync({
          sellerId,
          stars,
          comment,
          listingId: myRating?.listing_id ?? listingId ?? null,
        });
        toast.success(myRating ? t('marketplace:ratings.toast.updated') : t('marketplace:ratings.toast.submitted'));
        setFormOpen(false);
      } catch {
        toast.error(t('marketplace:ratings.toast.mustMessage'));
      }
    };

    const handleRemove = async () => {
      try {
        await deleteRating.mutateAsync(sellerId);
        toast.success(t('marketplace:ratings.toast.removed'));
        setFormOpen(false);
      } catch {
        toast.error(t('marketplace:ratings.toast.removeError'));
      }
    };

    const showRateButton = canRate && !formOpen;

    // The seller's rating summary already lives near their profile (SellerInfoCard),
    // so this section is redundant when there's nothing to show AND the viewer can't
    // leave a rating. Hide it in that case; it reappears the moment ratings exist or
    // an eligible buyer can rate (preserving the rate/edit form).
    if (!stats && reviews.length === 0 && !canRate) {
      return null;
    }

    return (
      <div ref={ref} className={cn('flex flex-col gap-3', className)}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-foreground">{t('marketplace:ratings.title')}</h3>
          {showRateButton && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full border-border text-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setFormOpen(true)}
            >
              {myRating ? t('marketplace:ratings.editButton') : t('marketplace:ratings.rateButton')}
            </Button>
          )}
        </div>

        {stats ? (
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-foreground">{stats.avgStars.toFixed(1)}</span>
            <StarRatingDisplay
              value={stats.avgStars}
              count={stats.ratingCount}
              showValue={false}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('marketplace:ratings.emptyWithName', { name: sellerName })}
          </p>
        )}

        {formOpen && (
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-4">
            <p className="text-sm font-medium text-foreground">
              {t('marketplace:ratings.experiencePrompt', { name: sellerName })}
            </p>
            <StarRatingInput value={stars} onChange={setStars} disabled={upsertRating.isPending} />
            <div>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX))}
                placeholder={t('marketplace:ratings.commentPlaceholder')}
                maxLength={COMMENT_MAX}
                rows={3}
                aria-label={t('marketplace:ratings.commentAria')}
                className="bg-card"
              />
              <p className="mt-1 text-right text-xs text-muted-foreground">
                {comment.length}/{COMMENT_MAX}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                // KEEP: primary CTA of the review form (submit rating)
                className="bg-malachite-800 text-white hover:bg-malachite-900"
                onClick={handleSubmit}
                disabled={upsertRating.isPending}
              >
                {upsertRating.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {myRating ? t('common:actions.saveChanges') : t('marketplace:ratings.submitButton')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setFormOpen(false)}
                disabled={upsertRating.isPending}
              >
                {t('common:actions.cancel')}
              </Button>
              {myRating && (
                <Button
                  type="button"
                  variant="ghost"
                  className="ml-auto text-destructive hover:text-destructive"
                  onClick={handleRemove}
                  disabled={deleteRating.isPending}
                >
                  {t('marketplace:ratings.removeButton')}
                </Button>
              )}
            </div>
          </div>
        )}

        {reviewsLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('marketplace:ratings.loading')}
          </div>
        ) : (
          reviews.length > 0 && (
            <ul className="flex flex-col gap-3">
              {reviews.map((review) => {
                const avatar = safeImageSrc(review.raterAvatarUrl ?? undefined);
                const isMine = review.raterId === user?.id;
                return (
                  <li key={review.id} className="flex gap-3 rounded-xl border border-border bg-card p-3">
                    {avatar ? (
                      <img src={avatar} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                        {review.raterName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium text-foreground">
                          {review.raterName}
                          {isMine && <span className="ml-1 text-xs text-muted-foreground">{t('marketplace:ratings.you')}</span>}
                        </p>
                        {!isMine && user && (
                          <button
                            type="button"
                            onClick={() => setReportRatingId(review.id)}
                            className="rounded p-1 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600"
                            aria-label={t('marketplace:ratings.reportAria', { name: review.raterName })}
                          >
                            <Flag className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        <StarRatingDisplay value={review.stars} size="sm" showValue={false} />
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(review.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                      {review.comment && (
                        <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-foreground/90">
                          {review.comment}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        )}

        <ReportContentDialog
          open={!!reportRatingId}
          onOpenChange={(open) => !open && setReportRatingId(null)}
          contentType="seller_rating"
          contentId={reportRatingId}
          contentLabel={t('marketplace:ratings.reportLabel')}
        />
      </div>
    );
  }
);
