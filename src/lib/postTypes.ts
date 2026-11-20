import type { FeatureFlags } from '@/hooks/useFeatureFlags';

/**
 * The marketplace post-type registry — one flow, one feed.
 *
 * Spec: vault `dormcheck/Reviews Subleases Services PRD.md` §5 Phase 2. Three
 * more post types are landing (sublease, request help, offer help); building
 * each against its own creation page would mean four flows to rewrite later.
 * So the type is DATA: the create flow branches its schema off this registry
 * and the feed filters off it, instead of either growing a new page or a new
 * tab.
 *
 * Nothing here turns a new type on. Every type but `item` ships FLAG-OFF, so a
 * school sees exactly the single-purpose flow it saw before until its flag is
 * flipped — the schemas below are machinery, not a launch.
 */
export const POST_TYPES = ['item', 'sublease', 'request_help', 'offer_help'] as const;

export type PostType = (typeof POST_TYPES)[number];

export const DEFAULT_POST_TYPE: PostType = 'item';

/**
 * Query param that deep-links the create flow straight to a post type, so a
 * student who arrived from a type-specific surface (the /subleases map's empty
 * state) is not asked to pick the type they just came from.
 *
 * It is a HINT, never a gate bypass — `deepLinkPostType()` re-checks the same
 * two conditions the picker disables a chip on, so an unpostable `?type=` opens
 * the picker exactly as no param at all would.
 */
export const POST_TYPE_PARAM = 'type';

/** The `?type=` value as a registry member, or null for absent/unknown. */
export function parsePostTypeParam(raw: string | null | undefined): PostType | null {
  return raw != null && (POST_TYPES as readonly string[]).includes(raw) ? (raw as PostType) : null;
}

/** Composer path preselecting `type`. One place that spells the param. */
export function marketplaceCreatePath(type: PostType): string {
  if (type === 'sublease') return '/subleases/create';
  return `/marketplace/create?${POST_TYPE_PARAM}=${type}`;
}

export function listingEditPath(id: string, type: PostType): string {
  return type === 'sublease' ? `/subleases/edit/${id}` : `/marketplace/edit/${id}`;
}

export type PostTypeDefinition = {
  id: PostType;
  /**
   * POSTING gate. Per-university; resolved through `useFeatureFlags` /
   * `universities.feature_flags`. Answers "may a student at this school CREATE
   * one of these", and nothing else — see `browseFlag`.
   */
  flag: Extract<
    keyof FeatureFlags,
    'showPostItem' | 'showPostSublease' | 'showPostRequestHelp' | 'showPostOfferHelp'
  >;
  /**
   * BROWSING gate, where it differs from `flag`. Falls back to `flag`.
   *
   * These were one switch until 2026-08-17, and the conflation was a defect
   * waiting on the first tenant override to fire it. The feed filters with a
   * single `.eq('post_type', …)` that defaults to `item`, so this chip row is the
   * ONLY route to any other type — closing a school's POSTING flag therefore also
   * made that type unreachable to READ. For subleases that is wrong twice over: a
   * CMU student seeing Oakland subleases through the shared `pittsburgh`
   * marketplace group is the product working as designed, and a scam is found by
   * being seen, so narrowing a sublease's audience makes it more dangerous rather
   * than less — the same argument 20260907000000 makes for gating sublease WRITES
   * while leaving browse open to every signed-in student.
   *
   * `showBrowseSublease` is deliberately absent from OVERRIDABLE_SURFACES: a
   * tenant may close its own posting, never anyone's reading. It used to follow
   * the native clamp as well, on the reading that App Store 5.1.1 / 3.1.5
   * scrutiny lands on rental listings being present at all. Ethan overrode that
   * on 2026-08-18 for reach; later that day Ethan also removed the posting clamp
   * because the browse surface already carries the App Store rental exposure and
   * a native empty map needs a way to become non-empty. An App Store rejection
   * citing rental or housing content restores both native clamps in
   * `resolveFeatureFlags`.
   */
  browseFlag?: Extract<keyof FeatureFlags, 'showBrowseSublease'>;
  labelKey: string;
  hintKey: string;
  /**
   * Whether the FEED can select this type today. Every type is queryable since
   * migration 20260910000000 added the real `post_type` discriminator; the flag
   * stays because it is the thing that keeps a chip from appearing before the
   * column that answers it exists. A type that isn't queryable never reaches
   * the feed's chip row, so no filter can silently return the wrong rows.
   */
  queryable: boolean;
  /**
   * Service posts (a student asking for or offering a hand) carry the structured
   * task fields and run the open -> claimed -> completed lifecycle instead of
   * available -> sold. They are NEVER priced — see SERVICE_POST_PRICE below.
   */
  isService: boolean;
};

