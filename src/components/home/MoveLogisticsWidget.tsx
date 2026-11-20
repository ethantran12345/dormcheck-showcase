import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Loader2, Navigation, Truck } from 'lucide-react';
import { DormMiniMap } from '@/components/DormMiniMapLazy';
import { WidgetCard, WidgetBleed } from '@/components/my-home/WidgetCard';
import { Button } from '@/components/ui/button';
import { directionsUrl } from '@/lib/maps';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentUserBuilding } from '@/hooks/useCurrentUserBuilding';
import { useDorms } from '@/hooks/useDorms';
import { supabase } from '@/integrations/supabase/client';
import { dormSlugFromName } from '@/lib/dormSlug';
import type { Dorm } from '@/types';

interface ProfileRow {
  current_dorm: string | null;
}

export function MoveLogisticsWidget() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { dorms, isLoading: dormsLoading } = useDorms();
  const { building, isLoading: buildingLoading } = useCurrentUserBuilding();

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['move-logistics-widget-profile', user?.id ?? ''],
    queryFn: async (): Promise<ProfileRow | null> => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('current_dorm')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ProfileRow | null;
    },
    enabled: !!user?.id,
  });

  const currentDorm = useMemo<Dorm | null>(() => {
    const name = (profile?.current_dorm ?? '').trim();
    if (!name) return null;
    return dorms.find((d) => d.name.trim().toLowerCase() === name.toLowerCase()) ?? null;
  }, [dorms, profile?.current_dorm]);

  const mapTarget = useMemo(() => {
    if (!building) return null;
    const dorm = dorms.find((d) => d.id === String(building.buildingId));
    if (!dorm || dorm.latitude == null || dorm.longitude == null) return null;
    const { latitude, longitude } = dorm;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return {
      latitude,
      longitude,
      name: building.residenceHallName,
    };
  }, [building, dorms]);

  const loading = dormsLoading || profileLoading || buildingLoading;
  const addr = currentDorm?.address?.trim() || currentDorm?.mailingAddress?.trim() || null;
  const buildingName = currentDorm?.name ?? building?.residenceHallName ?? 'Your dorm';
  const directionsHref = directionsUrl({
    address: addr,
    lat: mapTarget?.latitude,
    lng: mapTarget?.longitude,
  });
  const hasDirections = !!addr || !!mapTarget;

  const [addrCopied, setAddrCopied] = useState(false);
  const handleCopyAddress = async () => {
    if (!addr) return;
    try {
      await navigator.clipboard.writeText(addr);
      setAddrCopied(true);
      setTimeout(() => setAddrCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <WidgetCard title="Move-In & Move-Out" icon={<Truck className="w-4 h-4" />} tint="sky">
      {loading ? (
        <div className="flex flex-1 items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">Your building</p>
              <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{buildingName}</p>
            </div>
            {hasDirections ? (
              <a
                href={directionsHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-malachite-800 px-4 py-2 text-sm font-medium text-white hover:bg-malachite-900"
              >
                <Navigation className="h-4 w-4" />
                Directions
              </a>
            ) : null}
          </div>

          {mapTarget ? (
            // Stretch the map nearly edge-to-edge and make it tap through to
            // directions (the mini-map's own button is hidden).
            <WidgetBleed className="mt-3">
              <a
                href={directionsHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open directions to ${mapTarget.name}`}
                className="block w-full"
              >
                <div className="h-28 overflow-hidden rounded-2xl [&_button]:hidden">
                  <DormMiniMap
                    latitude={mapTarget.latitude}
                    longitude={mapTarget.longitude}
                    buildingName={mapTarget.name}
                    onViewMap={() =>
                      navigate(`/campus?focus=${encodeURIComponent(dormSlugFromName(mapTarget.name))}`)
                    }
                    className="h-full min-h-0 w-full rounded-none border-0 shadow-none"
                  />
                </div>
              </a>
            </WidgetBleed>
          ) : null}

          {addr ? (
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Address</p>
                <p className="truncate text-sm text-foreground">{addr}</p>
              </div>
              <button
                type="button"
                onClick={handleCopyAddress}
                aria-label="Copy address"
                className="flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {addrCopied ? (
                  <>
                    <Check className="h-4 w-4 text-malachite-600" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Copy
                  </>
                )}
              </button>
            </div>
          ) : null}

          <div className="mt-4 flex gap-2">
            <Button
              type="button"
              className="flex-1 bg-malachite-800 text-white hover:bg-malachite-900"
              onClick={() => navigate('/checklist?tab=movein')}
            >
              Move-in plan
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => navigate('/checklist?tab=moveout')}
            >
              Move-out
            </Button>
          </div>
        </>
      )}
    </WidgetCard>
  );
}
