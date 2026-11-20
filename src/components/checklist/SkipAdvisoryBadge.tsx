import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { SkipAdvisory } from '@/data/skipAdvisories';
import { Button } from '@/components/ui/button';

type Props = { advisory: SkipAdvisory };

export function SkipAdvisoryBadge({ advisory }: Props) {
  const { t } = useTranslation();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={t("checklist:skip.readAdviceAbout", { item: advisory.name })}
          // [&_svg]:size-3.5 keeps the 14px warning glyph off the base [&_svg]:size-4;
          // the amber tint already lives on the button so the glyph inherits it.
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded p-0 text-amber-500 transition-colors hover:bg-transparent hover:text-amber-600 [&_svg]:size-3.5"
          onClick={(e) => e.stopPropagation()}
        >
          <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-64 p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-600">
          {t("checklist:skip.readFirst")}
        </p>
        <p className="mb-1 text-sm font-medium text-foreground">{advisory.name}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{advisory.reason}</p>
      </PopoverContent>
    </Popover>
  );
}