export const POST_TYPE_DEFINITIONS: readonly PostTypeDefinition[] = [
  {
    id: 'item',
    flag: 'showPostItem',
    labelKey: 'marketplace:postType.item.label',
    hintKey: 'marketplace:postType.item.hint',
    queryable: true,
    isService: false,
  },
  {
    id: 'sublease',
    flag: 'showPostSublease',
    browseFlag: 'showBrowseSublease',
    labelKey: 'marketplace:postType.sublease.label',
    hintKey: 'marketplace:postType.sublease.hint',
    queryable: true,
    isService: false,
  },
  {
    id: 'request_help',
    flag: 'showPostRequestHelp',
    labelKey: 'marketplace:postType.request_help.label',
    hintKey: 'marketplace:postType.request_help.hint',
    queryable: true,
    isService: true,
  },
  {
    id: 'offer_help',
    flag: 'showPostOfferHelp',
    labelKey: 'marketplace:postType.offer_help.label',
    hintKey: 'marketplace:postType.offer_help.hint',
    queryable: true,
    isService: true,
  },
] as const;

export function getPostTypeDefinition(id: PostType): PostTypeDefinition {
  // Non-null: POST_TYPE_DEFINITIONS covers every member of POST_TYPES, and the
  // exhaustiveness is asserted in src/test/postTypes.test.ts.
  return POST_TYPE_DEFINITIONS.find((d) => d.id === id)!;
}

export function isPostTypeEnabled(id: PostType, flags: Pick<FeatureFlags, PostTypeDefinition['flag']>): boolean {
  return flags[getPostTypeDefinition(id).flag];
}

/** Types this university may POST. Order follows the registry. */
export function enabledPostTypes(
  flags: Pick<FeatureFlags, PostTypeDefinition['flag']>,
): PostTypeDefinition[] {
  return POST_TYPE_DEFINITIONS.filter((d) => d.id !== 'sublease' && flags[d.flag]);
}

/**
 * The type a `?type=` deep link should preselect in the create flow, or null to
 * leave the picker on its default.
 *
 * The POSTING flag, never `browseFlag`. Browsing and posting were split on
 * 2026-08-17 precisely because they differ per tenant: a CMU student may READ
 * every Oakland sublease and post none (their building registry is empty, so the
 * composer is a dead end). A link out of that read-only surface must therefore
 * land on the picker, not on a sublease form they cannot submit — the deep link
 * is a shortcut past a question already answered, not past a gate.
 *
 * `getPostTypeSchema` is the second half for the same reason PostTypePicker
 * disables a schemaless type: there is nothing to compose against.
 */
export function deepLinkPostType(
  search: string,
  flags: Pick<FeatureFlags, PostTypeDefinition['flag']>,
): PostType | null {
  const requested = parsePostTypeParam(new URLSearchParams(search).get(POST_TYPE_PARAM));
  if (!requested) return null;
  if (!isPostTypeEnabled(requested, flags)) return null;
  if (getPostTypeSchema(requested) === null) return null;
  return requested;
}

/** The flags `feedPostTypes` reads: every posting gate, plus the browse-only ones. */
export type FeedPostTypeFlags = Pick<
  FeatureFlags,
  PostTypeDefinition['flag'] | NonNullable<PostTypeDefinition['browseFlag']>
>;

/**
 * Types this university may FILTER the feed by — queryable, and open for BROWSING.
 *
 * Not `enabledPostTypes().filter(queryable)`: that read the posting gate, which is
 * a different question. See `browseFlag`.
 */
export function feedPostTypes(flags: FeedPostTypeFlags): PostTypeDefinition[] {
  return POST_TYPE_DEFINITIONS.filter(
    (d) => d.id !== 'sublease' && d.queryable && flags[d.browseFlag ?? d.flag],
  );
}

/**
 * Legacy boolean discriminator. Superseded by the `post_type` column (migration
 * 20260910000000), which keeps `is_sublease` in sync by trigger. Kept because
 * older readers — the roommate cross-links, seeded fixtures — still speak it.
 */
export function postTypeIsSublease(id: PostType): boolean {
  return id === 'sublease';
}

/** Does this type run the open -> claimed -> completed lifecycle? */
export function isServicePostType(id: PostType): boolean {
  return getPostTypeDefinition(id).isService;
}

