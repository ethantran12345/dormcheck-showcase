import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  POST_TYPE_DEFINITIONS,
  getPostTypeSchema,
  type PostType,
  type PostTypeDefinition,
} from '@/lib/postTypes';
import type { FeatureFlags } from '@/hooks/useFeatureFlags';

/**
 * The one entry point's type picker (PRD §5 Phase 2). Every post type is
 * composed in the SAME create flow — this picks which schema that flow branches
 * to, instead of routing to a second page.
 *
 * A type the school has not enabled, or one with no form schema yet, renders
 * disabled rather than hidden: the create flow is where a student has already
 * committed to posting, so naming what is coming costs one line and prevents
 * the "where do I put a sublease" question. The FEED does not do this — an
 * unavailable filter chip in a browse surface is just dead furniture.
 */
export function PostTypePicker({
  value,
  onChange,
  flags,
  className,
}: {
  value: PostType;
  onChange: (next: PostType) => void;
  flags: Pick<FeatureFlags, PostTypeDefinition['flag']>;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <div className={className}>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('marketplace:postType.pickerLabel')}
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('marketplace:postType.pickerLabel')}>
        {POST_TYPE_DEFINITIONS.map((def) => {
          const available = flags[def.flag] && getPostTypeSchema(def.id) !== null;
          const selected = value === def.id;
          return (
            <Button
              key={def.id}
              type="button"
              variant="outline"
              size="sm"
              haptic="selection"
              disabled={!available}
              aria-pressed={selected}
              title={available ? t(def.hintKey) : t('marketplace:postType.soonHint')}
              onClick={() => onChange(def.id)}
              className={cn(
                'h-8 shrink-0 gap-1.5 rounded-pill px-3 text-xs font-medium',
                selected
                  ? 'border-foreground bg-muted text-foreground'
                  : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
                !available && 'cursor-not-allowed opacity-50 hover:bg-card hover:text-muted-foreground',
              )}
            >
              {t(def.labelKey)}
              {!available && (
                <span className="rounded-pill bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('marketplace:postType.soon')}
                </span>
              )}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
