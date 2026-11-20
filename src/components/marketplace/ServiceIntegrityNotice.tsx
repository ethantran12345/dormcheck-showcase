import { useTranslation } from 'react-i18next';
import { BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldError } from '@/components/ui/field-error';

/**
 * The academic-integrity terms that ride along with a tutoring post.
 *
 * Tutoring is the one category whose ordinary, legitimate use shades directly
 * into academic dishonesty — "help me with my essay" and "write my essay" are
 * the same sentence with one word changed. Every other category fails safe: a
 * ride is a ride. So this is the one category that states the line at the point
 * of posting AND at the point of reading, rather than only in the Terms page
 * nobody opens mid-flow.
 *
 * Two modes, one copy block, deliberately: the poster and the student
 * considering the post must be reading the same words. `interactive` adds the
 * acknowledgement the create flow requires before submit; the read-only form is
 * what renders on the listing itself.
 *
 * Copy lives in `marketplace:service.integrity.*` and is mirrored by Terms §5a
 * (src/pages/marketing/Terms.tsx) — change one and change both.
 */
export function ServiceIntegrityNotice({
  interactive = false,
  acknowledged = false,
  onAcknowledgedChange,
  error,
  className,
}: {
  interactive?: boolean;
  acknowledged?: boolean;
  onAcknowledgedChange?: (next: boolean) => void;
  error?: string | null;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        'rounded-card border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-900',
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <BookOpen
          className="mt-0.5 h-4 w-4 shrink-0 text-malachite-800 dark:text-malachite-300"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {t('marketplace:service.integrity.heading')}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {t('marketplace:service.integrity.body')}
          </p>
        </div>
      </div>

      {interactive && (
        <div className="mt-3 flex items-start gap-2.5 pl-6">
          <Checkbox
            id="mp-service-integrity-ack"
            checked={acknowledged}
            onCheckedChange={(v) => onAcknowledgedChange?.(v === true)}
            aria-describedby={error ? 'mp-service-integrity-ack-error' : undefined}
            aria-invalid={error ? true : undefined}
            className="mt-0.5"
          />
          <label
            htmlFor="mp-service-integrity-ack"
            className="cursor-pointer text-sm leading-relaxed text-foreground"
          >
            {t('marketplace:service.integrity.ack')}
          </label>
        </div>
      )}
      {interactive && (
        <FieldError fieldId="mp-service-integrity-ack" message={error ?? null} className="mt-1" />
      )}
    </div>
  );
}
