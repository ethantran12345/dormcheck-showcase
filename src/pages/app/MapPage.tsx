import { lazy, Suspense } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { dormSlugFromName } from '@/lib/dormSlug';
import { useDorms } from '@/hooks/useDorms';
import { RouteSkeleton } from '@/components/skeletons/RouteSkeleton';

const MapView = lazy(() =>
  import('@/components/MapView').then((module) => ({ default: module.MapView }))
);

export default function MapPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { dorms, mapDorms } = useDorms();
  const focusDormId = searchParams.get('focus') ?? undefined;

  return (
    <div className="h-full overflow-hidden bg-background flex flex-col">
      {/* mapbox-gl is the heaviest chunk in the app, so this fallback is on
          screen the longest of any in the app and a bare spinner made the wait
          read as a stall. The canvas shape holds the layout instead. */}
      <Suspense fallback={<RouteSkeleton pathname="/map" />}>
        <div className="flex-1 min-h-0 relative w-full">
          <MapView
            dorms={dorms}
            mapDorms={mapDorms}
            focusDormId={focusDormId}
            onDormClick={(dorm) => navigate(`/campus/${dormSlugFromName(dorm.name)}`)}
          />
        </div>
      </Suspense>
    </div>
  );
}
