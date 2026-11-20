import { type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { fieldErrorProps, type ErrorReveal } from '@/lib/formCraft';
import { FieldError } from '@/components/ui/field-error';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PhotoGalleryField, type PhotoGalleryItem } from '@/components/marketplace/PhotoGalleryField';
import { PaymentMethodsField } from '@/components/marketplace/PaymentMethodsField';
import { ShowOnListingSection } from '@/components/marketplace/ShowOnListingSection';
import { ListingItemTagger } from '@/components/marketplace/ListingItemTagger';
import {
  MARKETPLACE_CONDITIONS,
  type ListingForm,
  type MarketplaceCategory,
} from '@/hooks/useMyListings';
import type { PostTypeFormSchema } from '@/lib/postTypes';

const FOCUS_RING = 'focus-visible:ring-malachite-600 focus-visible:ring-offset-2';

interface PostListingFieldsProps {
  form: ListingForm;
  setForm: Dispatch<SetStateAction<ListingForm>>;
  categories: readonly MarketplaceCategory[];
  sanitizePrice: (v: string) => string;
  hasListingItems: boolean;
  /** min available price derived from tagged items (multi-item listings). */
  derivedItemsPrice: number | null;
  isTinyPrice: boolean;
  galleryValue: PhotoGalleryItem[];
  onGalleryChange: (next: PhotoGalleryItem[]) => void;
  onGalleryReorder: (oldIndex: number, newIndex: number) => void;
  onGalleryRemove: (index: number) => void;
  /**
   * IPP-3 form craft. These fields are presentational and state lives in the
   * create page, so the reveal tracker and the derived messages are passed in
   * rather than re-deriving validation here — one source of truth for "is this
   * listing postable", shared with the footer's blocked-reason line.
   */
  reveal: ErrorReveal;
  titleError: string | null;
  priceError: string | null;
  /**
   * The picked post type's schema (src/lib/postTypes.ts). One flow, one set of
   * fields — which of them apply is DATA, so adding a type never means adding a
   * second composer. With the item schema every gate below is true, which is
   * byte-for-byte the form that shipped before subleases returned.
   */
  schema: PostTypeFormSchema;
  /** Rendered in place of category/condition/description when the schema asks
   *  for sublease terms. Composed by the create page so this stays presentational. */
  subleaseFields?: ReactNode;
  /** Rendered when the schema asks for the structured service block (task
   *  category, date, duration, location, notes). Same seam as subleaseFields. */
  serviceFields?: ReactNode;
  /**
   * Autofocus the title on mount. Defaults ON, for the desktop takeover the
   * field's own comment describes. Must be OFF in the mobile sheet: focusing a
   * field partway down a scroll container scrolls the sheet past the type picker
   * and Photos before the user has seen them, and raises the keyboard over the
   * pinned Post bar on open.
   */
  autoFocusTitle?: boolean;
}

/**
 * The stacked "Post an Item" form fields (photos → title → price → category →
 * condition → payment → description → inline "More details"). Presentational:
 * state lives in the create page. The page owns the two-column (form + live
 * preview) layout — this component is just the left-rail fields.
 */
