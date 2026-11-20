// Room variant type for individual room configurations within a building
export interface RoomVariant {
  id: string;
  roomType: string;
  rate: number;
  capacity?: string | null;
  dimensions?: string | null;
  description?: string | null;
}

export interface Dorm {
  id: string;
  name: string;
  image: string;
  badges: ('available' | 'suite' | 'highrise')[];
  semesterRate: number;
  minRate?: number; // Lowest price among grouped room types
  rentPeriod?: 'month' | 'semester' | null; // From master_housing.rent_period; drives "/ month" vs "/ semester" label
  rent_period?: string; // Raw DB column: 'semester' or 'month'
  roomTypes?: string[]; // List of room type variations (e.g., ['Single', 'Double', 'Suite'])
  variants?: RoomVariant[]; // All room configurations for this building
  laundryPrice: string;
  /** From master_housing.meal_plan_options (boolean). Drives "Meal Plan Required" vs "No Meal Plan Required". */
  mealPlanRequired: boolean;
  acType: 'Central' | 'Window Unit' | 'None';
  /** Derived from heat_and_air_conditioning DB column: true if building has AC. */
  heat_and_air_conditioning?: boolean;
  description: string;
  audienceType: 'Freshman' | 'Upperclassman';
  // Extended fields from database
  address?: string | null;
  mailingAddress?: string | null;
  capacity?: string | null;
  /** From master_housing.floors (number). Display as e.g. "10 Floors". */
  floors?: number | null;
  latitude?: number;
  longitude?: number;
  housingType?: string | null;
  roomBreakdown?: string | null;
  roomDimensions?: string | null;
  buildingAmenities?: string | null;
  inroomAmenities?: string | null;
  /** Living Learning Community name, e.g. 'Pitt Business (LLC)' */
  buildingLLC?: string | null;
  /** All Living Learning Communities (for buildings with multiple LLCs) */
  buildingLLCs?: string[];
  floorplan?: string | null;
  gallery?: string | null;
  whoLivesHere?: string | null;
  residentAssistant?: string | null;
  /** Parsed from master_housing.resident_director. Format: 'Name, Phone, Email' or 'Name, Phone, Email, Location' */
  residentDirector?: string | null;
  /** From master_housing.community_type (e.g., 'Single Gender or Gender Inclusive Housing') */
  communityType?: string | null;
  adaAccommodations?: string | null;
  shuttleAccess?: string | null;
  terms?: string | null;
  importantDates?: string | null;
  /** Move-in day logistics (all optional, set by admin via DormEditPage CMS). */
  moveInDate?: string | null;          // ISO 'YYYY-MM-DD' from Postgres date column
  moveInParkingLot?: string | null;
  moveInTimeWindow?: string | null;
  moveInEntrance?: string | null;
  moveInCartLocation?: string | null;
  moveInNotes?: string | null;
  // Sub-buildings for complexes like Bouquet Gardens
  subBuildings?: {
    letter: string;
    address: string | null;
    mailingAddress: string | null;
    roomBreakdown: string | null;
    id: number;
  }[];
  // If any row in the residence_hall group matches the tab, the whole building is shown there
  hasUpperclassRow?: boolean;
  hasFreshmanRow?: boolean;
}

export interface RoomPhoto {
  id: string;
  dormId: string;
  imageUrl: string;
  userName: string;
  roomType: string;
  likes: number;
  rating: number;
}

export interface UserProfile {
  name: string;
  major: string;
  year: 'Freshman' | 'Sophomore' | 'Junior' | 'Senior';
  avatar?: string;
}

/**
 * Readiness lifecycle: need → bought → packed (packed mirrors is_checked),
 * plus "skip" (leave-at-home side-state). 'bought' is surfaced as "Have" in the
 * v2 UI (own it, not yet packed). "Shared" is not a status - it is derived at
 * render from `assigned_to` (a roommate is bringing it).
 */
export type ChecklistItemStatus = 'need' | 'bought' | 'packed' | 'skip';

/** Move-in checklist item (Supabase checklist_items table) */
export interface ChecklistItem {
  id: string;
  user_id: string;
  category: string;
  item: string;        // Main text (Editable)
  description?: string | null;  // Sub-note (deprecated; kept for migration)
  is_checked: boolean;
  status?: ChecklistItemStatus | null;
  /** When true, show on Checkout as an item to buy (separate from packed/done). */
  needs_purchase?: boolean | null;
  is_custom: boolean;
  /** null = personal list, set = shared group checklist */
  group_id?: string | null;
  link?: string | null;
  link_title?: string | null;
  link_image?: string | null;
  /** Product image from Shop Essentials (amazon_products); not the link-preview OG image. */
  image_url?: string | null;
  /** Chosen Shop Essentials variant label (e.g. "Pink"); image_url/link carry the variant image/link. */
  variant_label?: string | null;
  /** Estimated cost in USD */
  estimated_price?: number | null;
  /** When true, divide price by group size for My Share (group context only) */
  split_cost?: boolean | null;
  /** User IDs who share this item cost. Null/empty = 100% claimed by one person. */
  split_participant_ids?: string[] | null;
  /** Custom split: { "userId": percentage }. Null = equal split among participants. Sum must = 100. */
  split_percentages?: Record<string, number> | null;
  /** Single assignee for group lists ("you bring the microwave"); null = unassigned */
  assigned_to?: string | null;
  /** Checklist v2: true = a first-24-hours essential, pinned to the Night One kit band. */
  is_night_one?: boolean | null;
  created_at?: string;
  /** Display order: sections by min(order_index); items within section by order_index ascending. */
  order_index?: number | null;
  /** Group view: owner display name */
  owner_name?: string | null;
  /** Group view: owner avatar URL */
  owner_avatar?: string | null;
  /** Group view: true if current user owns this item */
  is_owner?: boolean;
  /** Custom Lucide icon name; when set, used instead of category icon */
  icon_name?: string | null;
}

/** Image-positioned product tag for room setups (x, y as 0–1 percentages) */
export interface SetupTag {
  x: number;
  y: number;
  product_name: string;
  product_link: string;
  photo_index?: number; // For multi-photo setups; 0 = first/cover photo
}

/**
 * Individually sellable item within a multi-item marketplace listing.
 * x/y are 0-1 normalized positions on the photo at photo_index; both null when
 * the item is listed without a tag on the photo.
 */
export interface MarketplaceListingItem {
  id: string;
  listing_id: string;
  name: string;
  price: number;
  status: 'available' | 'sold';
  x: number | null;
  y: number | null;
  photo_index: number;
}
