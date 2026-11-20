import { lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { SettingsSheet } from '@/components/settings/SettingsSheet';

const SettingsView = lazy(() => import('@/components/settings/SettingsView'));

const loadingFallback = (
  <div className="flex min-h-[40vh] items-center justify-center p-10">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

export default function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();

  // Mobile Settings is ONE draggable bottom sheet over the page the user came
  // from. Its body (SettingsView) swaps between a grouped root, a section panel,
  // or a legal doc keyed off `?section=`/`?doc=`. Dragging the sheet down always
  // fully closes Settings — pop history, or fall back to /my-home on a deep link.
  const handleDismiss = (open: boolean) => {
    if (open) return;
    if (typeof window !== 'undefined' && window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/my-home');
    }
  };

  // Pinned top-left X: on a detail (section/doc) it steps back to the grouped
  // root; on the root it dismisses Settings. Same glyph, same spot, every view.
  const inDetail = !!searchParams.get('section') || !!searchParams.get('doc');
  const handleCloseClick = () => {
    if (inDetail) {
      setSearchParams({}, { replace: true });
    } else {
      handleDismiss(false);
    }
  };

  if (isMobile) {
    // The page this sheet opened over stays mounted behind it (RoutedApp renders
    // it via the background `<Routes>`), so we render ONLY the sheet — no opaque
    // backdrop of our own. vaul's overlay dims the real page behind, iOS-style.
    return (
      <SettingsSheet
        open
        onOpenChange={handleDismiss}
        onCloseClick={handleCloseClick}
        title={t('settings:view.title')}
        // Reset scroll to the top whenever the drilled-in view changes (root ->
        // section -> doc), so a new page never opens mid-scroll.
        scrollResetKey={searchParams.get('section') ?? searchParams.get('doc') ?? 'root'}
      >
        <Suspense fallback={loadingFallback}>
          <SettingsView />
        </Suspense>
      </SettingsSheet>
    );
  }

  return (
    <div className="min-h-screen overflow-y-auto bg-background pb-20 md:pb-8">
      <Suspense fallback={loadingFallback}>
        <SettingsView />
      </Suspense>
    </div>
  );
}
