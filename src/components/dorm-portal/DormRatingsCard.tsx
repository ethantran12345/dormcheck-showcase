import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Star, Flag, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { StarRatingInput } from '@/components/ui/star-rating';
import { StarRatingDisplay } from '@/components/marketplace/StarRating';
import { ReportContentDialog } from '@/components/ReportContentDialog';
import {
  useDormReviewStats,
  useMyDormReview,
  useDormReviewList,
  useCanReviewDorm,
  useSaveDormReview,
  useDeleteDormReview,
  MIN_REVIEWS_FOR_AVERAGES,
  type DormReviewStats,
} from '@/hooks/useDormReviews';

interface DormRatingsCardProps {
  /** master_housing.id for the specific building being viewed. */
  buildingId: number | null | undefined;
  dormName: string;
}

type CategoryKey = 'room' | 'community' | 'studentLife' | 'location';

const CATEGORIES: { key: CategoryKey; labelKey: string; statKey: keyof DormReviewStats }[] = [
  { key: 'room', labelKey: 'housing:portal.ratings.roomQuality', statKey: 'avgRoom' },
  { key: 'community', labelKey: 'housing:portal.ratings.community', statKey: 'avgCommunity' },
  { key: 'studentLife', labelKey: 'housing:portal.ratings.studentLife', statKey: 'avgStudentLife' },
  { key: 'location', labelKey: 'housing:portal.ratings.location', statKey: 'avgLocation' },
];

