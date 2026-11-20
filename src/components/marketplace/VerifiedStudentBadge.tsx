import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useUniversity } from '@/contexts/UniversityContext';
import { getUniversityById } from '@/config/universities';

interface VerifiedStudentBadgeProps {
  /** Badge label; overrides the resolved school label entirely. */
  label?: string;
  /**
   * The university of the person this badge describes — i.e. the SELLER's
   * `university_id`, not the viewer's.
   *
   * This prop exists because the marketplace is no longer single-tenant. It used
   * to be safe to read the school off `useUniversity()` (the viewer) on the
   * grounds that RLS guaranteed seller and viewer shared one; the shared
   * Pittsburgh group (migration 20260911000000) ends that guarantee, and the old
   * behaviour would label every CMU seller "Verified Pitt Student" to a Pitt
   * buyer — a false claim on the row that carries the product's central promise.
   *
   * Omit it only where the subject genuinely IS the viewer (e.g. their own
   * account screen).
   */
  universityId?: string | null;
  className?: string;
  iconClassName?: string;
}

/** Presentational trust badge for student-only marketplaces (no DB verified flag). */
export function VerifiedStudentBadge({
  label,
  universityId,
  className,
  iconClassName,
}: VerifiedStudentBadgeProps) {
  const { t } = useTranslation();
  const { university: viewerUniversity } = useUniversity();

  // Named subject first, viewer only as the unnamed-subject default.
  const subject = universityId ? getUniversityById(universityId) : viewerUniversity;
  // A school we cannot resolve (a tenant newer than this bundle) drops the school
  // word rather than borrowing the viewer's — a vaguer badge beats a wrong one.
  const resolvedLabel =
    label ??
    (subject
      ? t('marketplace:badge.verifiedStudent', { school: subject.shortName })
      : t('marketplace:badge.verifiedStudentGeneric'));

  return (
    <span
      className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground', className)}
    >
      <ShieldCheck className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground', iconClassName)} aria-hidden />
      {resolvedLabel}
    </span>
  );
}
