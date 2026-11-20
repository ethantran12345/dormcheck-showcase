import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Dorm } from '@/types';

// Pitt's Housing Portal (StarRez) - where the application actually happens.
const STARREZ_PORTAL = 'https://pitt.starrezhousing.com/StarRezPortalX';

/**
 * "Apply to this hall" action, surfaced right on the dorm page so a student can act
 * without leaving the hall. Extension, not replacement: the button opens Pitt's
 * Housing Portal (StarRez) where the application actually happens.
 */
export function ApplyToHallCard({ dorm }: { dorm: Pick<Dorm, 'name' | 'audienceType' | 'housingType'> }) {
  const { t } = useTranslation();

  return (
    <section
      aria-label={t('housing:portal.apply.ariaLabel', { dorm: dorm.name })}
      className="overflow-hidden rounded-xl border border-border bg-card shadow-raised"
    >
      <div className="p-5">
        <h2 className="text-lg font-semibold text-foreground">{t('housing:portal.apply.heading', { dorm: dorm.name })}</h2>
        <p className="mt-1 text-sm text-foreground">
          {t('housing:portal.apply.description')}
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <a
            href={STARREZ_PORTAL}
            target="_blank"
            rel="noopener noreferrer"
            // KEEP: primary CTA of the overview tab (apply via StarRez)
            className="inline-flex items-center justify-center gap-2 rounded-full bg-malachite-800 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-malachite-900"
          >
            {t('housing:portal.apply.buttonText')}
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}
