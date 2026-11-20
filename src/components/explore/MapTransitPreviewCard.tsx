import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { BusStop, PogohStation } from '@/components/MapView';
import { cn } from '@/lib/utils';

const PITT_BLUE = '#1e3a5f';
const CARD_WIDTH_PX = 280;

export type MapTransitSelection =
  | { type: 'bus'; stop: BusStop }
  | { type: 'pogoh'; station: PogohStation };

const formatDirection = (dir: string | null | undefined): string => {
  if (!dir || !String(dir).trim()) return '';
  const s = String(dir).toUpperCase();
  if (s.includes('IB')) return 'Inbound';
  if (s.includes('OB')) return 'Outbound';
  return String(dir);
};

interface MapTransitPreviewCardProps {
  selection: MapTransitSelection;
  onDismiss: () => void;
  className?: string;
  style?: CSSProperties;
}

export function MapTransitPreviewCard({
  selection,
  onDismiss,
  className,
  style,
}: MapTransitPreviewCardProps) {
  const { t } = useTranslation();
  const isBus = selection.type === 'bus';
  const stop = isBus ? selection.stop : null;
  const station = !isBus ? selection.station : null;

  const routeItems = stop?.routes
    ? String(stop.routes)
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean)
    : [];

  const direction = stop ? formatDirection(stop.direction) : '';

  return (
    <div
      className={cn('pointer-events-auto flex justify-center', className)}
      style={style}
      aria-label={isBus ? t('housing:explore.map.transit.busStopPreview') : t('housing:explore.map.transit.pogohDockPreview')}
    >
      <div
        className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-overlay"
        style={{ width: CARD_WIDTH_PX }}
      >
        <div className="px-3 py-3 pr-10">
          <p className="truncate text-sm font-semibold text-foreground">
            {isBus ? (stop?.stop_name ?? t('housing:explore.map.transit.busStop')) : (station?.Name ?? t('housing:explore.map.transit.pogohStation'))}
          </p>

          {isBus && direction ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{direction}</p>
          ) : null}

          {isBus ? (
            <>
              <div className="mt-2 flex flex-wrap gap-1">
                {routeItems.length > 0 ? (
                  routeItems.map((route) => (
                    <span
                      key={route}
                      className="rounded px-1.5 py-0.5 text-[11px] font-bold text-white"
                      style={{ backgroundColor: PITT_BLUE }}
                    >
                      {route}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">{t('housing:explore.map.transit.noRoutesListed')}</span>
                )}
              </div>
            </>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('housing:explore.map.transit.totalDocks')}: {station?.['Total Docks'] ?? ' - '}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-card/95 text-muted-foreground shadow-raised ring-1 ring-border hover:text-foreground"
          aria-label={t('common:actions.dismiss')}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
