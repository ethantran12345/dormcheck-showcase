import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ShortcutKeys } from '@/components/shortcuts/ShortcutKeys';
import { shortcutsForSheet } from '@/lib/shortcuts';

/**
 * The "?" sheet: what the keyboard actually does, read straight from the
 * registry (src/lib/shortcuts.ts), so it cannot list a key that does nothing.
 * Desktop only; the provider never opens it on touch or native. A Radix Dialog,
 * so focus is trapped while open and returns to the opener on close.
 */
export function ShortcutsSheet({
  open,
  onOpenChange,
  isAdmin,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdmin: boolean;
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const { t } = useTranslation();
  const groups = shortcutsForSheet(isAdmin);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader className="space-y-1 border-b border-border px-6 pb-4 pt-6 text-left">
          <DialogTitle className="font-display text-lg font-semibold">{t('misc:shortcuts.title')}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{t('misc:shortcuts.description')}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[min(70vh,560px)] space-y-5 overflow-y-auto px-6 py-5">
          {groups.map(({ group, items }) => (
            <section key={group} aria-labelledby={`shortcuts-${group}`}>
              <h3 id={`shortcuts-${group}`} className="mb-2 text-xs font-semibold text-muted-foreground">
                {t(`misc:shortcuts.groups.${group}`)}
              </h3>
              <dl className="divide-y divide-border">
                {items.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-4 py-2">
                    <dt className="text-sm text-foreground">{t(s.labelKey)}</dt>
                    <dd className="shrink-0">
                      <ShortcutKeys id={s.id} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