export function PostListingFields({
  form,
  setForm,
  categories,
  sanitizePrice,
  hasListingItems,
  derivedItemsPrice,
  isTinyPrice,
  galleryValue,
  onGalleryChange,
  onGalleryReorder,
  onGalleryRemove,
  reveal,
  titleError,
  priceError,
  schema,
  subleaseFields,
  serviceFields,
  autoFocusTitle = true,
}: PostListingFieldsProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6 [&_input]:min-h-12 [&_textarea]:rounded-xl [&_[role=combobox]]:min-h-12">
      {/* A service post has nothing to photograph — "help me move a fridge" is a
          task, not an object — so the gallery is absent rather than empty. */}
      {schema.requiresPhotos && (
      <PhotoGalleryField
        idPrefix="mp-listing-post"
        value={galleryValue}
        onChange={onGalleryChange}
        onReorder={onGalleryReorder}
        onRemove={onGalleryRemove}
      />
      )}

      {schema.requiresTitle && (
      <div>
        <Label htmlFor="mp-listing-title">
          {t('housing:portal.marketplace.form.title')} <span className="text-destructive">*</span>
        </Label>
        <Input
          id="mp-listing-title"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          // Per-type placeholder: "e.g., Mini Fridge" is an object, and a
          // request for a hand with a task is not one.
          placeholder={t(
            schema.titleKeys?.placeholder ?? 'housing:portal.marketplace.form.titlePlaceholder',
          )}
          // First text field of the post flow. Photos come first visually but open
          // a picker, so the title is the first thing you can actually type.
          // IPP-3 item 5 asks for autofocus, and the a11y rule's objection doesn't
          // apply to the DESKTOP takeover: /marketplace/create fills the window and
          // its ONLY purpose is this form, so there is no content above to skip past
          // and no viewport to yank. Contrast Feedback, where the form is a section
          // of a longer page and autofocus is deliberately omitted.
          //
          // That premise stopped holding when the mobile composer became a sheet —
          // there IS content above now (the type picker, Photos) and there IS a
          // viewport to yank — so the caller turns it off there rather than the
          // justification quietly going stale.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocusTitle}
          {...reveal.blurProps('title')}
          {...fieldErrorProps('mp-listing-title', titleError)}
          className={cn('mt-2 border-border bg-card text-base shadow-none', FOCUS_RING)}
        />
        <FieldError fieldId="mp-listing-title" message={titleError} className="mt-1" />
      </div>
      )}

      {/* NO PAYMENTS. A service post is never priced: the field is not rendered,
          not disabled-and-shown, and the row stores price 0 (SERVICE_POST_PRICE,
          held there by a DB CHECK). DormCheck never tracks money between
          students, so there is nowhere here to state an amount. */}
      {schema.requiresPrice && (
      <div>
        <Label htmlFor="mp-listing-price">
          {schema.requiresSubleaseTerms
            ? t('marketplace:sublease.rent')
            : t('housing:portal.marketplace.form.price')}{' '}
          <span className="text-destructive">*</span>
        </Label>
        <Input
          id="mp-listing-price"
          type="text"
          inputMode="decimal"
          value={hasListingItems ? String(derivedItemsPrice ?? '') : form.price}
          onChange={(e) => setForm((f) => ({ ...f, price: sanitizePrice(e.target.value) }))}
          placeholder="0"
          disabled={hasListingItems}
          {...reveal.blurProps('price')}
          {...fieldErrorProps('mp-listing-price', priceError)}
          className={cn('mt-2 border-border bg-card text-base shadow-none', FOCUS_RING)}
        />
        <FieldError fieldId="mp-listing-price" message={priceError} className="mt-1" />
        {hasListingItems && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t('housing:portal.marketplace.form.priceFromItems', { price: derivedItemsPrice })}
          </p>
        )}
        {isTinyPrice && (
          <p className="mt-1 text-xs text-amber-700">
            {t('housing:portal.marketplace.form.tinyPriceWarning')}
          </p>
        )}
      </div>
      )}

      {subleaseFields}
      {serviceFields}

      {schema.showsItemFields && (
      <>
      <div>
        <Label htmlFor="mp-listing-category">{t('housing:portal.marketplace.form.category')}</Label>
        <Select
          value={form.category}
          onValueChange={(v) => setForm((f) => ({ ...f, category: v as MarketplaceCategory }))}
        >
          <SelectTrigger id="mp-listing-category" className={cn('mt-2 border-border bg-card text-base shadow-none', FOCUS_RING)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="mp-listing-condition">{t('housing:portal.marketplace.form.condition')}</Label>
        <Select
          value={form.condition ?? 'Good'}
          onValueChange={(v) => setForm((f) => ({ ...f, condition: v }))}
        >
          <SelectTrigger id="mp-listing-condition" className={cn('mt-2 border-border bg-card text-base shadow-none', FOCUS_RING)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MARKETPLACE_CONDITIONS.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      </>
      )}

      {schema.requiresPaymentMethods && (
        <PaymentMethodsField
          idPrefix="mp-payment"
          value={form.payment_methods ?? []}
          onChange={(payment_methods) => setForm((f) => ({ ...f, payment_methods }))}
        />
      )}

      {schema.showsDescription && (
      <div>
        <Label htmlFor="mp-listing-desc">
          {t('housing:portal.marketplace.form.description')} ({t('common:form.optional')})
        </Label>
        <Textarea
          id="mp-listing-desc"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder={t('housing:portal.marketplace.form.descriptionPlaceholder')}
          rows={3}
          className={cn('mt-2 min-h-28 border-border bg-card text-base shadow-none', FOCUS_RING)}
        />
      </div>
      )}

      {/* NO PAYMENTS. "Price negotiable" is a control for haggling over an
          amount, so on a type that has no price it is the product's hardest rule
          contradicted by its own UI — not merely stray copy. It comes off with
          the meetup spot (a service post already asks "Where") rather than being
          shown disabled, because a disabled negotiate toggle still says the
          conversation is about money. */}
      {schema.showsHandoffDetails && (
      <>
      <div className="border-t border-border pt-6">
        <p className="font-display text-lg font-semibold text-foreground">
          {t('housing:portal.marketplace.form.moreDetails')}
        </p>
      </div>

      <div className="flex min-h-12 items-center justify-between gap-4">
        <Label htmlFor="mp-price-negotiable">
          {t('housing:portal.marketplace.form.priceNegotiable')}
        </Label>
        <Switch
          id="mp-price-negotiable"
          checked={!!form.price_negotiable}
          onCheckedChange={(checked) => setForm((f) => ({ ...f, price_negotiable: checked }))}
          className="data-[state=checked]:bg-malachite-800"
        />
      </div>

      <div>
        <Label htmlFor="mp-listing-meetup">{t('housing:portal.marketplace.form.meetupLocation')}</Label>
        <Input
          id="mp-listing-meetup"
          value={form.meetup_location ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, meetup_location: e.target.value }))}
          placeholder={t('housing:portal.marketplace.form.meetupLocationPlaceholder')}
          className={cn('mt-2 border-border bg-card text-base shadow-none', FOCUS_RING)}
        />
      </div>
      </>
      )}

      {/* Item-only: tagging individually priced items on the photos is a
          multi-item SALE affordance. A room is one thing. */}
      {schema.showsItemFields && (
      <div>
        <Label>
          {t('housing:portal.marketplace.form.multipleItems')} ({t('common:form.optional')})
        </Label>
        <div className="mt-1">
          <ListingItemTagger
            photos={galleryValue}
            items={form.items ?? []}
            onChange={(items) => setForm((f) => ({ ...f, items }))}
          />
        </div>
      </div>
      )}

      <ShowOnListingSection
        values={{
          instagram_handle: form.instagram_handle ?? '',
          snapchat_handle: form.snapchat_handle ?? '',
          phone_number: form.phone_number ?? '',
          show_instagram: form.show_instagram ?? false,
          show_snapchat: form.show_snapchat ?? false,
          show_phone: form.show_phone ?? false,
        }}
        onChange={(v) =>
          setForm((f) => ({
            ...f,
            instagram_handle: v.instagram_handle,
            snapchat_handle: v.snapchat_handle,
            phone_number: v.phone_number,
            show_instagram: v.show_instagram,
            show_snapchat: v.show_snapchat,
            show_phone: v.show_phone,
          }))
        }
      />
    </div>
  );
}
