import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { firstUnmetRequirement, useErrorReveal } from '@/lib/formCraft';
import { SubmitBlockedReason } from '@/components/ui/field-error';
import { supabase } from '@/integrations/supabase/client';
import { safeImageSrc } from '@/lib/sanitize';
import { checkProhibitedContent } from '@/lib/prohibitedContent';
import { useAuth } from '@/hooks/useAuth';
import { useKeyboardOpen } from '@/hooks/useKeyboardInset';
import { useIsMobile } from '@/hooks/use-mobile';
import { useModalOverlay } from '@/contexts/ModalOverlayContext';
import { useUniversity } from '@/contexts/UniversityContext';
import { TallSheet } from '@/components/ui/tall-sheet';
import {
  useMyListings,
  MARKETPLACE_CATEGORIES,
  type ListingForm,
} from '@/hooks/useMyListings';
import {
  minAvailablePrice,
  remapItemPhotoIndexes,
  remapItemsAfterPhotoDelete,
} from '@/lib/listingItems';
import { PostListingFields } from '@/components/marketplace/PostListingComposer';
import { PostTypePicker } from '@/components/marketplace/PostTypePicker';
import { SubleaseFields } from '@/components/marketplace/SubleaseFields';
import { firstUnmetSubleaseTerm, geocodeSubleaseAddress, subleaseTitle } from '@/lib/subleases';
import { ServiceFields } from '@/components/marketplace/ServiceFields';
import { firstUnmetServiceDetail } from '@/lib/servicePosts';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import {
  DEFAULT_POST_TYPE,
  deepLinkPostType,
  getPostTypeSchema,
  feedStatusesFor,
  type PostType,
} from '@/lib/postTypes';
import { type PhotoGalleryItem } from '@/components/marketplace/PhotoGalleryField';
import {
  FormPreviewLabel,
  MarketplaceListingDetailPreview,
  MarketplaceListingPreviewBlock,
  type GeneralMarketplacePreviewData,
} from '@/components/marketplace/FormLivePreview';

const MAX_ACTIVE_LISTINGS = 15;
const MARKETPLACE_PATH = '/marketplace?tab=buy-sell';
const FOCUS_RING = 'focus-visible:ring-malachite-600 focus-visible:ring-offset-2';

const defaultListingForm: ListingForm = {
  title: '',
  description: '',
  price: '',
  category: 'Other',
  imageFiles: [],
  condition: 'Good',
  meetup_location: '',
  price_negotiable: false,
  payment_methods: [],
  show_instagram: false,
  show_snapchat: false,
  show_phone: false,
  instagram_handle: '',
  snapchat_handle: '',
  phone_number: '',
};

// --- localStorage draft (serializable fields only; File photos can't persist) ---
const draftKey = (uid: string) => `dormcheck:mp:draft:${uid}`;
type DraftShape = Omit<Partial<ListingForm>, 'imageFiles' | 'imageFile' | 'listingImages'>;

function loadDraft(uid: string): DraftShape | null {
  try {
    const raw = localStorage.getItem(draftKey(uid));
    return raw ? (JSON.parse(raw) as DraftShape) : null;
  } catch {
    return null;
  }
}
function persistDraft(uid: string, form: ListingForm) {
  // Strip anything holding a File - localStorage is string-only.
  const { imageFiles: _f, imageFile: _s, listingImages: _l, ...rest } = form;
  void _f;
  void _s;
  void _l;
  try {
    localStorage.setItem(draftKey(uid), JSON.stringify(rest));
  } catch {
    /* quota / private mode - ignore */
  }
}
function clearDraft(uid: string) {
  try {
    localStorage.removeItem(draftKey(uid));
  } catch {
    /* ignore */
  }
}