export function DormRatingsCard({ buildingId, dormName }: DormRatingsCardProps) {
  const { t } = useTranslation();

  const { data: stats, isLoading: statsLoading } = useDormReviewStats(buildingId);
  const { data: myReview, isLoading: myLoading } = useMyDormReview(buildingId);
  const { data: reviews } = useDormReviewList(buildingId);
  const { canReview } = useCanReviewDorm(buildingId);
  const saveMutation = useSaveDormReview(buildingId);
  const deleteMutation = useDeleteDormReview(buildingId);

  const [draft, setDraft] = useState<Record<CategoryKey, number | null>>({
    room: null,
    community: null,
    studentLife: null,
    location: null,
  });
  const [isAnonymous, setIsAnonymous] = useState(true); // requirement 5: default anonymous
  const [reportId, setReportId] = useState<string | null>(null);

  // Hydrate the form from an existing review so it edits in place rather than
  // presenting an empty form over a rating the student already left.
  useEffect(() => {
    if (!myReview) return;
    setDraft({
      room: myReview.rating,
      community: myReview.ratingCommunity,
      studentLife: myReview.ratingStudentLife,
      location: myReview.ratingLocation,
    });
    setIsAnonymous(myReview.isAnonymous);
  }, [myReview]);

  if (typeof buildingId !== 'number') return null;

  const showAverages =
    !!stats && stats.reviewCount >= MIN_REVIEWS_FOR_AVERAGES && stats.avgOverall !== null;

  const handleSave = async () => {
    if (draft.room === null) return; // Room Quality is the one required category
    try {
      await saveMutation.mutateAsync({
        rating: draft.room,
        ratingCommunity: draft.community,
        ratingStudentLife: draft.studentLife,
        ratingLocation: draft.location,
        isAnonymous,
      });
      toast(t('housing:portal.ratings.saved'));
    } catch (err) {
      toast.error(t('housing:portal.ratings.saveFailed'), {
        description: (err as Error).message,
      });
    }
  };

  const handleDelete = async () => {
    if (!myReview) return;
    try {
      await deleteMutation.mutateAsync(myReview.id);
      setDraft({ room: null, community: null, studentLife: null, location: null });
      setIsAnonymous(true);
      toast(t('housing:portal.ratings.deleted'));
    } catch (err) {
      toast.error(t('housing:portal.ratings.deleteFailed'), {
        description: (err as Error).message,
      });
    }
  };

  return (
    <section
      aria-label={t('housing:portal.ratings.ariaLabel')}
      className="overflow-hidden rounded-card border border-stone-200 bg-card shadow-raised"
    >
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Star className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">
          {t('housing:portal.ratings.heading')}
        </h2>
      </div>

      <div className="p-5">
        {/* ── Summary ─────────────────────────────────────────────────────── */}
        {statsLoading ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : showAverages ? (
          <div>
            <div className="flex items-center gap-4">
              <div className="text-4xl font-bold leading-none text-foreground">
                {stats!.avgOverall!.toFixed(1)}
              </div>
              <div className="min-w-0">
                <StarRatingDisplay value={stats!.avgOverall!} size="md" showValue={false} />
                <div className="mt-1 text-sm text-muted-foreground">
                  {t('housing:portal.ratings.count', { count: stats!.reviewCount })}
                </div>
              </div>
            </div>

            <ul className="mt-5 space-y-2.5">
              {CATEGORIES.map((cat) => {
                const value = stats![cat.statKey] as number | null;
                return (
                  <li key={cat.key} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground">{t(cat.labelKey)}</span>
                    <span className="flex items-center gap-2">
                      {value === null ? (
                        <span className="text-sm text-muted-foreground">
                          {t('housing:portal.ratings.noData')}
                        </span>
                      ) : (
                        <>
                          <StarRatingDisplay value={value} size="sm" showValue={false} />
                          <span className="w-8 text-right text-sm font-medium tabular-nums text-foreground">
                            {value.toFixed(1)}
                          </span>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          // Below the threshold we show the COUNT but never an average, matching
          // the server-side suppression in get_dorm_review_stats.
          <div className="rounded-lg bg-muted px-4 py-3.5">
            <p className="text-sm font-medium text-foreground">
              {t('housing:portal.ratings.notEnough', {
                count: MIN_REVIEWS_FOR_AVERAGES - (stats?.reviewCount ?? 0),
              })}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('housing:portal.ratings.countSoFar', { count: stats?.reviewCount ?? 0 })}
            </p>
          </div>
        )}

        {/* ── Entry ───────────────────────────────────────────────────────── */}
        <div className="mt-6 border-t border-border pt-5">
          {myLoading ? (
            <Skeleton className="h-40 w-full rounded-lg" />
          ) : canReview ? (
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {myReview
                  ? t('housing:portal.ratings.editYours')
                  : t('housing:portal.ratings.rateThis', { dorm: dormName })}
              </h3>

              <div className="mt-4 space-y-4">
                {CATEGORIES.map((cat) => (
                  <div key={cat.key} className="flex items-center justify-between gap-3">
                    <label className="text-sm text-foreground" id={`rating-label-${cat.key}`}>
                      {t(cat.labelKey)}
                      {cat.key === 'room' && <span className="text-muted-foreground"> *</span>}
                    </label>
                    <StarRatingInput
                      value={draft[cat.key]}
                      onChange={(v) => setDraft((d) => ({ ...d, [cat.key]: v }))}
                      label={t(cat.labelKey)}
                      size="lg"
                    />
                  </div>
                ))}
              </div>

              <div className="mt-5 flex items-center justify-between gap-3 rounded-lg bg-muted px-4 py-3">
                <label htmlFor="rating-anonymous" className="text-sm text-foreground">
                  {t('housing:portal.ratings.postAnonymously')}
                </label>
                <Switch
                  id="rating-anonymous"
                  checked={isAnonymous}
                  onCheckedChange={setIsAnonymous}
                  aria-label={t('housing:portal.ratings.postAnonymously')}
                />
              </div>

              <div className="mt-4 flex items-center gap-2">
                <Button
                  onClick={handleSave}
                  disabled={draft.room === null || saveMutation.isPending}
                  className="bg-malachite-800 hover:bg-malachite-900 dark:bg-malachite-600 dark:hover:bg-malachite-700"
                >
                  {saveMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  )}
                  {myReview
                    ? t('housing:portal.ratings.update')
                    : t('housing:portal.ratings.submit')}
                </Button>

                {myReview && (
                  <Button
                    variant="ghost"
                    onClick={handleDelete}
                    disabled={deleteMutation.isPending}
                    aria-label={t('housing:portal.ratings.delete')}
                  >
                    <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                    {t('housing:portal.ratings.delete')}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('housing:portal.ratings.residentsOnly', { dorm: dormName })}
            </p>
          )}
        </div>

        {/* ── Individual ratings (report anchor) ──────────────────────────── */}
        {reviews && reviews.length > 0 && (
          <div className="mt-6 border-t border-border pt-5">
            <h3 className="text-sm font-semibold text-foreground">
              {t('housing:portal.ratings.recentHeading')}
            </h3>
            <ul className="mt-3 space-y-2.5">
              {reviews.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <StarRatingDisplay value={r.rating} size="sm" showValue={false} />
                    <span className="truncate text-sm text-muted-foreground">
                      {r.authorName ?? t('housing:portal.ratings.anonymous')}
                    </span>
                  </div>
                  {!r.isMine && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setReportId(r.id)}
                      className="h-8 w-8 shrink-0 [&_svg]:text-muted-foreground [&_svg]:hover:text-foreground"
                      aria-label={t('housing:portal.ratings.reportAria')}
                    >
                      <Flag className="h-4 w-4" aria-hidden />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <ReportContentDialog
        open={reportId !== null}
        onOpenChange={(open) => !open && setReportId(null)}
        contentType="student_review"
        contentId={reportId}
        contentLabel={t('housing:portal.ratings.reportLabel')}
      />
    </section>
  );
}
