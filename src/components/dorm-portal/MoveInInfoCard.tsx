import { CalendarCheck, MapPin, Clock, DoorOpen, ShoppingCart, Navigation, Info } from 'lucide-react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import type { Dorm } from '@/types';
import { parseIsoDateLocal, countdownLabel } from '@/lib/dateUtils';
import { directionsUrl } from '@/lib/maps';

interface MoveInInfoCardProps {
  dorm: Pick<
    Dorm,
    | 'moveInDate'
    | 'moveInParkingLot'
    | 'moveInTimeWindow'
    | 'moveInEntrance'
    | 'moveInCartLocation'
    | 'moveInNotes'
  >;
}

function nonEmpty(v: string | null | undefined): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

export function MoveInInfoCard({ dorm }: MoveInInfoCardProps) {
  const { t } = useTranslation();
  const moveInDate = parseIsoDateLocal(dorm.moveInDate ?? null);
  const hasParking = nonEmpty(dorm.moveInParkingLot);
  const hasWindow = nonEmpty(dorm.moveInTimeWindow);
  const hasEntrance = nonEmpty(dorm.moveInEntrance);
  const hasCart = nonEmpty(dorm.moveInCartLocation);
  const hasNotes = nonEmpty(dorm.moveInNotes);

  const hasAny =
    moveInDate !== null || hasParking || hasWindow || hasEntrance || hasCart || hasNotes;

  if (!hasAny) return null;

  const rows: { icon: React.ReactNode; label: string; value: string; href?: string }[] = [];
  if (hasParking) {
    const lot = dorm.moveInParkingLot!.trim();
    rows.push({
      icon: <MapPin className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />,
      label: t('housing:portal.moveIn.parkingLabel'),
      value: lot,
      // Tap-to-navigate to the move-in lot (a "parking pin").
      href: directionsUrl({ query: `${lot}, University of Pittsburgh, Pittsburgh, PA` }),
    });
  }
  if (hasWindow) {
    rows.push({
      icon: <Clock className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />,
      label: t('housing:portal.moveIn.windowLabel'),
      value: dorm.moveInTimeWindow!.trim(),
    });
  }
  if (hasEntrance) {
    rows.push({
      icon: <DoorOpen className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />,
      label: t('housing:portal.moveIn.entranceLabel'),
      value: dorm.moveInEntrance!.trim(),
    });
  }
  if (hasCart) {
    rows.push({
      icon: <ShoppingCart className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />,
      label: t('housing:portal.moveIn.cartsLabel'),
      value: dorm.moveInCartLocation!.trim(),
    });
  }

  return (
    <section
      aria-label={t('housing:portal.moveIn.ariaLabel')}
      className="overflow-hidden rounded-xl border border-border bg-card shadow-raised"
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <CalendarCheck className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">{t('housing:portal.moveIn.heading')}</h2>
      </div>

      <div className="p-5">
        {moveInDate && (
          <div className="mb-5 rounded-lg bg-muted px-4 py-3">
            <div className="text-2xl font-bold leading-tight text-foreground">
              {format(moveInDate, 'MMMM d, yyyy')}
            </div>
            <div className="mt-0.5 text-sm font-medium text-muted-foreground">
              {countdownLabel(moveInDate)}
            </div>
          </div>
        )}

        {rows.length > 0 && (
          <ul className="space-y-3">
            {rows.map((row) => (
              <li key={row.label} className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  {row.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted-foreground">{row.label}</div>
                  <div className="text-sm font-medium text-foreground break-words">{row.value}</div>
                  {row.href && (
                    <a
                      href={row.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                    >
                      <Navigation className="h-3 w-3" aria-hidden />
                      {t('housing:portal.moveIn.directionsButton')}
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {hasNotes && (
          <div className="mt-4 flex gap-2.5 rounded-lg border border-border bg-muted/50 p-3.5">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
              {dorm.moveInNotes!.trim()}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
