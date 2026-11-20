import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ProductTagMarker } from '@/components/dorm-portal/ProductTagMarker';
import type { PhotoGalleryItem } from '@/components/marketplace/PhotoGalleryField';
import { MAX_LISTING_ITEMS, type DraftListingItem } from '@/lib/listingItems';
import { checkProhibitedContent } from '@/lib/prohibitedContent';
import { safeImageSrc } from '@/lib/sanitize';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type ListingItemTaggerProps = {
  photos: PhotoGalleryItem[];
  items: DraftListingItem[];
  onChange: (items: DraftListingItem[]) => void;
  disabled?: boolean;
};

type ItemFormState = {
  /** Index into items when editing, null when adding. */
  editIndex: number | null;
  x: number | null;
  y: number | null;
  photoIndex: number;
  name: string;
  price: string;
};

const sanitizePrice = (v: string) => {
  if (v === '') return '';
  let s = v.replace(/[^0-9.]/g, '');
  const idx = s.indexOf('.');
  if (idx !== -1) {
    const before = s.slice(0, idx);
    const after = s.slice(idx + 1).replace(/\./g, '').slice(0, 2);
    s = before + '.' + after;
  }
  return s;
};

/**
 * Tag individually priced items on the listing photos (same interaction as the
 * room-gallery "shop this room" tags): tap the photo to place a tag, or add an
 * item without a tag. Each item gets its own name and price and can later be
 * marked sold on its own.
 */
