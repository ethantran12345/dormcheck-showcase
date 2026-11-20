import { useTranslation } from 'react-i18next';
import { CalendarDays, Clock, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The read side of a service post's structured fields.
 *
 * Rendered wherever a listing card or detail sheet would otherwise show a price.
 * There is no amount here and there is no place to put one: a service post's
 * price column is 0 by construction, and this component has no prop that could
 * carry a rate. See src/lib/servicePosts.ts.
 */
export function ServicePostSummary({
  serviceCategory,
  serviceDate,
  serviceDurationMinutes,
  serviceLocation,
  compact = false,
  className,
}: {
  serviceCategory?: string | null;
  serviceDate?: string | null;
  serviceDurationMinutes?: number | null;
  serviceLocation?: string | null;
  /** Card density: category + one detail, no icons row wrapping. */
  compact?: boolean;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  if (!serviceCategory) return null;

  const dateLabel = serviceDate
    ? new Date(`${serviceDate}T00:00:00`).toLocaleDateString(i18n.language, {
        month: 'short',
        day: 'numeric',
      })
    : null;
  const durationLabel = serviceDurationMinutes
    ? t(`marketplace:service.durations.${serviceDurationMinutes}`, { defaultValue: '' })
    : null;

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      <span className="rounded-pill bg-malachite-50 px-2 py-0.5 text-xs font-medium text-malachite-800 dark:bg-malachite-950 dark:text-malachite-200">
        {t(`marketplace:service.categories.${serviceCategory}`)}
      </span>
      {dateLabel && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
          {dateLabel}
        </span>
      )}
      {!compact && durationLabel && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          {durationLabel}
        </span>
      )}
      {!compact && serviceLocation && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
          {serviceLocation}
        </span>
      )}
    </div>
  );
}
