import type { LucideIcon } from 'lucide-react';
import { DEFAULT_UNIVERSITY } from '@/config/universities';
import {
  Key,
  IdCard,
  Package,
  Calendar,
  CheckCircle,
  Building2,
  Truck,
  Coffee,
  Smartphone,
  ShieldCheck,
  Wallet,
} from 'lucide-react';

export type MoveInStepIcon =
  | 'key'
  | 'id'
  | 'box'
  | 'calendar'
  | 'check'
  | 'building'
  | 'truck'
  | 'coffee'
  | 'phone'
  | 'shield'
  | 'wallet';

export const MOVE_IN_STEP_ICONS: Record<MoveInStepIcon, LucideIcon> = {
  key: Key,
  id: IdCard,
  box: Package,
  calendar: Calendar,
  check: CheckCircle,
  building: Building2,
  truck: Truck,
  coffee: Coffee,
  phone: Smartphone,
  shield: ShieldCheck,
  wallet: Wallet,
};

export type MoveInStep = {
  id: string;
  order: number;
  title: string;
  /** Must match a name in this school's `campusMapData` registry for walking-time lookup. */
  building?: string;
  /** Display-only string, e.g. "1st floor", "Loading Zone B" - no walking-time semantic. */
  locationLabel?: string;
  /** Day offset from move-in day: 0 = move-in day, -1 = day before, 1 = day after. */
  dayOffset: number;
  /** Display-only time string, e.g. "9 AM", "7 PM". */
  timeLabel?: string;
  bringList?: string[];
  notes?: string;
  href?: string;
  hrefLabel?: string;
  icon?: MoveInStepIcon;
};

export type DormMoveInPlan = {
  /** Case-insensitive exact match against `Dorm.name`. List all aliases. */
  dormNames: string[];
  steps: MoveInStep[];
};

// V1 starter: Litchfield only. Other 7 priority dorms are content TODOs.
// Pitt content - registered under the 'pitt' slug in MOVE_IN_CONTENT below.
export const MOVE_IN_PLANS: DormMoveInPlan[] = [
  {
    dormNames: [
      'Litchfield Towers A',
      'Litchfield Towers B',
      'Litchfield Towers C',
      'Litchfield Towers',
      'Litchfield',
    ],
    steps: [
      {
        id: 'litchfield-loading',
        order: 1,
        title: 'Loading dock',
        locationLabel: 'Loading Zone B',
        dayOffset: 0,
        timeLabel: 'Per your assigned slot',
        notes:
          'Follow staff direction to your cart. Carts are first-come within your time window.',
        icon: 'truck',
      },
      {
        id: 'litchfield-parking',
        order: 2,
        title: 'Parking & dining',
        locationLabel: 'Forbes Garage · Eatery · The Porch',
        dayOffset: 0,
        notes:
          'Family parking validation available at Panther Central. Grab a bite before unloading - lines build up.',
        icon: 'coffee',
      },
      {
        id: 'litchfield-orientation',
        order: 4,
        title: 'New Student Orientation',
        building: 'Peterson Events Center',
        dayOffset: 1,
        timeLabel: '9:00 AM',
        notes:
          'Required for all new students. Sessions run until ~3 PM with lunch provided.',
        href: 'https://www.studentaffairs.pitt.edu/new-student-orientation/',
        hrefLabel: 'Orientation details',
        icon: 'calendar',
      },
      {
        id: 'litchfield-floor-meeting',
        order: 5,
        title: 'Floor meeting',
        locationLabel: "Your floor lounge - check your RA's door for room number",
        dayOffset: 1,
        timeLabel: '7:00 PM',
        notes:
          'Meet your RA and floormates. Quiet hours and floor norms get set here.',
        icon: 'building',
      },
    ],
  },
];

