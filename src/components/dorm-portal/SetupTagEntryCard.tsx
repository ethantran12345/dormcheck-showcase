import { useEffect, useRef } from 'react';
import { X, MapPin, Clipboard } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface SetupTagEntryCardProps {
  /** Tap point as 0-1 fractions of the photo. */
  x: number;
  y: number;
  photoIndex: number;
  isEditing: boolean;
  productName: string;
  productLink: string;
  onProductNameChange: (value: string) => void;
  onProductLinkChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  /** Removes the tag when editing, otherwise cancels (mirrors the X control). */
  onRemoveOrCancel: () => void;
}

/**
 * Floating product-tag entry card anchored at the tap point, over the photo.
 * Desktop/tablet only — mobile uses a bottom sheet. Clamps to the photo edges
 * using the same thresholds as ProductTagMarker so it never spills off-frame.
 */
export function SetupTagEntryCard({
  x,
  y,
  photoIndex,
  isEditing,
  productName,
  productLink,
  onProductNameChange,
  onProductLinkChange,
  onSave,
  onCancel,
  onRemoveOrCancel,
}: SetupTagEntryCardProps) {
  const { t } = useTranslation();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  // Autofocus the name input when the card opens (fresh placement only, so we
  // don't yank focus while the user drags the dot on an existing tag).
  useEffect(() => {
    if (!isEditing) nameInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape cancels. A document listener keeps this working even while the drag
  // dot (outside this card) has focus, and avoids a keydown handler on the
  // non-interactive dialog container.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancelRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const xPct = x * 100;
  const yPct = y * 100;

  // Mirror ProductTagMarker's edge thresholds (see ProductTagMarker.tsx).
  const alignLeft = xPct < 20;
  const alignRight = xPct > 80;
  const placeBelow = yPct < 50;

  const translateX = alignLeft ? '0%' : alignRight ? '-100%' : '-50%';
  const translateY = placeBelow ? '16px' : 'calc(-100% - 16px)';

  const canSave = Boolean(productName.trim() && productLink.trim());

  return (
    <div
      role="dialog"
      aria-label={t('housing:portal.setupTag.ariaLabel', { number: photoIndex + 1 })}
      className="pointer-events-auto absolute z-30 hidden w-[280px] max-w-[calc(100%-1rem)] space-y-4 rounded-xl border border-border bg-card p-4 shadow-overlay sm:block"
      style={{
        left: `${xPct}%`,
        top: `${yPct}%`,
        transform: `translate(${translateX}, ${translateY})`,
      }}
    >
      <button
        type="button"
        onClick={onRemoveOrCancel}
        className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground touch-manipulation"
        aria-label={t(isEditing ? 'housing:portal.setupTag.removeTag' : 'common:actions.cancel')}
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-center gap-2 pr-10">
        <MapPin className="h-5 w-5 shrink-0 text-primary" />
        <span className="font-semibold text-foreground">{t('housing:portal.setupTag.tagOnPhoto', { number: photoIndex + 1 })}</span>
      </div>
      <Input
        ref={nameInputRef}
        value={productName}
        onChange={(e) => onProductNameChange(e.target.value)}
        placeholder={t('housing:portal.setupTag.productNamePlaceholder')}
        className="h-12 rounded-xl"
      />
      <div className="flex gap-2">
        <Input
          value={productLink}
          onChange={(e) => onProductLinkChange(e.target.value)}
          placeholder={t('housing:portal.setupTag.linkPlaceholder')}
          className="h-12 min-w-0 flex-1 rounded-xl"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              const text = await navigator.clipboard.readText();
              if (text?.trim()) onProductLinkChange(text.trim());
              else toast.error(t('housing:portal.setupTag.clipboardEmpty'));
            } catch {
              toast.error(t('housing:portal.setupTag.clipboardError'));
            }
          }}
          className="h-12 min-h-12 shrink-0 rounded-xl px-3"
          aria-label={t('housing:portal.setupTag.pasteClipboard')}
        >
          <Clipboard className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          className="h-12 min-h-12 flex-1 rounded-full px-4"
        >
          {t('common:actions.cancel')}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onSave}
          disabled={!canSave}
          className={cn(
            'h-12 min-h-12 flex-1 rounded-full px-4 font-semibold text-white',
            'bg-indigo-600 hover:bg-indigo-700 disabled:bg-muted disabled:text-muted-foreground',
          )}
        >
          {t('housing:portal.setupTag.saveTag')}
        </Button>
      </div>
    </div>
  );
}
