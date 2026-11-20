export const POST_LOOKING = 'looking-for-roommates' as const;
export const POST_HAVE = 'have-place-need-people' as const;
export const MOVE_IN_OPTIONS = ['Fall 2026', 'Spring 2027', 'Fall 2027', 'Spring 2028'] as const;
export const PRICE_MIN = 0;
export const PRICE_MAX = 3000;
export const PRICE_STEP = 50;

export const ROOMMATE_POST_PHOTOS_BUCKET = 'roommate-post-photos';
export const MAX_ROOMMATE_POST_PHOTOS = 5;
export const UTILITIES_OPTIONS = ['WiFi', 'Electricity', 'Water', 'Gas', 'Heat', 'Trash'] as const;

export type PostType = typeof POST_LOOKING | typeof POST_HAVE;
export type GenderPreference = 'any' | 'all-female' | 'all-male';

export type ComposerPhotoItem =
  | { kind: 'url'; id: string; url: string }
  | { kind: 'file'; id: string; file: File; previewUrl: string };

export const HOUSING_ON = 'on-campus' as const;
export const HOUSING_OFF = 'off-campus' as const;
export type HousingType = typeof HOUSING_ON | typeof HOUSING_OFF;

export type ProfileEmbed = {
  full_name: string | null;
  avatar_url: string | null;
  major: string | null;
  grade_level: string | null;
  current_dorm: string | null;
  preferred_areas: string[] | null;
  instagram_username?: string | null;
  snapchat_username?: string | null;
};

export type RoommateSearchPost = {
  id: string;
  user_id: string;
  post_type: PostType;
  content: string;
  budget_max: number | null;
  address: string | null;
  housing_type: HousingType | null;
  move_in_semester: string | null;
  spots_total: number;
  spots_filled: number;
  is_active: boolean;
  interest_count: number;
  created_at: string;
  updated_at: string;
  utilities_included?: string[] | null;
  is_furnished?: boolean | null;
  parking_available?: boolean | null;
  room_type?: 'private' | 'shared' | null;
  lease_length?: 'month-to-month' | '6-months' | '12-months' | null;
  pets_allowed?: boolean | null;
  smoking_allowed?: boolean | null;
  laundry?: string | null;
  bathroom?: string | null;
  gender_preference?: GenderPreference | null;
  additional_details?: string | null;
  photos?: string[] | null;
  show_instagram?: boolean | null;
  show_snapchat?: boolean | null;
  profiles: ProfileEmbed | ProfileEmbed[] | null;
};

export type InterestRow = {
  id: string;
  user_id: string;
  message: string | null;
  created_at: string;
  profiles: ProfileEmbed | ProfileEmbed[] | null;
};

export const AVATAR_BG = [
  'bg-indigo-500',
  'bg-violet-500',
  'bg-rose-400',
  'bg-sky-500',
  'bg-amber-500',
  'bg-fuchsia-500',
  'bg-cyan-600',
  'bg-indigo-500',
] as const;