/** Used when the user's dorm doesn't match any curated plan. */
export const DEFAULT_MOVE_IN_PLAN: MoveInStep[] = [
  // The week before (dayOffset -7 … -1)
  {
    id: 'default-confirm-move-in-time',
    order: 1,
    title: 'Confirm your move-in time',
    dayOffset: -7,
    notes:
      'Pitt assigns you a date and window; find it in your housing email and set it here so the rest of these dates fill in.',
    icon: 'calendar',
  },
  {
    id: 'default-coordinate-roommate',
    order: 2,
    title: 'Coordinate with your roommate',
    dayOffset: -6,
    notes:
      "Compare lists so you don't both bring a fridge, fan, and rug.",
    icon: 'check',
  },
  {
    id: 'default-ship-vs-carry',
    order: 3,
    title: 'Decide what to ship vs carry',
    dayOffset: -5,
    notes:
      'Bulky or heavy items are easier shipped ahead than hauled up.',
    icon: 'truck',
  },
  {
    id: 'default-pack-night-one-bag',
    order: 4,
    title: 'Pack a night-one bag',
    dayOffset: -2,
    bringList: [
      'Bedding',
      'Towel',
      'Toiletries',
      'Charger',
      'Meds',
      'One change of clothes',
    ],
    notes: 'Keep this bag separate from everything else you are moving.',
    icon: 'box',
  },
  {
    id: 'default-panther-card',
    order: 5,
    title: 'Set up your Panther Card',
    dayOffset: -1,
    notes:
      'Your Pitt ID for building and dining access; have it ready before move-in day.',
    icon: 'id',
  },
  // Move-in day (dayOffset 0)
  {
    id: 'default-arrive-in-window',
    order: 6,
    title: 'Arrive in your window',
    dayOffset: 0,
    timeLabel: 'Per your assigned slot',
    notes:
      "Unload first, then move your car; don't park to fully unpack.",
    icon: 'truck',
  },
  {
    id: 'default-check-in',
    order: 7,
    title: 'Check in and get your room access',
    locationLabel: "Your building's front desk",
    dayOffset: 0,
    notes: 'Pick up your key or activate card access before heading upstairs.',
    icon: 'key',
  },
  {
    id: 'default-night-one-bag-first',
    order: 8,
    title: 'Bring the night-one bag up first',
    dayOffset: 0,
    notes: 'Essentials before the big stuff.',
    icon: 'box',
  },
  {
    id: 'default-get-online',
    order: 9,
    title: 'Get online',
    dayOffset: 0,
    notes: "Connect your phone and laptop to Pitt's wifi when you arrive.",
    icon: 'check',
  },
  {
    id: 'default-find-ra',
    order: 10,
    title: 'Find your RA and floor',
    dayOffset: 0,
    notes: 'Introduce yourself early.',
    icon: 'building',
  },
  // The first few days (dayOffset 1 … 2)
  {
    id: 'default-test-before-buy',
    order: 11,
    title: 'Test before you buy',
    dayOffset: 1,
    notes:
      'Feel the mattress before grabbing a topper; check what the room actually needs before another store run.',
    icon: 'check',
  },
  {
    id: 'default-locate-essentials',
    order: 12,
    title: 'Locate the essentials nearby',
    dayOffset: 2,
    notes: 'Closest dining, laundry, and package pickup.',
    icon: 'coffee',
  },
  {
    id: 'default-welcome-week',
    order: 13,
    title: 'Go to Welcome Week events',
    dayOffset: 2,
    notes: 'Easiest way to meet people before classes.',
    icon: 'calendar',
  },
];

/**
 * "Campus Ready" phase (days 2–3 after arrival, before Welcome Week): the admin
 * tasks every student does once they're moved in - Pitt ID, email/account
 * setup, dining, and the key campus apps. Universal (not dorm-specific) and kept
 * separate from `DEFAULT_MOVE_IN_PLAN` so it doesn't mix into the day-offset
 * "settled in" bucket.
 */
