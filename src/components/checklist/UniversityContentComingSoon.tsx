import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { useUniversity } from '@/contexts/UniversityContext';

/**
 * Graceful empty state for university-scoped guide content (move-in journey,
 * move-out ladder, campus resources) that hasn't been authored for the current
 * user's school yet. Keeps CMU (and future tenants) from seeing Pitt logistics
 * while their curated content is still in progress.
 */
export function UniversityContentComingSoon({
  title,
  body,
}: {
  title: string;
  /** Optional override; defaults to a school-named coming-soon line. */
  body?: string;
}) {
  const { t } = useTranslation();
  const { university } = useUniversity();
  return (
    <div className="rounded-xl border border-border bg-card p-6 text-center shadow-raised">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
        <Sparkles className="h-5 w-5 text-primary" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        {body ?? t("checklist:comingSoon.defaultBody", { school: university.shortName })}
      </p>
    </div>
  );
}