/**
 * The structured task categories a service post can carry. Mirrors
 * `marketplace_listings_service_category_check`; changing one means changing
 * both, and src/test/postTypes.test.ts pins the list.
 *
 * THERE IS NO CATCH-ALL, and adding one would undo the rest of this file. The
 * vocabulary is the control: no license-gated trade (nails, hair, massage,
 * anything medical) and no food category can be posted, because there is
 * nothing to post them as. An "other" bucket is exactly the hole those go
 * through, which is why the five provisional values from migration
 * 20260910000000 — including `other` — were retired by 20260924000000 rather
 * than kept alongside these.
 */
export const SERVICE_CATEGORIES = [
  // LOCAL — the provider has to physically be there.
  'move_help',
  'rides',
  'tech_repair',
  'printing',
  'photography',
  // REMOTE — deliverable over a link.
  'tutoring',
  'resume_review',
  'design',
  'editing',
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

/**
 * How far a category can travel. Mirrors `public.service_category_scope()`.
 *
 * `local` reaches whoever the school's marketplace group reaches — geography,
 * not enrollment, which is the whole point: a student a block away at another
 * school is nearer than one across town at yours. `remote` may cross schools
 * outright, and is gated OFF (see SHOW_REMOTE_SERVICES) until the published
 * Privacy §5 covers more than "partner schools in your area".
 */
export const SERVICE_CATEGORY_SCOPE: Readonly<Record<ServiceCategory, 'local' | 'remote'>> = {
  move_help: 'local',
  rides: 'local',
  tech_repair: 'local',
  printing: 'local',
  photography: 'local',
  tutoring: 'remote',
  resume_review: 'remote',
  design: 'remote',
  editing: 'remote',
};

export function serviceCategoryScope(category: ServiceCategory): 'local' | 'remote' {
  return SERVICE_CATEGORY_SCOPE[category];
}

/**
 * Categories a student may pick, given whether cross-school remote services are
 * open. With the flag off this is the five LOCAL categories — a remote category
 * a student can post but nobody outside their group can reach is a dead post,
 * so the picker does not offer it rather than offering it and under-delivering.
 */
export function selectableServiceCategories(remoteOpen: boolean): ServiceCategory[] {
  return SERVICE_CATEGORIES.filter((c) => remoteOpen || SERVICE_CATEGORY_SCOPE[c] === 'local');
}

/**
 * Tutoring is the one category whose ordinary use shades into academic
 * dishonesty, so it is the one category that carries explicit terms at the
 * point of posting. Copy lives in `marketplace:service.integrity.*`.
 */
export function serviceCategoryNeedsIntegrityTerms(
  category: ServiceCategory | null | undefined,
): boolean {
  return category === 'tutoring';
}

/**
 * NO PAYMENTS. A service post writes 0 into `marketplace_listings.price` and the
 * display layer hides the field entirely. `price` is NOT NULL on a live table so
 * it cannot simply be omitted, and a CHECK
 * (`marketplace_listings_service_price_zero_check`) holds it at 0 in the DB.
 *
 * DormCheck does not process, hold, escrow, split or track money between
 * students, and there is deliberately no rate, deposit or amount-owed field
 * anywhere in this flow. Whatever two students settle between themselves stays
 * between them.
 */
export const SERVICE_POST_PRICE = 0;

/** Service lifecycle, in order. Mirrors the DB's per-type status CHECK. */
export const SERVICE_STATUSES = ['open', 'claimed', 'completed'] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

/**
 * Which statuses the feed shows for a given type. Items keep the pair they
 * always had (`pending` is "promised to a buyer", still worth showing with a
 * badge); a service post is worth showing until it is finished, so a claimed one
 * stays visible and reads as taken.
 */
export function feedStatusesFor(id: PostType): string[] {
  return isServicePostType(id) ? ['open', 'claimed'] : ['available', 'pending'];
}

/**
 * Per-type form schema for the create flow. Only the requirement set differs
 * today; the composer, draft persistence, photo gallery and submit path are
 * shared. A type with no entry here is not postable — the picker disables it,
 * so there is no path that reaches submit with a missing schema.
 */
export type PostTypeFormSchema = {
  requiresTitle: boolean;
  requiresPhotos: boolean;
  requiresPrice: boolean;
  requiresPaymentMethods: boolean;
  /**
   * The structured sublease block (dates, building, utilities, furnished,
   * parking, gender preference). When true the flow also stops asking for a
   * free-text title — see `subleaseTitle()` in src/lib/subleases.ts.
   */
  requiresSubleaseTerms: boolean;
  /** Item-shaped fields: category, condition, multi-item photo tagger. */
  showsItemFields: boolean;
  /**
   * The free-text description box. Off for a sublease: a sublease's prose lives
   * in `house_rules`/`additional_rules`, which render last and never as a
   * headline. Two free-text boxes would just reintroduce the one we removed.
   */
  showsDescription: boolean;
  /**
   * Whether posting this type requires a VERIFIED LISTER (confirmed university
   * email + a housing record). Enforced in RLS by `public.can_post_sublease()`
   * — migration 20260907000000. The client flag exists so the picker can say
   * why, not to be the gate.
   */
  requiresVerifiedLister: boolean;
  /**
   * The structured service block: task category (required), date, estimated
   * duration, location and a short note. Mutually exclusive with the item and
   * sublease blocks — a post is one shape or the other.
   */
  requiresServiceDetails: boolean;
  /**
   * The "More details" handoff block: the price-negotiable toggle and the meetup
   * location. Both describe handing an OBJECT over for money, so both are off for
   * a service post — a negotiate-the-price control on a priceless type is the
   * no-payments rule broken at the surface, not just in copy, and "Where" is
   * already a structured service field.
   */
  showsHandoffDetails: boolean;
  /**
   * Copy keys for the free-text title field. Absent when the type has no title
   * input at all (a sublease's title IS its building). Per-type because "Give
   * your item a title" is a sentence about an object, and a request for help is
   * not one.
   */
  titleKeys?: { blocked: string; placeholder: string };
  /** i18n key for the create page's H1. */
  headingKey: string;
};

export const POST_TYPE_SCHEMAS: Partial<Record<PostType, PostTypeFormSchema>> = {
  // Byte-for-byte the item flow that shipped before this refactor: photo,
  // title, price (or tagged items), at least one payment method.
  item: {
    requiresTitle: true,
    requiresPhotos: true,
    requiresPrice: true,
    requiresPaymentMethods: true,
    requiresSubleaseTerms: false,
    showsItemFields: true,
    showsDescription: true,
    requiresVerifiedLister: false,
    requiresServiceDetails: false,
    showsHandoffDetails: true,
    titleKeys: {
      blocked: 'marketplace:blocked.title',
      placeholder: 'housing:portal.marketplace.form.titlePlaceholder',
    },
    headingKey: 'housing:portal.marketplace.posting.postAnItem',
  },
  // Sublease (restored 2026-08-05). Photos and a monthly rent are required for
  // the same reason they are on an item — a post with neither is unevaluable.
  // Payment methods are NOT: rent is not settled through a marketplace handoff,
  // and asking implies otherwise.
  sublease: {
    requiresTitle: false,
    requiresPhotos: true,
    requiresPrice: true,
    requiresPaymentMethods: false,
    requiresSubleaseTerms: true,
    showsItemFields: false,
    showsDescription: false,
    requiresVerifiedLister: true,
    requiresServiceDetails: false,
    showsHandoffDetails: true,
    headingKey: 'marketplace:postType.sublease.heading',
  },
  // Service posts. NO PHOTO, NO PRICE, NO PAYMENT METHOD — a request for a hand
  // with a task has nothing to photograph and nothing to charge for, and asking
  // for either would frame the post as a transaction. Everything that makes the
  // post evaluable lives in the structured service block instead.
  request_help: {
    requiresTitle: true,
    requiresPhotos: false,
    requiresPrice: false,
    requiresPaymentMethods: false,
    requiresSubleaseTerms: false,
    showsItemFields: false,
    showsDescription: false,
    requiresVerifiedLister: false,
    requiresServiceDetails: true,
    showsHandoffDetails: false,
    titleKeys: {
      blocked: 'marketplace:blocked.titleRequestHelp',
      placeholder: 'marketplace:service.titlePlaceholderRequest',
    },
    headingKey: 'marketplace:postType.request_help.heading',
  },
  offer_help: {
    requiresTitle: true,
    requiresPhotos: false,
    requiresPrice: false,
    requiresPaymentMethods: false,
    requiresSubleaseTerms: false,
    showsItemFields: false,
    showsDescription: false,
    requiresVerifiedLister: false,
    requiresServiceDetails: true,
    showsHandoffDetails: false,
    titleKeys: {
      blocked: 'marketplace:blocked.titleOfferHelp',
      placeholder: 'marketplace:service.titlePlaceholderOffer',
    },
    headingKey: 'marketplace:postType.offer_help.heading',
  },
};

export function getPostTypeSchema(id: PostType): PostTypeFormSchema | null {
  return POST_TYPE_SCHEMAS[id] ?? null;
}