export const CAMPUS_READY_STEPS: MoveInStep[] = [
  {
    id: 'campus-ready-pitt-id',
    order: 1,
    title: 'Pick up your Pitt ID card',
    locationLabel: 'Panther Central · 1st floor, Litchfield Towers lobby',
    dayOffset: 1,
    notes:
      'Your Pitt ID gets you into buildings, dining, and the library. Bring a photo ID.',
    icon: 'id',
  },
  {
    id: 'campus-ready-pitt-email',
    order: 2,
    title: 'Activate your Pitt email & Microsoft 365',
    dayOffset: 1,
    notes: 'Set up your @pitt.edu account so you get class and housing notices.',
    icon: 'check',
  },
  {
    id: 'campus-ready-duo-2fa',
    order: 3,
    title: 'Set up two-factor authentication (Duo)',
    dayOffset: 1,
    notes:
      'Required on all Pitt accounts - install Duo Mobile and enroll your phone.',
    icon: 'shield',
  },
  {
    id: 'campus-ready-dining',
    order: 4,
    title: 'Confirm or activate your dining plan',
    dayOffset: 1,
    notes: 'Check your meal plan is active before the dining halls get busy.',
    icon: 'coffee',
  },
  {
    id: 'campus-ready-panther-funds',
    order: 5,
    title: 'Add Panther Funds to your Pitt ID',
    dayOffset: 2,
    notes: 'Optional, but handy for laundry, printing, and on-campus purchases.',
    icon: 'wallet',
  },
  {
    id: 'campus-ready-pittmobile',
    order: 6,
    title: 'Download the PittMobile app',
    dayOffset: 2,
    notes: 'Schedules, campus map, events, and emergency alerts in one place.',
    icon: 'phone',
  },
  {
    id: 'campus-ready-pitt-rec',
    order: 7,
    title: 'Download the Pitt Rec app',
    dayOffset: 2,
    notes: 'Reserve fitness center / RSST sessions if you plan to use campus rec.',
    icon: 'phone',
  },
  {
    id: 'campus-ready-pitt-navigate',
    order: 8,
    title: 'Download the Pitt Navigate app',
    dayOffset: 2,
    notes: 'Book academic advising and tutoring appointments.',
    icon: 'phone',
  },
  {
    id: 'campus-ready-campus-police',
    order: 9,
    title: 'Save the Campus Police number',
    dayOffset: 2,
    notes: 'Pitt Police: (412) 624-2121 - save it in your phone now.',
    icon: 'shield',
  },
];

export type UniversityMoveInContent = {
  plans: DormMoveInPlan[];
  defaultPlan: MoveInStep[];
  campusReadySteps: MoveInStep[];
};

const CMU_DEFAULT_MOVE_IN_PLAN: MoveInStep[] = [
  {
    id: 'cmu-timeslot',
    order: 1,
    title: 'Confirm your Housing Portal timeslot',
    dayOffset: -1,
    notes:
      'CMU requires upper-class residents to reserve an arrival time in the Housing Portal. First-year students should follow the arrival details attached to their assignment.',
    href: 'https://www.cmu.edu/housing/',
    hrefLabel: 'CMU Housing Portal and move-in guidance',
    icon: 'calendar',
  },
  {
    id: 'cmu-check-in',
    order: 2,
    title: 'Check in at your assigned residence',
    dayOffset: 0,
    timeLabel: 'During your assigned window',
    bringList: ['Photo ID', 'Housing assignment', 'Move-in timeslot confirmation'],
    notes: 'Follow the unloading and check-in directions sent for your building.',
    icon: 'key',
  },
  {
    id: 'cmu-unload',
    order: 3,
    title: 'Unload, then clear the loading area',
    dayOffset: 0,
    notes:
      'Move the vehicle after unloading so the next household can use the limited arrival zone. Red carts are available at Residence on Fifth during desk hours.',
    href: 'https://www.cmu.edu/housing/upperclass-move-in/',
    hrefLabel: 'Official CMU move-in instructions',
    icon: 'truck',
  },
];

const CMU_CAMPUS_READY_STEPS: MoveInStep[] = [
  {
    id: 'cmu-room-details',
    order: 1,
    title: 'Verify your room and roommate details',
    dayOffset: -1,
    notes:
      'Room assignments appear in Student Information Online; apartment- and suite-mate details are available in the Housing Portal.',
    icon: 'building',
  },
  {
    id: 'cmu-maintenance',
    order: 2,
    title: 'Bookmark Housing maintenance',
    dayOffset: 1,
    notes: 'Submit non-emergency residence maintenance requests through the Housing and Dining Portal.',
    href: 'https://www.cmu.edu/housing/resident-services/',
    hrefLabel: 'CMU resident services',
    icon: 'phone',
  },
  {
    id: 'cmu-campus-police',
    order: 3,
    title: 'Save CMU Police',
    dayOffset: 1,
    notes: 'CMU Police non-emergency: 412-268-2323. Call 911 for an emergency.',
    icon: 'shield',
  },
];