/**
 * "Post an Item" composer.
 *
 * Two presentations, one component:
 * - **Mobile** — the canonical `TallSheet`, the same near-full-height iOS sheet
 *   Settings uses: it opens OVER the marketplace (which stays mounted behind it
 *   via RoutedApp's background `<Routes>`), leaves a gap under the Dynamic
 *   Island, and drags down to dismiss. It used to be a bare full-screen route,
 *   which read as a different app and left a dead white band under the status
 *   bar where the sheet's top gap now shows the page.
 * - **Desktop** — unchanged Facebook-Marketplace-style takeover: a left rail of
 *   stacked fields with Save-draft, and a big live listing preview filling the
 *   right (App.tsx hides the sidebar, the top padding and the top-right pill nav
 *   for `/marketplace/create`).
 *
 * Self-contained submit — same `createListing` path in both.
 */
export default function MarketplaceCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { university } = useUniversity();
  const { createListing } = useMyListings(user?.id);
  const keyboardOpen = useKeyboardOpen();
  const modalOverlay = useModalOverlay();
  const isMobile = useIsMobile();
  const isSubleaseJourney = location.pathname.startsWith('/subleases/');

  const navDraft = (location.state as { draft?: Partial<ListingForm> } | null)?.draft;
  const [listingForm, setListingForm] = useState<ListingForm>(() => ({
    ...defaultListingForm,
    ...(navDraft ?? {}),
  }));
  const [isSubmitting, setIsSubmitting] = useState(false);

  // One entry point, one flow: the picked type selects the schema this page
  // validates and submits against, rather than routing to another page (PRD §5
  // Phase 2). Only `item` has a schema today, so this resolves to exactly the
  // requirement set that shipped before the refactor.
  const flags = useFeatureFlags();

  /**
   * `?type=` preselection. DERIVED every render, never copied into state on
   * mount: `showPostSublease` starts at its static default and only narrows once
   * the school's `universities.feature_flags` row resolves, so a one-shot
   * initializer would latch a type CMU may not post and never let go. Recomputing
   * means the deep link stops applying the moment the real gate arrives.
   *
   * `location` is the REAL URL in both presentations — the mobile sheet's
   * `<Routes>` in App.tsx is matched against it, not against the background
   * page's `effectiveLocation` — so the param survives the sheet as well as the
   * desktop takeover.
   */
  const deepLinked = useMemo(
    () => deepLinkPostType(location.search, flags),
    [location.search, flags],
  );

  // Null until the student picks, so an explicit choice always outranks the URL
  // (and outlives a late flag resolution) without an effect racing either one.
  const [pickedPostType, setPickedPostType] = useState<PostType | null>(null);
  const postType = isSubleaseJourney ? 'sublease' : (pickedPostType ?? deepLinked ?? DEFAULT_POST_TYPE);
  const setPostType = setPickedPostType;
  const schema = getPostTypeSchema(postType) ?? getPostTypeSchema(DEFAULT_POST_TYPE)!;
  const titleBlockedKey = schema.titleKeys?.blocked ?? 'marketplace:blocked.title';

  const exitPath = isSubleaseJourney ? '/subleases' : MARKETPLACE_PATH;
  const exit = useCallback(() => navigate(exitPath), [navigate, exitPath]);

  // BottomNav goes in both presentations: it floats at z-[10051] and would land
  // directly on this form's pinned Post/Cancel bar.
  //
  // The top pill is different. The desktop/legacy takeover has to hide it — it is
  // app chrome unrelated to composing a listing, and leaving it up also left the
  // shell's `pt-12` offset in place, which pushed the footer below the viewport
  // and clipped Post/Cancel. In the mobile sheet the page behind stays visible on
  // purpose and the sheet's own top edge already covers the pills, so hiding it
  // would only punch a hole in the backdrop.
  useEffect(() => {
    modalOverlay?.setHideBottomNav(true);
    if (!isMobile) modalOverlay?.setHideTopNav(true);
    return () => {
      modalOverlay?.setHideBottomNav(false);
      modalOverlay?.setHideTopNav(false);
    };
  }, [modalOverlay, isMobile]);

  useEffect(() => {
    if (!user) navigate('/auth');
  }, [user, navigate]);

  // Restore a saved draft once (nav-state draft, if any, wins and is already applied).
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !user?.id) return;
    restoredRef.current = true;
    if (navDraft) return;
    const saved = loadDraft(user.id);
    if (saved && Object.keys(saved).length > 0) {
      setListingForm((prev) => ({ ...prev, ...saved }));
      toast(t('marketplace:create.draftRestored'));
    }
  }, [user?.id, navDraft, t]);

  // ---- photo gallery ----
  const galleryValue = useMemo<PhotoGalleryItem[]>(() => {
    if (listingForm.imageFiles.length > 0) {
      return listingForm.imageFiles.map((file) => ({ type: 'file', file }));
    }
    if (listingForm.imageUrl) return [{ type: 'url', url: listingForm.imageUrl }];
    return [];
  }, [listingForm.imageFiles, listingForm.imageUrl]);

  const handleGalleryChange = useCallback((next: PhotoGalleryItem[]) => {
    const files = next.filter((item): item is { type: 'file'; file: File } => item.type === 'file');
    const urls = next.filter((item): item is { type: 'url'; url: string } => item.type === 'url');
    setListingForm((prev) => ({
      ...prev,
      imageFiles: files.map((item) => item.file),
      imageUrl: files.length > 0 ? null : (urls[0]?.url ?? null),
    }));
  }, []);
  const handleGalleryReorder = useCallback((oldIndex: number, newIndex: number) => {
    setListingForm((prev) =>
      prev.items?.length ? { ...prev, items: remapItemPhotoIndexes(prev.items, oldIndex, newIndex) } : prev,
    );
  }, []);
  const handleGalleryRemove = useCallback((index: number) => {
    setListingForm((prev) =>
      prev.items?.length ? { ...prev, items: remapItemsAfterPhotoDelete(prev.items, index) } : prev,
    );
  }, []);

  const [fileCoverUrl, setFileCoverUrl] = useState<string | null>(null);
  const firstFile = listingForm.imageFiles[0];
  useEffect(() => {
    if (!firstFile) {
      setFileCoverUrl(null);
      return;
    }
    const url = URL.createObjectURL(firstFile);
    setFileCoverUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [firstFile]);
  const coverUrl = useMemo(() => {
    if (fileCoverUrl) return fileCoverUrl;
    if (listingForm.imageUrl && listingForm.imageFiles.length === 0) {
      return safeImageSrc(listingForm.imageUrl) || null;
    }
    return null;
  }, [fileCoverUrl, listingForm.imageUrl, listingForm.imageFiles.length]);

  // Prefill saved contact handles + seller name (once).
  const { data: sellerProfile } = useQuery({
    queryKey: ['profiles', user?.id, 'seller_socials'],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('profiles')
        // current_dorm is the housing half of the verified-lister gate below.
        .select('full_name, instagram_username, snapchat_username, phone_number, current_dorm')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (!sellerProfile || prefilledRef.current) return;
    prefilledRef.current = true;
    setListingForm((prev) => ({
      ...prev,
      instagram_handle: prev.instagram_handle || (sellerProfile.instagram_username ?? '').trim(),
      snapchat_handle: prev.snapchat_handle || (sellerProfile.snapchat_username ?? '').trim(),
      phone_number: prev.phone_number || (sellerProfile.phone_number ?? '').trim(),
    }));
  }, [sellerProfile]);

  // 15 active-listing cap — bounce back if already at the limit.
  const { data: myGeneralListingCount = 0 } = useQuery({
    queryKey: ['marketplace_listings', 'my_general_count', user?.id, postType],
    queryFn: async () => {
      if (!user?.id) return 0;
      const { count, error } = await supabase
        .from('marketplace_listings')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        // The live status differs by lifecycle: an item is 'available', a
        // service post is 'open'/'claimed'. Counting the wrong one would read
        // every service post as inactive and never apply the cap.
        .in('status', feedStatusesFor(postType))
        // The real discriminator since migration 20260910000000.
        .eq('post_type', postType);
      if (error) return 0;
      return count ?? 0;
    },
    staleTime: 2 * 60_000,
    enabled: Boolean(user?.id),
  });
  // Subleases have their own, much tighter cap: ONE active per user, enforced by
  // the `marketplace_listings_user_one_active_sublease` unique index. Reading it
  // here turns a raw 23505 at submit into a sentence before the form is filled in.
  const activeCap = schema.requiresSubleaseTerms ? 1 : MAX_ACTIVE_LISTINGS;
  const atCap = myGeneralListingCount >= activeCap;
  const capGuardedRef = useRef(false);
  useEffect(() => {
    // Only the ITEM cap bounces off the page. A student who already has a live
    // sublease and switched the picker to `sublease` should keep the page and
    // read why — exiting would look like the app crashed on a chip tap.
    if (capGuardedRef.current || schema.requiresSubleaseTerms) return;
    if (myGeneralListingCount >= MAX_ACTIVE_LISTINGS) {
      capGuardedRef.current = true;
      toast.error(t('housing:portal.marketplace.posting.limitReached'));
      exit();
    }
  }, [myGeneralListingCount, schema.requiresSubleaseTerms, t, exit]);

  // ---- verified lister (sublease write gate) ----
  // The REAL gate is `public.can_post_sublease()` in RLS (migration
  // 20260907000000) — this mirror exists only so the page can say WHY rather
  // than letting a student fill in a whole sublease and eat a 42501 at submit.
  // Deliberately fails CLOSED while the profile is still loading: showing the
  // gate and then removing it is a better wrong state than the reverse.
  const listerVerified = Boolean(
    user?.email_confirmed_at && (sellerProfile?.current_dorm ?? '').trim(),
  );

  // ---- derived validation ----
  const listingItems = listingForm.items ?? [];
  const hasListingItems = listingItems.length > 0;
  const derivedItemsPrice = hasListingItems ? minAvailablePrice(listingItems) : null;
  const itemsValid = listingItems.every(
    (it) => it.name.trim() && !Number.isNaN(it.price) && it.price >= 0,
  );
  // Each requirement is gated on the picked type's schema, so a type that does
  // not ask for (say) a payment method does not inherit the item flow's gate.
  // With the item schema every flag is true — identical to the previous logic.
  const titleValid = !schema.requiresTitle || Boolean(listingForm.title.trim());
  const priceValid =
    !schema.requiresPrice ||
    hasListingItems ||
    (listingForm.price !== '' &&
      !Number.isNaN(parseFloat(listingForm.price)) &&
      parseFloat(listingForm.price) >= 0);
  const paymentMethodsValid =
    !schema.requiresPaymentMethods || (listingForm.payment_methods?.length ?? 0) > 0;
  const photosValid =
    !schema.requiresPhotos ||
    (listingForm.imageFiles?.length ?? 0) > 0 ||
    Boolean(listingForm.imageUrl);
  // Structured sublease terms — building + a start/end pair that runs forwards.
  const unmetSubleaseTerm = schema.requiresSubleaseTerms
    ? firstUnmetSubleaseTerm(listingForm)
    : null;
  const subleaseTermsOk = unmetSubleaseTerm === null;
  const listerGateOk = !schema.requiresVerifiedLister || listerVerified;
  // Structured service details. Only the task category is required — see
  // src/lib/servicePosts.ts for why the rest stay optional.
  const unmetServiceDetail = schema.requiresServiceDetails
    ? firstUnmetServiceDetail(listingForm)
    : null;
  const serviceDetailsOk = unmetServiceDetail === null;
  const canSubmit =
    titleValid &&
    priceValid &&
    itemsValid &&
    paymentMethodsValid &&
    photosValid &&
    subleaseTermsOk &&
    serviceDetailsOk &&
    listerGateOk &&
    !atCap &&
    !isSubmitting;

  // ---- IPP-3: say WHY the Post button is dead ----
  // Five separate requirements used to hide behind one `disabled={!canSubmit}`,
  // and a listing with no photo looked identical to a finished one. The funnel
  // measurement on 2026-07-29 put listing-post among the two worst drop-offs, and
  // an unexplained dead CTA is the most likely reason someone abandons here.
  // Ordered to match the field order down the form, so the answer points at the
  // next thing to touch rather than sending the user hunting.
  // The lister gate comes FIRST for a sublease: it is the only requirement the
  // student cannot satisfy on this page, so naming it after four field errors
  // would mean fixing everything else to be told it was never postable.
  const submitBlockedReason = firstUnmetRequirement([
    { met: listerGateOk, reason: t('marketplace:blocked.verifiedLister') },
    {
      met: !atCap,
      reason: schema.requiresSubleaseTerms
        ? t('marketplace:blocked.subleaseOneActive')
        : t('housing:portal.marketplace.posting.limitReached'),
    },
    { met: photosValid, reason: t('marketplace:blocked.photo') },
    // Per-type copy: "Give your item a title" is a sentence about an object, and
    // a request for a hand with a task is not one.
    { met: titleValid, reason: t(titleBlockedKey) },
    { met: unmetSubleaseTerm !== 'building', reason: t('marketplace:blocked.subleaseBuilding') },
    { met: unmetSubleaseTerm !== 'dates', reason: t('marketplace:blocked.subleaseDates') },
    { met: unmetSubleaseTerm !== 'range', reason: t('marketplace:blocked.subleaseRange') },
    { met: unmetServiceDetail !== 'category', reason: t('marketplace:blocked.serviceCategory') },
    {
      met: unmetServiceDetail !== 'integrityAck',
      reason: t('marketplace:service.integrity.ackRequired'),
    },
    { met: unmetServiceDetail !== 'pastDate', reason: t('marketplace:blocked.servicePastDate') },
    { met: unmetServiceDetail !== 'notesLength', reason: t('marketplace:blocked.serviceNotes') },
    { met: priceValid && itemsValid, reason: t('marketplace:blocked.price') },
    { met: paymentMethodsValid, reason: t('marketplace:blocked.payment') },
  ]);

  // Field-level messages, revealed on blur or after the first Post attempt (never
  // per keystroke — see src/lib/formCraft.ts). Same strings as the footer line, so
  // the page never says two different things about one problem.
  const reveal = useErrorReveal();
  const titleError =
    reveal.shouldReveal('title') && !titleValid ? t(titleBlockedKey) : null;
  const priceError =
    reveal.shouldReveal('price') && !priceValid ? t('marketplace:blocked.price') : null;
  // The address that last failed to geocode. While the field still holds it, the
  // failure stays ON the field (aria-invalid + message): a toast alone vanished in
  // ~4s and left a valid-looking form whose Post "did nothing". Editing clears it.
  const [unresolvedAddress, setUnresolvedAddress] = useState<string | null>(null);
  const addressStillUnresolved =
    unresolvedAddress !== null && unresolvedAddress === (listingForm.building_name ?? '').trim();
  const buildingError =
    reveal.shouldReveal('building_name') && unmetSubleaseTerm === 'building'
      ? t('marketplace:blocked.subleaseBuilding')
      : addressStillUnresolved
        ? t('marketplace:blocked.subleaseAddressUnresolved')
        : null;
  const datesError =
    reveal.shouldReveal('sublease_dates') &&
    (unmetSubleaseTerm === 'dates' || unmetSubleaseTerm === 'range')
      ? t(
          unmetSubleaseTerm === 'range'
            ? 'marketplace:blocked.subleaseRange'
            : 'marketplace:blocked.subleaseDates',
        )
      : null;
  // The category select is the only required service field, so it is the only
  // one with a field-level message; the notes cap reveals on blur like any
  // other length limit.
  const serviceCategoryError =
    reveal.shouldReveal('service_category') && unmetServiceDetail === 'category'
      ? t('marketplace:blocked.serviceCategory')
      : null;
  const serviceNotesError =
    reveal.shouldReveal('service_notes') && unmetServiceDetail === 'notesLength'
      ? t('marketplace:blocked.serviceNotes')
      : null;
  // Not blur-gated: a checkbox has no meaningful blur, and the only way to reach
  // this state is to have picked tutoring and pressed Post without ticking it.
  const serviceIntegrityError =
    reveal.shouldReveal('service_category') && unmetServiceDetail === 'integrityAck'
      ? t('marketplace:service.integrity.ackRequired')
      : null;
  const listingPriceNum = parseFloat(listingForm.price);
  const isTinyPrice =
    !hasListingItems &&
    listingForm.price !== '' &&
    !Number.isNaN(listingPriceNum) &&
    listingPriceNum > 0 &&
    listingPriceNum < 5;

  const hasDraftContent = Boolean(
    listingForm.title.trim() ||
      listingForm.description.trim() ||
      listingForm.price.trim() ||
      galleryValue.length > 0 ||
      listingItems.length > 0,
  );

  // The preview is a promise about the post, so it follows the SAME schema the
  // form does: an item-shaped preview on a sublease or a service request shows
  // fields ("Condition", "Category", the word "Price") that those rows will
  // never carry. Everything type-specific is passed through; FormLivePreview
  // decides what to render from `postType`.
  const previewListing = useMemo<GeneralMarketplacePreviewData>(
    () => ({
      postType,
      title: listingForm.title,
      category: listingForm.category,
      price: hasListingItems ? String(minAvailablePrice(listingForm.items ?? []) ?? '') : listingForm.price,
      condition: listingForm.condition ?? 'Good',
      meetup: listingForm.meetup_location ?? '',
      coverImageUrl: coverUrl,
      description: listingForm.description,
      negotiable: !!listingForm.price_negotiable,
      paymentMethods: listingForm.payment_methods ?? [],
      sellerName: sellerProfile?.full_name ?? undefined,
      subleaseTerms: {
        sublease_start: listingForm.sublease_start,
        sublease_end: listingForm.sublease_end,
        building_id: listingForm.building_id,
        building_name: listingForm.building_name,
        included_utilities: listingForm.included_utilities,
        is_furnished: listingForm.is_furnished,
        has_parking: listingForm.has_parking,
        gender_preference: listingForm.gender_preference,
      },
      service: {
        category: listingForm.service_category,
        date: listingForm.service_date,
        durationMinutes: listingForm.service_duration_minutes,
        location: listingForm.service_location,
        notes: listingForm.service_notes,
      },
    }),
    [listingForm, coverUrl, hasListingItems, sellerProfile, postType],
  );

  const sanitizePrice = useCallback((v: string) => {
    if (v === '') return '';
    let s = v.replace(/[^0-9.]/g, '');
    const idx = s.indexOf('.');
    if (idx !== -1) {
      const before = s.slice(0, idx);
      const after = s.slice(idx + 1).replace(/\./g, '').slice(0, 2);
      s = before + '.' + after;
    }
    return s;
  }, []);

  const handleSaveDraft = () => {
    if (!user?.id) return;
    persistDraft(user.id, listingForm);
    toast.success(t('marketplace:create.draftSaved'));
  };

  const handleSubmit = async () => {
    // Reveal first, bail second: the button is disabled while invalid, but this
    // handler is also reachable by other paths, and an attempt that goes nowhere
    // must still light up the fields that caused it.
    reveal.markSubmitAttempted();
    if (!canSubmit) return;
    const contentCheck = checkProhibitedContent(
      `${listingForm.title ?? ''} ${listingForm.description ?? ''}`,
    );
    if (contentCheck.blocked) {
      toast.error(
        `This can't be posted - it looks like it involves ${contentCheck.category}. Prohibited items aren't allowed on DormCheck.`,
      );
      return;
    }
    setIsSubmitting(true);
    try {
      // GEOCODE BEFORE THE INSERT, and refuse the post if it fails.
      //
      // A sublease's promise is that photos plus an address get you on the map, so
      // the coordinates are not an enhancement applied afterwards — they are part
      // of the row, and a listing that could not be placed is a listing we do not
      // write. Failing here rather than posting-then-hiding is also the only thing
      // standing between a typo and a confident wrong pin: `geocodeAddress`
      // returns null for anything past MAX_CAMPUS_DISTANCE_KM of THIS campus,
      // which is what a Pittsburgh address resolving to Lancashire, England looks
      // like from in here.
      let coords: { lat: number; lng: number } | null = null;
      if (schema.requiresSubleaseTerms) {
        coords = await geocodeSubleaseAddress(listingForm.building_name ?? '', university);
        if (!coords) {
          reveal.reveal('building_name');
          setUnresolvedAddress((listingForm.building_name ?? '').trim());
          toast.error(t('marketplace:blocked.subleaseAddressUnresolved'));
          return;
        }
      }

      const form: ListingForm = {
        ...listingForm,
        imageFiles: listingForm.imageFiles ?? [],
        imageUrl: listingForm.imageUrl ?? undefined,
        post_type: postType,
        // A sublease's stored title IS its address, so the card headline is a
        // structured value at the data layer rather than by review.
        ...(schema.requiresSubleaseTerms
          ? {
              title: subleaseTitle(listingForm),
              latitude: coords?.lat ?? null,
              longitude: coords?.lng ?? null,
            }
          : {}),
      };
      await createListing(form, () => {
        if (user?.id) clearDraft(user.id);
        void queryClient.invalidateQueries({
          queryKey: ['marketplace_listings', 'my_general_count', user?.id],
        });
        navigate(exitPath);
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!user) return null;

  const saveDraftButton = (
    <Button
      variant="ghost"
      size="sm"
      className={cn('justify-self-end px-2 font-semibold text-foreground', FOCUS_RING)}
      disabled={!hasDraftContent}
      onClick={handleSaveDraft}
    >
      {t('marketplace:create.saveDraft')}
    </Button>
  );

  // The form itself — identical in both presentations, so the sheet and the
  // takeover can never drift into two different composers.
  const formFields = (
    <>
      {/* One Post button, one flow: the type picker is a branch inside
          this page, not a fork to another route. */}
      {!isSubleaseJourney && (
        <PostTypePicker value={postType} onChange={setPostType} flags={flags} className="mb-6" />
      )}

      <PostListingFields
        form={listingForm}
        setForm={setListingForm}
        categories={MARKETPLACE_CATEGORIES}
        sanitizePrice={sanitizePrice}
        hasListingItems={hasListingItems}
        derivedItemsPrice={derivedItemsPrice}
        isTinyPrice={isTinyPrice}
        galleryValue={galleryValue}
        onGalleryChange={handleGalleryChange}
        onGalleryReorder={handleGalleryReorder}
        onGalleryRemove={handleGalleryRemove}
        reveal={reveal}
        titleError={titleError}
        priceError={priceError}
        schema={schema}
        autoFocusTitle={!isMobile}
        subleaseFields={
          schema.requiresSubleaseTerms ? (
            <SubleaseFields
              form={listingForm}
              setForm={setListingForm}
              reveal={reveal}
              buildingError={buildingError}
              datesError={datesError}
              // The listing being composed belongs to the poster's school, and
              // `marketplace_listings.university_id` is derived from exactly that
              // profile by trg_set_university_id. Passing it explicitly keeps the
              // picker scoped to the LISTING's registry rather than the viewer's.
              listingUniversityId={university.id}
            />
          ) : undefined
        }
        serviceFields={
          schema.requiresServiceDetails ? (
            <ServiceFields
              form={listingForm}
              setForm={setListingForm}
              reveal={reveal}
              categoryError={serviceCategoryError}
              notesError={serviceNotesError}
              integrityError={serviceIntegrityError}
            />
          ) : undefined
        }
      />

      {/* Narrow layouts: compact preview under the form */}
      <div className="mt-8 border-t border-border pt-6 md:hidden">
        <FormPreviewLabel />
        <div className="mt-1.5">
          <MarketplaceListingPreviewBlock listing={previewListing} />
        </div>
      </div>
    </>
  );

  // IPP-3: the next unmet requirement, beside the button it blocks. Rendered
  // before the actions in DOM order so a screen reader meets the explanation on
  // the way to the control, and `sm:mr-auto` pushes it to the far left visually.
  const blockedReason = (
    <SubmitBlockedReason
      id="mp-post-blocked"
      reason={submitBlockedReason}
      className="text-center sm:mr-auto sm:text-left"
    />
  );
  const cancelButton = (
    <Button variant="outline" className="min-h-[48px] border-border bg-card sm:min-h-0" onClick={exit}>
      {t('common:actions.cancel')}
    </Button>
  );
  const postButton = (
    <Button
      disabled={!canSubmit}
      aria-describedby={submitBlockedReason ? 'mp-post-blocked' : undefined}
      onClick={handleSubmit}
      className={cn(
        // KEEP: primary CTA of the create screen (post listing)
        'min-h-[48px] bg-malachite-800 text-white font-semibold hover:bg-malachite-900 active:bg-malachite-900 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 sm:px-8',
        FOCUS_RING,
      )}
    >
      {isSubmitting ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t('common:state.posting')}
        </>
      ) : (
        t('housing:portal.marketplace.posting.post')
      )}
    </Button>
  );

  if (isMobile) {
    // Same chrome as Settings: X / title / action pinned in a draggable header,
    // scrolling body, pinned actions. `onOpenChange(false)` is the drag-down
    // dismissal; the X routes through the same `exit`, so both land back on the
    // marketplace that is already mounted behind the sheet.
    return (
      <TallSheet
        open
        onOpenChange={(next) => {
          if (!next) exit();
        }}
        onCloseClick={exit}
        title={t(schema.headingKey)}
        headerTitle={t(schema.headingKey)}
        headerAction={saveDraftButton}
        headerBordered
        // The form pads itself, and the pinned footer owns the bottom edge.
        bodyClassName="px-4 pb-6 pt-5 sm:px-5"
        // One row, not a stack. The full-page footer stacked reason / Cancel /
        // Post vertically below `sm`, which cost ~200px — a third of the sheet —
        // for two buttons. Post gets the width because it is the reason the
        // sheet is open; Cancel is a second way out beside the header X.
        footer={
          keyboardOpen ? null : (
            <div className="flex flex-col gap-2">
              {blockedReason}
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-2 [&>button]:w-full">
                {cancelButton}
                {postButton}
              </div>
            </div>
          )
        }
      >
        {formFields}
      </TallSheet>
    );
  }

  return (
    // `flex-1 min-h-0` rather than a hard 100dvh: the shell this mounts into is
    // itself a flex column that may carry safe-area / keyboard padding, and a
    // rigid viewport-height child overflowed it (clipped footer).
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
      {/* Compact, platform-familiar title bar: close, task, and draft action share
          one line so the form starts immediately instead of below a large dead zone. */}
      <header className="grid shrink-0 grid-cols-[48px_1fr_88px] items-center border-b border-border bg-card px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 md:grid-cols-[48px_1fr_112px]">
        <Button
          variant="ghost"
          size="icon"
          // The tint is stated ON the glyph, not inherited: `ghost` already sets a
          // descendant `[&_svg]` colour, and a plain `text-*` here only wins if the
          // button's own resolved colour happens to cascade. Measured live, that
          // route produced foreground rgb(1,5,14) where muted was intended
          // (DECISIONS 2026-07-27). Override a descendant rule with a descendant rule.
          className={cn('h-10 w-10 rounded-full [&_svg]:text-foreground', FOCUS_RING)}
          aria-label={t('common:actions.close')}
          onClick={exit}
        >
          <X className="h-5 w-5" />
        </Button>
        <h1 className="truncate text-center font-display text-lg font-semibold text-foreground">
          {t(schema.headingKey)}
        </h1>
        {saveDraftButton}
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Left rail: header + fields */}
        <div className="flex w-full flex-col overflow-y-auto border-border bg-card md:w-[420px] md:shrink-0 md:border-r">
          <div className="px-4 py-5 sm:px-5">{formFields}</div>
        </div>

        {/* Desktop: big preview canvas filling the rest */}
        <div className="hidden min-h-0 flex-1 flex-col bg-card p-8 md:flex">
          <FormPreviewLabel />
          <div className="mt-2 min-h-0 flex-1">
            <MarketplaceListingDetailPreview listing={previewListing} />
          </div>
        </div>
      </div>

      {!keyboardOpen && (
        <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-card px-4 pt-3 pb-[max(1rem,calc(env(safe-area-inset-bottom)+0.5rem))] sm:flex-row sm:items-center sm:justify-end sm:px-6">
          {blockedReason}
          {cancelButton}
          {postButton}
        </footer>
      )}
    </div>
  );
}