export function ListingItemTagger({ photos, items, onChange, disabled }: ListingItemTaggerProps) {
  const { t } = useTranslation();
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [form, setForm] = useState<ItemFormState | null>(null);
  const fileUrlCacheRef = useRef<Map<File, string>>(new Map());

  // Object URLs for not-yet-uploaded File photos (mirrors PhotoGalleryField).
  const photoUrls = useMemo(() => {
    const cache = fileUrlCacheRef.current;
    return photos.map((p) => {
      if (p.type === 'url') return safeImageSrc(p.url) || '/placeholder.svg';
      if (!cache.has(p.file)) cache.set(p.file, URL.createObjectURL(p.file));
      return cache.get(p.file)!;
    });
  }, [photos]);

  useEffect(() => {
    const cache = fileUrlCacheRef.current;
    const current = new Set(photos.filter((p): p is { type: 'file'; file: File } => p.type === 'file').map((p) => p.file));
    cache.forEach((url, file) => {
      if (!current.has(file)) {
        URL.revokeObjectURL(url);
        cache.delete(file);
      }
    });
  }, [photos]);

  useEffect(() => {
    const cache = fileUrlCacheRef.current;
    return () => {
      cache.forEach((url) => URL.revokeObjectURL(url));
      cache.clear();
    };
  }, []);

  useEffect(() => {
    if (activePhotoIndex >= photos.length) setActivePhotoIndex(0);
  }, [photos.length, activePhotoIndex]);

  const placeTag = (x: number, y: number) => {
    if (disabled) return;
    if (items.length >= MAX_LISTING_ITEMS && form?.editIndex == null) {
      toast.error(t('marketplace:tagger.toast.maxItems', { max: MAX_LISTING_ITEMS }));
      return;
    }
    setForm((prev) =>
      prev?.editIndex != null
        ? { ...prev, x, y, photoIndex: activePhotoIndex }
        : { editIndex: null, x, y, photoIndex: activePhotoIndex, name: '', price: '' },
    );
  };

  const handleImageClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Keyboard "clicks" (Enter/Space) carry no coordinates; place at center.
    if (e.detail === 0) {
      placeTag(0.5, 0.5);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    placeTag(x, y);
  };

  const openEdit = (index: number) => {
    const item = items[index];
    if (!item) return;
    setForm({
      editIndex: index,
      x: item.x,
      y: item.y,
      photoIndex: item.photo_index,
      name: item.name,
      price: String(item.price),
    });
    if (item.x !== null) setActivePhotoIndex(item.photo_index);
  };

  const openAddWithoutTag = () => {
    if (items.length >= MAX_LISTING_ITEMS) {
      toast.error(t('marketplace:tagger.toast.maxItems', { max: MAX_LISTING_ITEMS }));
      return;
    }
    setForm({ editIndex: null, x: null, y: null, photoIndex: 0, name: '', price: '' });
  };

  const saveForm = () => {
    if (!form) return;
    const name = form.name.trim();
    const price = parseFloat(form.price);
    if (!name) {
      toast.error(t('marketplace:tagger.toast.nameRequired'));
      return;
    }
    if (Number.isNaN(price) || price < 0) {
      toast.error(t('marketplace:tagger.toast.priceInvalid'));
      return;
    }
    const contentCheck = checkProhibitedContent(name);
    if (contentCheck.blocked) {
      toast.error(t('marketplace:tagger.toast.prohibited', { category: contentCheck.category }));
      return;
    }
    const next: DraftListingItem = {
      ...(form.editIndex != null ? { id: items[form.editIndex]?.id } : {}),
      name,
      price,
      status: form.editIndex != null ? items[form.editIndex]?.status ?? 'available' : 'available',
      x: form.x,
      y: form.y,
      photo_index: form.x !== null ? form.photoIndex : 0,
    };
    onChange(
      form.editIndex != null
        ? items.map((it, i) => (i === form.editIndex ? next : it))
        : [...items, next],
    );
    setForm(null);
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
    if (form?.editIndex === index) setForm(null);
  };

  const activePhotoItems = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.x !== null && item.photo_index === activePhotoIndex);

  const hasPhotos = photos.length > 0;

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-3">
      <p className="text-xs text-muted-foreground">
        {t('marketplace:tagger.intro')}
      </p>

      {hasPhotos ? (
        <>
          <div className="relative overflow-hidden rounded-lg bg-black/5">
            <img
              src={photoUrls[activePhotoIndex]}
              alt=""
              className="w-full max-h-80 object-contain"
              onError={(e) => {
                e.currentTarget.src = '/placeholder.svg';
              }}
            />
            {/* Transparent tag-placement surface over the image; keyboard fallback
                places a tag at the center that can be refined with a pointer. */}
            <button
              type="button"
              disabled={disabled}
              onClick={handleImageClick}
              className={cn('absolute inset-0 z-0 w-full', !disabled && 'cursor-crosshair')}
              aria-label={t('marketplace:tagger.tagImageAria', { number: activePhotoIndex + 1 })}
            />
            {activePhotoItems.map(({ item, index }) => (
              <ProductTagMarker
                key={`tag-${index}`}
                xPct={(item.x ?? 0) * 100}
                yPct={(item.y ?? 0) * 100}
                label={`${item.name} · $${item.price}`}
                className={item.status === 'sold' ? 'opacity-50' : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  openEdit(index);
                }}
                ariaLabel={t('marketplace:tagger.editItemAria', { name: item.name })}
              />
            ))}
            {form && form.x !== null && form.photoIndex === activePhotoIndex && (
              <span
                className="absolute z-20 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-background shadow-raised animate-pulse"
                style={{ left: `${form.x * 100}%`, top: `${form.y! * 100}%` }}
                aria-hidden
              />
            )}
          </div>

          {photos.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {photoUrls.map((url, i) => (
                <button
                  key={`thumb-${i}`}
                  type="button"
                  onClick={() => setActivePhotoIndex(i)}
                  className={cn(
                    'shrink-0 w-14 h-14 rounded-md overflow-hidden border-2',
                    i === activePhotoIndex ? 'border-foreground' : 'border-transparent opacity-70',
                  )}
                  aria-label={t('marketplace:tagger.tagPhotoAria', { number: i + 1 })}
                >
                  <img src={url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t('marketplace:tagger.noPhotos')}</p>
      )}

      {form && (
        <div className="rounded-lg border border-border bg-card p-3 space-y-3">
          <p className="text-sm font-medium">
            {form.editIndex != null
              ? t('marketplace:tagger.form.editTitle')
              : form.x !== null
                ? t('marketplace:tagger.form.newTaggedTitle')
                : t('marketplace:tagger.form.newUntaggedTitle')}
          </p>
          {form.x === null && hasPhotos && (
            <p className="text-xs text-muted-foreground">{t('marketplace:tagger.form.placeTagTip')}</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="item-tag-name">{t('marketplace:tagger.form.nameLabel')}</Label>
              <Input
                id="item-tag-name"
                value={form.name}
                onChange={(e) => setForm((f) => (f ? { ...f, name: e.target.value } : f))}
                placeholder={t('marketplace:tagger.form.namePlaceholder')}
                maxLength={80}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="item-tag-price">{t('marketplace:edit.priceLabel')}</Label>
              <Input
                id="item-tag-price"
                type="text"
                inputMode="decimal"
                value={form.price}
                onChange={(e) => setForm((f) => (f ? { ...f, price: sanitizePrice(e.target.value) } : f))}
                placeholder="0"
                className="mt-1"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => setForm(null)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={saveForm}
              // KEEP: primary CTA of the tagger (save tag); malachite-800 for AA on light
              className="bg-malachite-800 hover:bg-malachite-900 text-white"
            >
              {form.editIndex != null ? t('marketplace:tagger.form.saveItem') : t('marketplace:tagger.form.addItem')}
            </Button>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((item, index) => (
            <li
              key={item.id ?? `draft-${index}`}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
            >
              <Tag className={cn('w-3.5 h-3.5 shrink-0', item.x !== null ? 'text-foreground' : 'text-muted-foreground')} aria-hidden />
              <span className={cn('flex-1 min-w-0 truncate text-sm', item.status === 'sold' && 'text-muted-foreground line-through')}>
                {item.name}
              </span>
              {item.status === 'sold' && (
                <Badge variant="secondary" className="shrink-0 text-[10px]">{t('marketplace:status.sold')}</Badge>
              )}
              <span className="shrink-0 text-sm font-medium">${item.price}</span>
              <button
                type="button"
                onClick={() => openEdit(index)}
                disabled={disabled}
                className="shrink-0 p-1.5 text-muted-foreground hover:text-foreground"
                aria-label={t('marketplace:tagger.editAria', { name: item.name })}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => removeItem(index)}
                disabled={disabled}
                className="shrink-0 p-1.5 text-muted-foreground hover:text-destructive"
                aria-label={t('marketplace:tagger.removeAria', { name: item.name })}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={openAddWithoutTag}
          disabled={disabled || items.length >= MAX_LISTING_ITEMS}
          className="gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          {t('marketplace:tagger.addWithoutTag')}
        </Button>
        <span className="text-xs text-muted-foreground">
          {t('marketplace:tagger.itemCounter', { n: items.length, max: MAX_LISTING_ITEMS })}
        </span>
      </div>
    </div>
  );
}
