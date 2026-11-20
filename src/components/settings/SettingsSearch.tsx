import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CornerDownLeft, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { PROFILE_ROW_ICON_CHIP_CLASS, PROFILE_ROW_ICON_CLASS } from '@/lib/profileDialogClasses';
import {
  searchSettings,
  sectionMetaFor,
  type SettingsSearchEntry,
} from './settingsSearchIndex';

interface SettingsSearchProps {
  isAdmin: boolean;
  /** Superadmin gate for preview/dev-tool rows (Full app preview, Setup Mode, Replay). */
  isSuperAdmin: boolean;
  /** Called with the target section id + row slug when a result is chosen. */
  onNavigate: (section: SettingsSearchEntry['section'], slug: string) => void;
  className?: string;
  /** Slim, low-chrome pill (desktop top-of-page) vs the default bordered box. */
  sleek?: boolean;
}

/**
 * Filter-as-you-type search across every real Settings row (R8). Matches against
 * `settingsSearchIndex`; choosing a result asks the parent to jump to that
 * section and highlight the row. Presentation only - no state beyond the query.
 */
export function SettingsSearch({ isAdmin, isSuperAdmin, onNavigate, className, sleek }: SettingsSearchProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const results = useMemo(
    () => searchSettings(query, isAdmin, isSuperAdmin, (key) => t(key)),
    [query, isAdmin, isSuperAdmin, t],
  );
  const trimmed = query.trim();
  const hasQuery = trimmed.length > 0;

  const handlePick = (entry: SettingsSearchEntry) => {
    onNavigate(entry.section, entry.slug);
    setQuery('');
  };

  return (
    <div className={cn('relative', className)}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t('settings:search.ariaLabel')}
          placeholder={t('settings:search.placeholder')}
          autoComplete="off"
          className={cn(
            'pl-9 pr-9',
            sleek
              ? 'h-10 rounded-full border-transparent bg-muted/60 shadow-none transition-colors hover:bg-muted focus-visible:bg-card focus-visible:border-border focus-visible:ring-1 focus-visible:ring-malachite-600/40 focus-visible:ring-offset-0'
              : 'h-11 focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          )}
        />
        {hasQuery && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label={t('settings:search.clear')}
            className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      {hasQuery && (
        <div className="mt-2 overflow-hidden rounded-xl border border-border bg-card">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              {t('settings:search.empty', { query: trimmed })}
            </p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
              {results.map((entry) => {
                const sectionMeta = sectionMetaFor(entry.section);
                const Icon = sectionMeta?.icon;
                return (
                  <li key={entry.slug}>
                    <button
                      type="button"
                      onClick={() => handlePick(entry)}
                      className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-secondary/50 focus-visible:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-malachite-600"
                    >
                      <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
                        {Icon ? <Icon className={PROFILE_ROW_ICON_CLASS} aria-hidden /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium leading-tight text-foreground">
                          {t(entry.labelKey)}
                        </p>
                        <p className="mt-0.5 truncate text-xs leading-tight text-muted-foreground">
                          {sectionMeta ? t(sectionMeta.labelKey) : ''}
                        </p>
                      </div>
                      <CornerDownLeft className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default SettingsSearch;
