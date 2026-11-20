import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Map } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useMapboxTheme } from '@/hooks/useMapboxTheme';
const MARKER_COLOR = '#03C03C';

interface DormMiniMapProps {
  latitude: number;
  longitude: number;
  buildingName: string;
  onViewMap: () => void;
  /** Optional: use w-full h-full when parent constrains size (e.g. sidebar h-72) */
  className?: string;
}

export function DormMiniMap({ latitude, longitude, buildingName, onViewMap, className }: DormMiniMapProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const { styleUrl } = useMapboxTheme();
  const styleUrlRef = useRef(styleUrl);
  styleUrlRef.current = styleUrl;

  useEffect(() => {
    const container = containerRef.current;
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!container || !token || typeof token !== 'string' || token.trim() === '') {
      return;
    }

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container,
      style: styleUrlRef.current,
      center: [longitude, latitude],
      zoom: 16,
      interactive: false,
      attributionControl: false,
    });

    // Disable scroll-zoom and rotation
    map.scrollZoom.disable();
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();

    const markerEl = document.createElement('div');
    markerEl.style.width = '24px';
    markerEl.style.height = '24px';
    markerEl.style.background = MARKER_COLOR;
    markerEl.style.borderRadius = '50%';
    markerEl.style.border = '2px solid white';
    markerEl.style.boxShadow = '0 2px 6px rgba(0,0,0,0.25)';
    markerEl.style.pointerEvents = 'none';

    const marker = new mapboxgl.Marker({ element: markerEl })
      .setLngLat([longitude, latitude])
      .addTo(map);

    mapRef.current = map;
    markerRef.current = marker;

    return () => {
      marker.remove();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [latitude, longitude]);

  // Swap style in place on theme change (marker survives setStyle).
  useEffect(() => {
    mapRef.current?.setStyle(styleUrl);
  }, [styleUrl]);

  const hasValidToken =
    import.meta.env.VITE_MAPBOX_TOKEN &&
    typeof import.meta.env.VITE_MAPBOX_TOKEN === 'string' &&
    import.meta.env.VITE_MAPBOX_TOKEN.trim() !== '';

  if (!hasValidToken) {
    return null;
  }

  return (
    <div className={cn('dorm-mini-map relative overflow-hidden rounded-xl border border-border shadow-raised bg-muted', className || 'w-[300px] h-[300px]')}>
      <div
        ref={containerRef}
        className="absolute inset-0 w-full h-full bg-background"
        aria-label={t('housing:explore.miniMap.ariaLabel', { building: buildingName })}
      />
      <Button
        onClick={onViewMap}
        size="sm"
        className="absolute bottom-3 left-1/2 -translate-x-1/2 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 shadow-overlay"
      >
        <Map className="w-3.5 h-3.5" />
        {t('housing:explore.miniMap.viewOnMap')}
      </Button>
    </div>
  );
}
