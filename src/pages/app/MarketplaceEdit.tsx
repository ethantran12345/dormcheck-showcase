import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate, useLocation } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ShowOnListingSection } from '@/components/marketplace/ShowOnListingSection';
import { PaymentMethodsField } from '@/components/marketplace/PaymentMethodsField';
import { normalizePaymentMethods, type MarketplacePaymentMethod } from '@/lib/marketplacePaymentMethods';
import { PhotoGalleryField, type PhotoGalleryItem } from '@/components/marketplace/PhotoGalleryField';
import { ListingItemTagger } from '@/components/marketplace/ListingItemTagger';
import {
  minAvailablePrice,
  remapItemPhotoIndexes,
  remapItemsAfterPhotoDelete,
  type DraftListingItem,
} from '@/lib/listingItems';
import { supabase } from '@/integrations/supabase/client';
import { withListingContact } from '@/lib/marketplaceContact';
import { safeImageSrc } from '@/lib/sanitize';
import { useAuth } from '@/hooks/useAuth';
import {
  useMyListings,
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_CONDITIONS,
  type MarketplaceCategory,
  type ListingForm,
} from '@/hooks/useMyListings';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  type GeneralMarketplacePreviewData,
  MarketplaceListingPreviewBlock,
} from '@/components/marketplace/FormLivePreview';
import { PageContainer } from '@/components/ui/page-container';
import { SubleaseFields } from '@/components/marketplace/SubleaseFields';
import {
  firstUnmetSubleaseTerm,
  geocodeSubleaseAddress,
  subleaseTitle,
} from '@/lib/subleases';
import { useErrorReveal } from '@/lib/formCraft';
import { useUniversity } from '@/contexts/UniversityContext';

/**
 * The non-sublease half of `ListingForm` is required by its type but meaningless
 * on a sublease, so it is fixed here once rather than restated at every setState.
 * Only the sublease columns below are ever edited on this path.
 */
const EMPTY_SUBLEASE_FORM: ListingForm = {
  title: '',
  description: '',
  price: '',
  category: 'Other',
  imageFiles: [],
  post_type: 'sublease',
};

/** The sublease columns as they come back from the row, before form shaping. */
type SubleaseRowColumns = Partial<
  Pick<
    ListingForm,
    | 'building_id'
    | 'building_name'
    | 'latitude'
    | 'longitude'
    | 'sublease_start'
    | 'sublease_end'
    | 'included_utilities'
    | 'is_furnished'
    | 'has_parking'
    | 'gender_preference'
    | 'house_rules'
    | 'additional_rules'
  >
>;

export interface MarketplaceEditFormProps {
  listingId: string;
  onSuccess: () => void;
  onClose: () => void;
  variant: 'page' | 'modal';
}

