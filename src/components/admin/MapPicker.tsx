import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MAPBOX_STYLE_LIGHT } from '@/hooks/useMapboxTheme';

// Admin console chrome is light-only, so the picker keeps the light style.
const MAPBOX_STYLE = MAPBOX_STYLE_LIGHT;
const MARKER_COLOR = '#03C03C';
const INITIAL_ZOOM = 16;

interface MapPickerProps {
  currentLat: number | null;
  currentLng: number | null;
  /**
   * Where the map opens when the record has no coordinates yet, Mapbox order
   * `[lng, lat]` — pass the campus centre of the school the record belongs to
   * (`University.campusCenter`). Required on purpose, exactly like
   * `geocodeAddress`'s `proximity`: this was a hardcoded Oakland constant, so an
   * admin pinning a CMU dorm started three miles from campus and dropped the pin
   * wherever the map happened to open. A required prop cannot be forgotten by
   * the next call site.
   */
  center: [number, number];
  onSave: (lat: number, lng: number) => Promise<void>;
  onCancel: () => void;
  disabled: boolean;
}

function hasValidToken(): boolean {
  const token = import.meta.env.VITE_MAPBOX_TOKEN;
  return typeof token === 'string' && token.trim() !== '';
}

function createMarkerElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.width = '22px';
  el.style.height = '22px';
  el.style.background = MARKER_COLOR;
  el.style.borderRadius = '50%';
  el.style.border = '3px solid white';
  el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
  return el;
}

function FallbackNumberInputs({
  currentLat,
  currentLng,
  onSave,
  onCancel,
  disabled,
}: MapPickerProps) {
  const [lat, setLat] = useState(currentLat == null ? '' : String(currentLat));
  const [lng, setLng] = useState(currentLng == null ? '' : String(currentLng));
  const [saving, setSaving] = useState(false);

  const busy = disabled || saving;

  const handleSave = async () => {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
      return;
    }
    if (!Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
      return;
    }
    setSaving(true);
    try {
      await onSave(latNum, lngNum);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
        Map unavailable, enter coords manually.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Latitude</span>
          <input
            type="number"
            step="any"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            disabled={busy}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-malachite-600 focus:outline-none focus:ring-1 focus:ring-malachite-600 disabled:opacity-60"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Longitude</span>
          <input
            type="number"
            step="any"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            disabled={busy}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-malachite-600 focus:outline-none focus:ring-1 focus:ring-malachite-600 disabled:opacity-60"
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          onClick={() => void handleSave()}
          disabled={busy}
          className="bg-malachite-800 text-white hover:bg-malachite-900"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
        </Button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function MapPicker(props: MapPickerProps) {
  const { currentLat, currentLng, center, onSave, onCancel, disabled } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  const initialLat = currentLat != null && Number.isFinite(currentLat) ? currentLat : null;
  const initialLng = currentLng != null && Number.isFinite(currentLng) ? currentLng : null;

  const [pickedLat, setPickedLat] = useState<number | null>(initialLat);
  const [pickedLng, setPickedLng] = useState<number | null>(initialLng);
  const [mapFailed, setMapFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const tokenValid = hasValidToken();

  useEffect(() => {
    if (!tokenValid) {
      setMapFailed(true);
      return;
    }
    const container = containerRef.current;
    if (!container) return;

    let map: mapboxgl.Map;
    try {
      mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN as string;
      map = new mapboxgl.Map({
        container,
        style: MAPBOX_STYLE,
        center: initialLat != null && initialLng != null ? [initialLng, initialLat] : center,
        zoom: INITIAL_ZOOM,
      });
    } catch (err) {
      console.error('[MapPicker] Mapbox init failed', err);
      setMapFailed(true);
      return;
    }

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;

    map.on('error', (e) => {
      console.error('[MapPicker] Mapbox error', e?.error);
      setMapFailed(true);
    });

    if (initialLat != null && initialLng != null) {
      const marker = new mapboxgl.Marker({ element: createMarkerElement(), draggable: true })
        .setLngLat([initialLng, initialLat])
        .addTo(map);
      marker.on('dragend', () => {
        const pos = marker.getLngLat();
        setPickedLat(pos.lat);
        setPickedLng(pos.lng);
      });
      markerRef.current = marker;
    }

    map.on('click', (e) => {
      const { lng, lat } = e.lngLat;
      if (markerRef.current) {
        markerRef.current.setLngLat([lng, lat]);
      } else {
        const marker = new mapboxgl.Marker({ element: createMarkerElement(), draggable: true })
          .setLngLat([lng, lat])
          .addTo(map);
        marker.on('dragend', () => {
          const pos = marker.getLngLat();
          setPickedLat(pos.lat);
          setPickedLng(pos.lng);
        });
        markerRef.current = marker;
      }
      setPickedLat(lat);
      setPickedLng(lng);
    });

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (mapFailed) {
    return <FallbackNumberInputs {...props} />;
  }

  const canSave =
    pickedLat != null &&
    pickedLng != null &&
    Number.isFinite(pickedLat) &&
    Number.isFinite(pickedLng);

  const busy = disabled || saving;

  const handleSave = async () => {
    if (!canSave || pickedLat == null || pickedLng == null) return;
    setSaving(true);
    try {
      await onSave(pickedLat, pickedLng);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="w-full overflow-hidden rounded-lg border border-border"
        style={{ height: 400 }}
        aria-label="Click map to place marker"
      />
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md border border-border bg-muted px-3 py-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Latitude
          </div>
          <div className="font-mono text-sm text-foreground">
            {pickedLat != null ? pickedLat.toFixed(6) : ' - '}
          </div>
        </div>
        <div className="rounded-md border border-border bg-muted px-3 py-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Longitude
          </div>
          <div className="font-mono text-sm text-foreground">
            {pickedLng != null ? pickedLng.toFixed(6) : ' - '}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Click the map to place the marker, or drag an existing marker to fine-tune.
      </p>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          onClick={() => void handleSave()}
          disabled={busy || !canSave}
          className="bg-malachite-800 text-white hover:bg-malachite-900"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save coords'}
        </Button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
