import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Clock, Footprints, MapPin, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  AdaptiveOverlay,
  AdaptiveOverlayContent,
  AdaptiveOverlayDescription,
  AdaptiveOverlayHeader,
  AdaptiveOverlayTitle,
} from '@/components/ui/adaptive-overlay';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  effectiveLocation,
  useBuildings,
  useDeleteUserClass,
  useHomeLocation,
  useUpdateUserClass,
  useWalkingRoute,
  type Building,
  type UserClass,
} from '@/hooks/useSchedule';
import { BuildingCombobox } from '@/components/schedule/BuildingCombobox';
import { useMapboxTheme } from '@/hooks/useMapboxTheme';
import { formatTime } from '@/components/schedule/WeeklyGrid';
import { computeLeaveBy, parseRoomCode } from '@/lib/schedule/roomCode';

const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined) ?? '';

const DAY_LABELS: Record<string, string> = {
  Mo: 'Mon', Tu: 'Tue', We: 'Wed', Th: 'Thu', Fr: 'Fri', Sa: 'Sat', Su: 'Sun',
};

interface ClassDetailSheetProps {
  cls: UserClass | null;
  onClose: () => void;
}

/** Class details: meeting info + walking route from home with distance / time / leave-by. */
export function ClassDetailSheet({ cls, onClose }: ClassDetailSheetProps) {
  const { t } = useTranslation();
  const { data: buildings = [] } = useBuildings();
  const { data: home } = useHomeLocation();
  const deleteClass = useDeleteUserClass();
  const updateClass = useUpdateUserClass();

  // Inline "where does this class meet?" editor. Replaces a stacked dialog so
  // the room fix stays within this one overlay instead of opening a second one.
  const [editingRoom, setEditingRoom] = useState(false);
  const [roomBuilding, setRoomBuilding] = useState<Building | null>(null);
  const [roomText, setRoomText] = useState('');

  const effective = cls ? effectiveLocation(cls) : { room: null, buildingId: null };
  const building = useMemo(
    () => buildings.find((b) => b.id === effective.buildingId) ?? null,
    [buildings, effective.buildingId],
  );

  const from =
    home?.lat != null && home?.lng != null ? { lat: home.lat, lng: home.lng } : null;
  const to =
    building?.lat != null && building?.lng != null
      ? { lat: building.lat, lng: building.lng }
      : null;

  const { data: route, isLoading: routeLoading } = useWalkingRoute(from, to);

  // Reset the inline editor whenever a different class opens.
  useEffect(() => {
    setEditingRoom(false);
    setRoomBuilding(building);
    setRoomText(cls?.override_room ?? '');
  }, [cls?.id, cls?.override_room, building]);

  // Typing a full room code like CL0306 resolves the building automatically.
  const handleRoomTextChange = (value: string) => {
    setRoomText(value);
    if (value.length >= 4) {
      const parsed = parseRoomCode(value, buildings.map((b) => b.abbr));
      if (parsed) {
        const match = buildings.find((b) => b.abbr === parsed.buildingAbbr);
        if (match) setRoomBuilding(match);
      }
    }
  };

  const handleSaveRoom = async () => {
    if (!cls) return;
    try {
      await updateClass.mutateAsync({
        id: cls.id,
        override_building_id: roomBuilding?.id ?? null,
        override_room: roomText.trim() || null,
      });
      toast.success(t('checklist:schedule.roomSaved'));
      setEditingRoom(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('checklist:actions.couldNotSave'));
    }
  };

  const walkMinutes = route ? Math.ceil(route.durationSeconds / 60) : null;
  const leaveBy =
    route && cls?.start_time ? computeLeaveBy(cls.start_time, route.durationSeconds) : null;

  const handleDelete = async () => {
    if (!cls) return;
    try {
      await deleteClass.mutateAsync(cls.id);
      toast.success(t('checklist:schedule.classRemoved'));
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('checklist:schedule.couldNotRemove'));
    }
  };

  return (
    <AdaptiveOverlay open={!!cls} onOpenChange={(open) => !open && onClose()}>
      <AdaptiveOverlayContent
        side="bottom"
        mobileClassName="max-h-[92dvh] overflow-y-auto rounded-t-2xl"
        desktopClassName="max-h-[85vh] overflow-y-auto"
      >
        {cls && (
          <>
            <AdaptiveOverlayHeader className="text-left">
              <AdaptiveOverlayTitle>{cls.label}</AdaptiveOverlayTitle>
              <AdaptiveOverlayDescription>
                {cls.days.map((d) => DAY_LABELS[d] ?? d).join(', ')}
                {cls.start_time ? ` · ${formatTime(cls.start_time)}` : ''}
                {cls.end_time ? ` – ${formatTime(cls.end_time)}` : ''}
              </AdaptiveOverlayDescription>
            </AdaptiveOverlayHeader>

            <div className="mt-3 space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4 shrink-0 text-malachite-600" aria-hidden />
                <span>
                  {building
                    ? `${building.name}${effective.room ? `, Room ${effective.room.replace(building.abbr, '')}` : ''}`
                    : effective.room
                      ? `Room ${effective.room}`
                      : t('checklist:schedule.roomNotPublishedYet')}
                </span>
              </div>

              {!building && !editingRoom && (
                <Button
                  type="button"
                  onClick={() => setEditingRoom(true)}
                  className="w-full bg-malachite-800 text-white hover:bg-malachite-900"
                >
                  {t('checklist:schedule.addRoomForRoutes')}
                </Button>
              )}

              {editingRoom && (
                <div className="space-y-3 rounded-xl border border-border bg-muted/60 p-3">
                  <p className="text-sm text-muted-foreground">
                    {t('checklist:schedule.addRoomDescription')}
                  </p>
                  <div className="space-y-1.5">
                    <Label htmlFor="sheet-fix-room">
                      {t('checklist:schedule.roomCodeOrNumber')}
                    </Label>
                    <Input
                      id="sheet-fix-room"
                      value={roomText}
                      onChange={(e) => handleRoomTextChange(e.target.value)}
                      placeholder="CL0306 or 0306"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sheet-fix-building">
                      {t('checklist:schedule.building')}
                    </Label>
                    <BuildingCombobox
                      id="sheet-fix-building"
                      value={roomBuilding}
                      onChange={setRoomBuilding}
                      label={t('checklist:schedule.building')}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setEditingRoom(false)}
                      className="flex-1"
                    >
                      {t('common:actions.cancel')}
                    </Button>
                    <Button
                      type="button"
                      onClick={handleSaveRoom}
                      disabled={(!roomBuilding && !roomText.trim()) || updateClass.isPending}
                      className="flex-1 bg-malachite-800 text-white hover:bg-malachite-900"
                    >
                      {updateClass.isPending
                        ? t('checklist:schedule.saving')
                        : t('checklist:schedule.saveRoom')}
                    </Button>
                  </div>
                </div>
              )}

              {!home && to && (
                <p className="rounded-xl bg-malachite-50 px-3 py-2 text-sm text-malachite-900">
                  {t('checklist:schedule.setHomeForRoutes')}
                </p>
              )}

              {route && walkMinutes != null && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-border bg-card p-2.5 text-center shadow-raised">
                    <Footprints className="mx-auto h-4 w-4 text-malachite-600" aria-hidden />
                    <p className="mt-1 text-sm font-semibold">{walkMinutes} {t('checklist:schedule.minLabel')}</p>
                    <p className="text-[11px] text-muted-foreground">{t('checklist:schedule.walkLabel')}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-2.5 text-center shadow-raised">
                    <MapPin className="mx-auto h-4 w-4 text-malachite-600" aria-hidden />
                    <p className="mt-1 text-sm font-semibold">
                      {(route.distanceMeters / 1609.34).toFixed(1)} mi
                    </p>
                    <p className="text-[11px] text-muted-foreground">{t('checklist:schedule.distanceLabel')}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-2.5 text-center shadow-raised">
                    <Clock className="mx-auto h-4 w-4 text-malachite-600" aria-hidden />
                    <p className="mt-1 text-sm font-semibold">
                      {leaveBy ? formatTime(leaveBy) : '–'}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{t('checklist:schedule.leaveByLabel')}</p>
                  </div>
                </div>
              )}
              {routeLoading && from && to && (
                <p className="text-sm text-muted-foreground">{t('checklist:schedule.findingRoute')}</p>
              )}

              {from && to && (
                <RouteMap
                  from={from}
                  to={to}
                  geometry={route?.geometry ?? null}
                  homeLabel={home?.label ?? 'Home'}
                  buildingLabel={building?.name ?? 'Class'}
                />
              )}

              {from && to && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => openExternalDirections(from, to)}
                  className="w-full"
                >
                  <MapPin className="mr-2 h-4 w-4 text-malachite-700" aria-hidden />
                  {Capacitor.isNativePlatform()
                    ? t('checklist:schedule.directionsAppleMaps')
                    : t('checklist:schedule.openGoogleMaps')}
                </Button>
              )}

              <Button
                type="button"
                variant="outline"
                onClick={handleDelete}
                disabled={deleteClass.isPending}
                className="w-full text-destructive hover:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                {t('checklist:schedule.removeClass')}
              </Button>
            </div>
          </>
        )}
      </AdaptiveOverlayContent>
    </AdaptiveOverlay>
  );
}