export function MarketplaceEditForm({
  listingId,
  onSuccess,
  onClose,
  variant,
}: MarketplaceEditFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { updateListing } = useMyListings(user?.id);
  const id = listingId;

  const [listingImages, setListingImages] = useState<PhotoGalleryItem[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState<MarketplaceCategory>('Other');
  const [condition, setCondition] = useState('Good');
  const [meetupLocation, setMeetupLocation] = useState('');
  const [showInstagram, setShowInstagram] = useState(false);
  const [showSnapchat, setShowSnapchat] = useState(false);
  const [priceNegotiable, setPriceNegotiable] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<MarketplacePaymentMethod[]>([]);
  const [instagramHandle, setInstagramHandle] = useState('');
  const [snapchatHandle, setSnapchatHandle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editFileCoverUrl, setEditFileCoverUrl] = useState<string | null>(null);
  const [items, setItems] = useState<DraftListingItem[]>([]);
  /**
   * The sublease half of the form, held as one `ListingForm` slice because that
   * is the shape `SubleaseFields` and `firstUnmetSubleaseTerm` already speak.
   * Kept separate from the scalar item state above rather than exploding into
   * eleven more `useState`s that only one post type ever reads.
   */
  const [subleaseForm, setSubleaseForm] = useState<ListingForm>(EMPTY_SUBLEASE_FORM);
  const reveal = useErrorReveal();
  const { university } = useUniversity();

  const { data: listing, isLoading, error } = useQuery({
    queryKey: ['marketplace_listing', id, user?.id],
    queryFn: async () => {
      if (!id || !user?.id) return null;
      const { data, error: err } = await supabase
        .from('marketplace_listings')
        .select('id, user_id, title, description, price, category, image_urls, created_at, condition, meetup_location, price_negotiable, payment_methods, show_instagram, show_snapchat, post_type, building_id, building_name, latitude, longitude, sublease_start, sublease_end, included_utilities, is_furnished, has_parking, gender_preference, house_rules, additional_rules, items:marketplace_listing_items(id, listing_id, name, price, status, x, y, photo_index)')
        .eq('id', id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (err) throw err;
      // Contact handles come from the opt-out-masked view (SEC-6); owner sees own.
      return withListingContact(data);
    },
    enabled: !!id && !!user?.id,
  });

  const { data: sellerProfile } = useQuery({
    queryKey: ['profiles', user?.id, 'seller_socials'],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('instagram_username, snapchat_username')
        .eq('id', user.id)
        .maybeSingle();
      if (error) {
        toast.error(t('marketplace:edit.toast.profileLoadError'));
        throw error;
      }
      return data;
    },
    enabled: !!user?.id,
  });
  useEffect(() => {
    if (listing) {
      setTitle(listing.title ?? '');
      setDescription(listing.description ?? '');
      setPrice(String(listing.price ?? ''));
      setCategory((listing.category as MarketplaceCategory) ?? 'Other');
      setCondition(listing.condition ?? 'Good');
      setMeetupLocation(listing.meetup_location ?? '');
      setShowInstagram(listing.show_instagram ?? false);
      setShowSnapchat(listing.show_snapchat ?? false);
      setPriceNegotiable((listing as { price_negotiable?: boolean | null }).price_negotiable ?? false);
      setPaymentMethods(
        normalizePaymentMethods((listing as { payment_methods?: string[] | null }).payment_methods),
      );
      const l = listing as { instagram_handle?: string; snapchat_handle?: string };
      setInstagramHandle((l.instagram_handle ?? '').trim() || (sellerProfile?.instagram_username ?? '').trim());
      setSnapchatHandle((l.snapchat_handle ?? '').trim() || (sellerProfile?.snapchat_username ?? '').trim());
      const urls = listing.image_urls ?? [];
      setListingImages(urls.map((url) => ({ type: 'url' as const, url })));
      setItems(((listing as { items?: DraftListingItem[] }).items ?? []) as DraftListingItem[]);
      // Narrowed to the sublease columns only. `listing.price` is a number on the
      // row and a string in the form, so a blanket `Partial<ListingForm>` cast is
      // rejected — and rightly, since that mismatch is exactly the kind a cast
      // would hide.
      const sub = listing as unknown as SubleaseRowColumns;
      setSubleaseForm({
        ...EMPTY_SUBLEASE_FORM,
        price: String(listing.price ?? ''),
        building_id: sub.building_id ?? null,
        building_name: sub.building_name ?? null,
        // Carried through unchanged so a save that does not touch the address
        // does not have to re-geocode; `handleSubmit` overwrites both whenever
        // the address string has moved.
        latitude: sub.latitude ?? null,
        longitude: sub.longitude ?? null,
        sublease_start: sub.sublease_start ?? null,
        sublease_end: sub.sublease_end ?? null,
        included_utilities: sub.included_utilities ?? [],
        is_furnished: sub.is_furnished ?? false,
        has_parking: sub.has_parking ?? false,
        gender_preference: sub.gender_preference ?? 'any',
        house_rules: sub.house_rules ?? null,
        additional_rules: sub.additional_rules ?? null,
      });
    }
  }, [listing, sellerProfile]);

  const firstCoverFile = listingImages[0]?.type === 'file' ? listingImages[0].file : null;
  useEffect(() => {
    if (!firstCoverFile) {
      setEditFileCoverUrl(null);
      return;
    }
    const url = URL.createObjectURL(firstCoverFile);
    setEditFileCoverUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [firstCoverFile]);

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

  const selectableCategories = MARKETPLACE_CATEGORIES;
  /**
   * A sublease is edited HERE rather than on a route of its own, because a lister
   * reaches this screen from My Items like any other post and a second edit page
   * would be a second place for the two halves to drift. What changes is which
   * fields the screen shows and which requirements it enforces — the same split
   * `POST_TYPE_SCHEMAS` already makes on the create side.
   *
   * Before this, the screen rendered the ITEM form for a sublease: no address, no
   * dates, a mandatory payment method it has no field for, and a save that wrote
   * none of the sublease columns. Editing a sublease was not partially broken, it
   * was unreachable.
   */
  const isSublease = (listing as { post_type?: string } | null)?.post_type === 'sublease';
  const hasItems = items.length > 0;
  const itemsValid = items.every((it) => it.name.trim() && !Number.isNaN(it.price) && it.price >= 0);
  // Multi-item listings derive the card price from items ("From $X").
  const priceValid =
    hasItems || (price !== '' && !Number.isNaN(parseFloat(price)) && parseFloat(price) >= 0);
  // Rent is not settled through a marketplace handoff, so a sublease has no
  // payment methods and no field to set them in — requiring one would dead-end
  // the save with nothing to click.
  const paymentMethodsValid = isSublease || paymentMethods.length > 0;
  // Quality floor: every listing needs at least one photo.
  const photosValid = listingImages.length > 0;
  const unmetSubleaseTerm = isSublease ? firstUnmetSubleaseTerm(subleaseForm) : null;
  // A sublease has no title input on either screen — `subleaseTitle()` derives it
  // from the address — so the title requirement is an item requirement.
  const titleValid = isSublease || !!title.trim();
  const canSubmit =
    titleValid &&
    priceValid &&
    itemsValid &&
    paymentMethodsValid &&
    photosValid &&
    unmetSubleaseTerm === null &&
    !isSubmitting;

  const subleaseBuildingError =
    reveal.shouldReveal('building_name') && unmetSubleaseTerm === 'building'
      ? t('marketplace:blocked.subleaseBuilding')
      : null;
  const subleaseDatesError =
    reveal.shouldReveal('sublease_dates') &&
    (unmetSubleaseTerm === 'dates' || unmetSubleaseTerm === 'range')
      ? t(
          unmetSubleaseTerm === 'range'
            ? 'marketplace:blocked.subleaseRange'
            : 'marketplace:blocked.subleaseDates',
        )
      : null;
  const priceNum = parseFloat(price);
  const isTinyPrice = !hasItems && price !== '' && !Number.isNaN(priceNum) && priceNum > 0 && priceNum < 5;

  const editCoverUrl = useMemo(() => {
    if (listingImages.length === 0) return null;
    const first = listingImages[0];
    if (first.type === 'url') return safeImageSrc(first.url) || null;
    return editFileCoverUrl;
  }, [listingImages, editFileCoverUrl]);

  const editPreviewListing = useMemo<GeneralMarketplacePreviewData>(() => {
    return {
      title,
      category,
      price,
      condition,
      meetup: meetupLocation,
      coverImageUrl: editCoverUrl,
    };
  }, [
    title,
    price,
    category,
    condition,
    meetupLocation,
    editCoverUrl,
  ]);

  const handleSubmit = async () => {
    reveal.markSubmitAttempted();
    if (!id || !user?.id || !canSubmit) return;
    setIsSubmitting(true);

    try {
      if (isSublease) {
        // RE-GEOCODE ON EVERY SAVE, not only when the string looks changed.
        // "Looks changed" is a comparison against hydrated state that a draft, a
        // remount, or a whitespace edit can all get wrong, and the failure it
        // produces is the silent one: a listing advertising a new address while
        // its pin stays on the old one. One request per save is cheap; a pin
        // that lies is not. A null is a REFUSAL — the row is left alone.
        const coords = await geocodeSubleaseAddress(
          subleaseForm.building_name ?? '',
          university,
        );
        if (!coords) {
          reveal.reveal('building_name');
          toast.error(t('marketplace:blocked.subleaseAddressUnresolved'));
          return;
        }
        const subleaseUpdate: ListingForm = {
          ...subleaseForm,
          title: subleaseTitle(subleaseForm),
          price,
          imageFiles: [],
          listingImages,
          latitude: coords.lat,
          longitude: coords.lng,
          show_instagram: showInstagram,
          show_snapchat: showSnapchat,
          instagram_handle: instagramHandle.trim().replace(/^@/, '') || undefined,
          snapchat_handle: snapchatHandle.trim().replace(/^@/, '') || undefined,
        };
        const subOk = await updateListing(id, subleaseUpdate, onSuccess);
        if (subOk) {
          await queryClient.invalidateQueries({ queryKey: ['marketplace_listings'] });
          // The map reads its own query, so an edited address that does not
          // invalidate it moves the pin only after a 60s staleTime.
          await queryClient.invalidateQueries({ queryKey: ['sublease-map-listings'] });
        }
        return;
      }

      const form: ListingForm = {
        title,
        description,
        price,
        category,
        imageFiles: [],
        condition,
        meetup_location: meetupLocation,
        show_instagram: showInstagram,
        show_snapchat: showSnapchat,
        price_negotiable: priceNegotiable,
        payment_methods: paymentMethods,
        instagram_handle: instagramHandle.trim().replace(/^@/, '') || undefined,
        snapchat_handle: snapchatHandle.trim().replace(/^@/, '') || undefined,
        listingImages,
        items,
      };
      const ok = await updateListing(id, form, onSuccess);
      if (ok) {
        await queryClient.invalidateQueries({ queryKey: ['marketplace_listings'] });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!user) {
    return null;
  }

  if (isLoading || (id && !listing && !error)) {
    return (
      <div className={cn('flex items-center justify-center bg-background', variant === 'modal' ? 'min-h-[200px] py-12' : 'min-h-screen')}>
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || (id && !listing)) {
    toast.error(t('marketplace:edit.toast.notFound'));
    onClose();
    return null;
  }

  // Shared by both branches below: every listing type needs photos, and a second
  // copy of this block is a second place for the item remap callbacks to drift.
  const photoBlock = (
    <>
      <PhotoGalleryField
        idPrefix="mp-listing-edit"
        value={listingImages}
        onChange={setListingImages}
        onReorder={(oldIndex, newIndex) =>
          setItems((prev) => remapItemPhotoIndexes(prev, oldIndex, newIndex))
        }
        onRemove={(index) => setItems((prev) => remapItemsAfterPhotoDelete(prev, index))}
      />
      {!photosValid && (
        <p className="-mt-4 text-xs text-muted-foreground">
          {t('marketplace:edit.photoRequiredHint')}
        </p>
      )}
    </>
  );

  const formContent = (
    <div className={cn('space-y-6', variant === 'modal' && 'px-1')}>
      {isSublease ? (
        <>
          {/* Photos, rent, then the structured terms — the same order the
              composer uses, so a lister editing a post meets the fields where
              they left them. No title, category, condition, meetup or payment
              method: none of those is a fact about a sublease. */}
          {photoBlock}
          <div>
            <Label htmlFor="edit-sublease-rent">{t('marketplace:sublease.rent')}</Label>
            <Input
              id="edit-sublease-rent"
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(sanitizePrice(e.target.value))}
              placeholder="0"
              className="mt-1"
            />
          </div>
          <SubleaseFields
            form={subleaseForm}
            setForm={setSubleaseForm}
            reveal={reveal}
            buildingError={subleaseBuildingError}
            datesError={subleaseDatesError}
            listingUniversityId={university.id}
          />
        </>
      ) : (
        <>
          <div>
            <Label htmlFor="edit-title">{t('marketplace:edit.titleLabel')}</Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('marketplace:edit.titlePlaceholder')}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="edit-desc">{t('marketplace:edit.descriptionLabel')}</Label>
            <Textarea
              id="edit-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('marketplace:edit.descriptionPlaceholder')}
              rows={3}
              className="mt-1"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="edit-price">{t('marketplace:edit.priceLabel')}</Label>
              <Input
                id="edit-price"
                type="text"
                inputMode="decimal"
                value={hasItems ? String(minAvailablePrice(items) ?? '') : price}
                onChange={(e) => setPrice(sanitizePrice(e.target.value))}
                placeholder="0"
                disabled={hasItems}
                className="mt-1"
              />
              {hasItems && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('marketplace:edit.fromPriceHint', { price: minAvailablePrice(items) })}
                </p>
              )}
              {!hasItems && !isTinyPrice && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('marketplace:edit.priceTip')}
                </p>
              )}
              {isTinyPrice && (
                <p className="mt-1 text-xs text-amber-700">
                  {t('marketplace:edit.tinyPriceWarning')}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="edit-category">{t('marketplace:edit.categoryLabel')}</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as MarketplaceCategory)}>
                <SelectTrigger id="edit-category" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {selectableCategories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="edit-price-negotiable">{t('marketplace:edit.priceNegotiableLabel')}</Label>
            <Switch
              id="edit-price-negotiable"
              checked={!!priceNegotiable}
              onCheckedChange={setPriceNegotiable}
            />
          </div>
          <PaymentMethodsField
            idPrefix="edit-payment"
            value={paymentMethods}
            onChange={setPaymentMethods}
          />
          <div>
            <Label htmlFor="edit-condition">{t('marketplace:edit.conditionLabel')}</Label>
            <Select value={condition} onValueChange={setCondition}>
              <SelectTrigger id="edit-condition" className="mt-1">
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
          <div>
            <Label htmlFor="edit-meetup">{t('marketplace:edit.meetupLabel')}</Label>
            <Input
              id="edit-meetup"
              value={meetupLocation}
              onChange={(e) => setMeetupLocation(e.target.value)}
              placeholder={t('marketplace:edit.meetupPlaceholder')}
              className="mt-1"
            />
          </div>
              {photoBlock}
          <div>
            <Label>{t('marketplace:edit.multiItemLabel')}</Label>
            <div className="mt-1">
              <ListingItemTagger photos={listingImages} items={items} onChange={setItems} />
            </div>
          </div>
        </>
      )}
          <ShowOnListingSection
            values={{
              instagram_handle: instagramHandle,
              snapchat_handle: snapchatHandle,
              phone_number: '',
              show_instagram: showInstagram,
              show_snapchat: showSnapchat,
              show_phone: false,
            }}
            onChange={(v) => {
              setInstagramHandle(v.instagram_handle);
              setSnapchatHandle(v.snapchat_handle);
              setShowInstagram(v.show_instagram);
              setShowSnapchat(v.show_snapchat);
            }}
          />
          {/* An item-shaped preview. A sublease card is built from the structured
              terms instead, and rendering this one for it would show a listing
              that does not exist. */}
          {!isSublease && <MarketplaceListingPreviewBlock listing={editPreviewListing} />}
          {variant === 'page' && (
            <Button
              className="w-full min-h-[44px]"
              disabled={!canSubmit}
              onClick={handleSubmit}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t('marketplace:edit.updating')}
                </>
              ) : (
                t('common:actions.saveChanges')
              )}
            </Button>
          )}
        </div>
  );

  const modalFooter = (
    <div className="shrink-0 flex flex-col gap-2 border-t border-border px-4 pt-4 pb-[calc(var(--keyboard-height,0px)+max(0.75rem,env(safe-area-inset-bottom)))] sm:flex-row sm:flex-row-reverse sm:gap-2">
      <Button
        disabled={!canSubmit}
        onClick={handleSubmit}
        // KEEP: primary CTA of the edit screen (save listing)
        className="w-full sm:w-auto bg-malachite-800 hover:bg-malachite-800 text-white"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            {t('common:actions.saving')}
          </>
        ) : (
          t('common:actions.save')
        )}
      </Button>
      <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">
        {t('common:actions.cancel')}
      </Button>
    </div>
  );

  if (variant === 'modal') {
    return (
      <>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-[calc(var(--keyboard-height,0px)+max(0.75rem,env(safe-area-inset-bottom)))]">
          {formContent}
        </div>
        {modalFooter}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <PageContainer width="content" className="px-4 py-6 pb-28">
        <Button variant="ghost" size="sm" className="mb-6 -ml-1 min-h-[44px] gap-2" onClick={onClose}>
          <ArrowLeft className="w-4 h-4" />
          {t('common:actions.back')}
        </Button>
        {formContent}
      </PageContainer>
    </div>
  );
}

const MARKETPLACE_LIST_PATH = '/marketplace?tab=buy-sell';

export default function MarketplaceEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const returnPath = location.pathname.startsWith('/subleases/') ? '/subleases' : MARKETPLACE_LIST_PATH;

  const exitToMarketplace = useCallback(() => {
    navigate(returnPath);
  }, [navigate, returnPath]);

  const exitToSavedListing = useCallback(() => {
    if (!id) {
      exitToMarketplace();
      return;
    }
    if (returnPath === '/subleases') {
      navigate('/subleases');
    } else {
      navigate(MARKETPLACE_LIST_PATH, { state: { openListingId: id } });
    }
  }, [navigate, id, exitToMarketplace, returnPath]);

  useEffect(() => {
    if (!id) {
      navigate(returnPath, { replace: true });
    }
  }, [id, navigate, returnPath]);

  if (!id) return null;

  return (
    <MarketplaceEditForm
      listingId={id}
      variant="page"
      onSuccess={exitToSavedListing}
      onClose={exitToMarketplace}
    />
  );
}