const CARLOW_DEFAULT_MOVE_IN_PLAN: MoveInStep[] = [
  {
    id: 'carlow-arrival-date',
    order: 1,
    title: 'Confirm your residence opening day',
    dayOffset: -1,
    notes:
      'For Fall 2026, new first-year residents arrive August 26 at 8 a.m.; returning and transfer residents arrive August 29 at 8 a.m. Follow any individualized Residence Life instructions.',
    href: 'https://www.carlow.edu/academic-programs/academic-information/academic-calendar/',
    hrefLabel: 'Carlow academic calendar',
    icon: 'calendar',
  },
  {
    id: 'carlow-check-in',
    order: 2,
    title: 'Check in with Residence Life',
    locationLabel: 'Frances Warde and Dougherty residence halls',
    dayOffset: 0,
    timeLabel: 'From 8 a.m.',
    bringList: ['Photo ID', 'Housing assignment', 'Move-in instructions'],
    notes: 'The connected residence halls sit in the center of Carlow’s Oakland campus.',
    href: 'https://www.carlow.edu/student-life/campus-life/housing/',
    hrefLabel: 'Carlow housing information',
    icon: 'key',
  },
  {
    id: 'carlow-room-setup',
    order: 3,
    title: 'Set up your room',
    dayOffset: 0,
    bringList: ['Twin or twin XL bedding', 'Personal essentials', 'Surge protector if permitted'],
    notes:
      'Standard doubles include beds, desks, drawers, wardrobes or closets, a micro-fridge, and a window air conditioner. Confirm bed size for your assigned room before buying linens.',
    icon: 'box',
  },
];

const CARLOW_CAMPUS_READY_STEPS: MoveInStep[] = [
  {
    id: 'carlow-residence-life',
    order: 1,
    title: 'Save Residence Life',
    dayOffset: 1,
    notes: 'Residence Life: reslife@carlow.edu · 412-578-8776.',
    href: 'https://www.carlow.edu/student-life/campus-life/housing/',
    hrefLabel: 'Carlow Residence Life',
    icon: 'phone',
  },
  {
    id: 'carlow-campus-police',
    order: 2,
    title: 'Save Campus Police',
    dayOffset: 1,
    notes: 'Carlow Campus Police non-emergency: 412-578-6007. Call 911 for an emergency.',
    icon: 'shield',
  },
  {
    id: 'carlow-break-closures',
    order: 3,
    title: 'Add residence closure dates',
    dayOffset: 2,
    notes:
      'Carlow housing closes for university breaks. Use the official academic calendar for Thanksgiving, winter, spring-break, and move-out times.',
    href: 'https://www.carlow.edu/academic-programs/academic-information/academic-calendar/',
    hrefLabel: 'Carlow academic calendar',
    icon: 'calendar',
  },
];

/**
 * Move-in content keyed by university slug (see `src/config/universities.ts`).
 * Pitt is the only entry until university #2 lands; unknown slugs fall back to
 * the default university's content so nothing renders empty.
 */
const MOVE_IN_CONTENT: Record<string, UniversityMoveInContent> = {
  pitt: {
    plans: MOVE_IN_PLANS,
    defaultPlan: DEFAULT_MOVE_IN_PLAN,
    campusReadySteps: CAMPUS_READY_STEPS,
  },
  cmu: {
    plans: [],
    defaultPlan: CMU_DEFAULT_MOVE_IN_PLAN,
    campusReadySteps: CMU_CAMPUS_READY_STEPS,
  },
  carlow: {
    plans: [],
    defaultPlan: CARLOW_DEFAULT_MOVE_IN_PLAN,
    campusReadySteps: CARLOW_CAMPUS_READY_STEPS,
  },
};

/**
 * True when curated move-in content exists for the slug. Universities without
 * an entry (e.g. CMU at activation) should get an empty state, not Pitt content
 * - the accessors below still fall back to the default university's content for
 * legacy callers, so gate the UI with this predicate first.
 */
export function hasMoveInContent(slug: string): boolean {
  return slug in MOVE_IN_CONTENT;
}

export function getMoveInContent(
  slug: string = DEFAULT_UNIVERSITY.slug,
): UniversityMoveInContent {
  return MOVE_IN_CONTENT[slug] ?? MOVE_IN_CONTENT[DEFAULT_UNIVERSITY.slug];
}

/**
 * Resolve a curated plan for the given dorm name. Match is case-insensitive
 * exact against any name in `DormMoveInPlan.dormNames`. Returns `null` when no
 * curated plan exists - callers should fall back to the default plan.
 */
export function resolveMoveInPlan(
  dormName: string | null | undefined,
  slug: string = DEFAULT_UNIVERSITY.slug,
): DormMoveInPlan | null {
  if (!dormName) return null;
  const trimmed = dormName.trim().toLowerCase();
  if (!trimmed) return null;
  return (
    getMoveInContent(slug).plans.find((p) =>
      p.dormNames.some((n) => n.toLowerCase() === trimmed),
    ) ?? null
  );
}