/**
 * Walking directions in the platform's native maps app. Apple Maps is
 * single-destination, so this is per-class (origin → this building). Pass
 * `from` as the student's live GPS (or saved home); pass `null` to omit the
 * origin so Apple/Google Maps fills in the device's current location itself -
 * the fallback when we couldn't read GPS in-app.
 */
export function openExternalDirections(
  from: { lat: number; lng: number } | null,
  to: { lat: number; lng: number },
) {
  if (Capacitor.isNativePlatform()) {
    const saddr = from ? `saddr=${from.lat},${from.lng}&` : '';
    const query = `${saddr}daddr=${to.lat},${to.lng}&dirflg=w`;
    // maps:// opens the Apple Maps app directly; http fallback if the scheme fails.
    const opened = window.open(`maps://?${query}`);
    if (!opened) window.open(`http://maps.apple.com/?${query}`, '_blank', 'noopener,noreferrer');
    return;
  }
  const origin = from ? `origin=${from.lat},${from.lng}&` : '';
  window.open(
    `https://www.google.com/maps/dir/?api=1&${origin}destination=${to.lat},${to.lng}&travelmode=walking`,
    '_blank',
    'noopener,noreferrer',
  );
}

function RouteMap({
  from,
  to,
  geometry,
  homeLabel,
  buildingLabel,
}: {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  geometry: GeoJSON.LineString | null;
  homeLabel: string;
  buildingLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const { styleUrl } = useMapboxTheme();

  useEffect(() => {
    if (!containerRef.current || !MAPBOX_TOKEN) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;

    const bounds = new mapboxgl.LngLatBounds([from.lng, from.lat], [from.lng, from.lat]);
    bounds.extend([to.lng, to.lat]);
    if (geometry) for (const c of geometry.coordinates) bounds.extend(c as [number, number]);

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: styleUrl,
      bounds,
      fitBoundsOptions: { padding: 48 },
      interactive: true,
      attributionControl: true,
    });
    mapRef.current = map;

    new mapboxgl.Marker({ color: '#068F30' }) // malachite-700
      .setLngLat([from.lng, from.lat])
      .setPopup(new mapboxgl.Popup({ closeButton: false }).setText(homeLabel))
      .addTo(map);
    new mapboxgl.Marker({ color: '#0B5C26' }) // malachite-900
      .setLngLat([to.lng, to.lat])
      .setPopup(new mapboxgl.Popup({ closeButton: false }).setText(buildingLabel))
      .addTo(map);

    // The bottom sheet is still animating open when the map mounts, so the
    // container can measure 0x0 and the initial bounds fit lands wrong. Re-fit
    // once loaded and again shortly after the sheet settles.
    const refit = () => {
      map.resize();
      map.fitBounds(bounds, { padding: 48, duration: 0 });
    };
    const refitTimer = window.setTimeout(refit, 350);

    map.on('load', () => {
      refit();
      if (!geometry) return;
      map.addSource('walking-route', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry },
      });
      map.addLayer({
        id: 'walking-route-line',
        type: 'line',
        source: 'walking-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#03C03C', 'line-width': 4, 'line-opacity': 0.85 },
      });
    });

    return () => {
      window.clearTimeout(refitTimer);
      map.remove();
      mapRef.current = null;
    };
    // styleUrl in deps: the walking-route layer is style-bound, so recreate on
    // theme change instead of setStyle (which would drop it).
  }, [from.lat, from.lng, to.lat, to.lng, geometry, homeLabel, buildingLabel, styleUrl]);

  if (!MAPBOX_TOKEN) return null;

  return (
    <div
      ref={containerRef}
      className="h-64 w-full overflow-hidden rounded-xl border border-border"
      role="img"
      aria-label={`Map of the walking route from ${homeLabel} to ${buildingLabel}`}
    />
  );
}
