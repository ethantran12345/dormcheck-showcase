import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { findDormById, useDorms } from '@/hooks/useDorms';
import { Dorm } from '@/types';
import { Loader2 } from 'lucide-react';
import { dormSlugFromName, findDormBySlugInList } from '@/lib/dormSlug';
import { PageContainer } from '@/components/ui/page-container';

const DormDetail = lazy(() =>
  import('@/components/DormDetail').then((module) => ({ default: module.DormDetail }))
);

const EXPLORE_PATH = '/campus';

export default function HousingDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { dorms, isLoading: dormsLoading } = useDorms();
  const [dorm, setDorm] = useState<Dorm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const hasResolvedOnceRef = useRef(false);

  const fromExplore = (location.state as { fromExplore?: boolean } | undefined)?.fromExplore === true;

  const handleBack = () => {
    if (fromExplore) {
      navigate(-1);
    } else {
      navigate(EXPLORE_PATH);
    }
  };

  useEffect(() => {
    hasResolvedOnceRef.current = false;
  }, [slug]);

  useEffect(() => {
    if (!slug) {
      setError(true);
      setDorm(null);
      setLoading(false);
      hasResolvedOnceRef.current = false;
      return;
    }

    let cancelled = false;

    const run = async () => {
      if (/^\d+$/.test(slug)) {
        const found = await findDormById(slug);
        if (cancelled) return;
        if (found) {
          navigate(`/housing/${dormSlugFromName(found.name)}`, { replace: true });
          return;
        }
        setDorm(null);
        setError(true);
        setLoading(false);
        return;
      }

      if (dormsLoading && !hasResolvedOnceRef.current) {
        setLoading(true);
        return;
      }

      const found = findDormBySlugInList(dorms, slug);
      if (cancelled) return;
      setDorm(found ?? null);
      setError(!found);
      setLoading(false);
      if (found) {
        hasResolvedOnceRef.current = true;
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [slug, dorms, dormsLoading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="flex justify-center items-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (error || !dorm) {
    return (
      <div className="min-h-screen bg-background">
        <PageContainer width="prose" className="px-4 py-12 text-center">
          <p className="text-muted-foreground mb-4">{t('housing:detail.notFound.message')}</p>
          <button
            type="button"
            onClick={() => navigate(EXPLORE_PATH)}
            className="text-primary hover:underline"
          >
            {t('housing:detail.notFound.backButton')}
          </button>
        </PageContainer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Suspense
        fallback={
          <div className="flex justify-center items-center p-10 min-h-screen">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        }
      >
        <DormDetail
          dorm={dorm}
          photos={[]}
          onBack={handleBack}
          onViewMap={() =>
            navigate(`/campus?focus=${encodeURIComponent(dormSlugFromName(dorm.name))}`)
          }
          allDorms={dorms}
          onDormSelect={(d) => navigate('/housing/' + dormSlugFromName(d.name))}
        />
      </Suspense>
    </div>
  );
}
