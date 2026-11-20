import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowBigUp, ArrowDown, ArrowUp, Command, CornerDownLeft, type LucideIcon } from 'lucide-react';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import { getShortcut, isApplePlatform, type ShortcutId, type ShortcutKey } from '@/lib/shortcuts';

const KEY_ICONS: Partial<Record<ShortcutKey, LucideIcon>> = {
  shift: ArrowBigUp,
  enter: CornerDownLeft,
  up: ArrowUp,
  down: ArrowDown,
};

/** One key as a keycap; glyph keys get a Lucide icon plus a spoken name. */
export function ShortcutKeyCap({ k, apple }: { k: ShortcutKey; apple: boolean }) {
  const { t } = useTranslation();
  if (k === 'mod') {
    return apple ? (
      <Kbd label={t('misc:shortcuts.keys.command')}>
        <Command aria-hidden />
      </Kbd>
    ) : (
      <Kbd>{t('misc:shortcuts.keys.ctrl')}</Kbd>
    );
  }
  const Icon = KEY_ICONS[k];
  if (Icon) {
    return (
      <Kbd label={t(`misc:shortcuts.keys.${k}`)}>
        <Icon aria-hidden />
      </Kbd>
    );
  }
  if (k === 'esc' || k === 'home' || k === 'end') return <Kbd>{t(`misc:shortcuts.keys.${k}`)}</Kbd>;
  return <Kbd>{k.toUpperCase()}</Kbd>;
}

/**
 * Every combo of a registered shortcut, rendered from the registry, so a hint can
 * never show a key the handler does not listen for. Alternatives are separated
 * by a quiet slash ("↑ / ↓"); keys within one combo sit side by side.
 */
export function ShortcutKeys({ id, className }: { id: ShortcutId; className?: string }) {
  const apple = isApplePlatform();
  const { combos } = getShortcut(id);
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {combos.map((combo, i) => (
        <Fragment key={combo.join('+')}>
          {i > 0 && (
            <span aria-hidden className="text-xs text-muted-foreground">
              /
            </span>
          )}
          <span className="inline-flex items-center gap-0.5">
            {combo.map((k) => (
              <ShortcutKeyCap key={k} k={k} apple={apple} />
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
