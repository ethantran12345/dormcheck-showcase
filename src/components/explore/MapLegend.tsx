import { useTranslation } from 'react-i18next';
import { PIN_COLORS, type PinCategory } from '@/lib/dormPins';
import { BUS_STOP_COLOR, BUS_LINE_MUTED, POGOH_TEAL } from '@/lib/transitMap';
import { cn } from '@/lib/utils';

const LEGEND_ORDER: PinCategory[] = ['first-year', 'upperclass'];
// Pin categories are kebab-case; the locale keys are camelCase.
const LEGEND_KEYS: Record<PinCategory, string> = {
  'first-year': 'firstYear',
  upperclass: 'upperclass',
};

// Mini teardrop pin with a white house glyph - mirrors the map housing markers.
function HousePinSwatch({ color }: { color: string }) {
  return (
    <svg width="11" height="14" viewBox="0 0 24 24" className="shrink-0" aria-hidden>
      <path
        d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
        fill={color}
        className="stroke-white"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M12 6.6 L16 9.8 L14.6 9.8 L14.6 12.4 L9.4 12.4 L9.4 9.8 L8 9.8 Z"
        className="fill-white"
        opacity="0.95"
      />
    </svg>
  );
}

/** Explains the map's pin-color encoding. Overlay on the explore split map and /map. */
export function MapLegend({
  className,
  showBusLines = false,
  showBusStops = false,
  showPogoh = false,
}: {
  className?: string;
  showBusLines?: boolean;
  showBusStops?: boolean;
  showPogoh?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        'pointer-events-none flex flex-wrap items-center gap-3 rounded-full border border-border bg-card/95 px-3 py-1.5 shadow-raised backdrop-blur',
        className,
      )}
      role="img"
      aria-label={t('housing:explore.map.legendAriaLabel')}
    >
      {LEGEND_ORDER.map((category) => (
        <span key={category} className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <HousePinSwatch color={PIN_COLORS[category]} />
          {t(`housing:explore.map.legend.${LEGEND_KEYS[category]}`)}
        </span>
      ))}
      {showBusLines && (
        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <span
            className="h-1 w-3.5 shrink-0 rounded-full"
            style={{ backgroundColor: BUS_LINE_MUTED }}
            aria-hidden
          />
          {t('housing:explore.map.legend.busRoute')}
        </span>
      )}
      {showBusStops && (
        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/80"
            style={{ backgroundColor: BUS_STOP_COLOR }}
            aria-hidden
          />
          {t('housing:explore.map.legend.busStop')}
        </span>
      )}
      {showPogoh && (
        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/80"
            style={{ backgroundColor: POGOH_TEAL }}
            aria-hidden
          />
          {t('housing:explore.map.legend.pogoh')}
        </span>
      )}
    </div>
  );
}
