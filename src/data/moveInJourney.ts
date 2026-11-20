/**
 * Move-in journey: the chronological spine for the Checklist "Move In" tab.
 *
 * The arrival reference content lives in `moveInArrival.ts` and the per-step
 * plan in `moveInSteps.ts`. This module re-shapes the time-sensitive parts into
 * an ordered set of PHASES (before move-in → move-in day → Welcome Week →
 * settled in) plus a day-by-day Welcome Week schedule, so the UI can present
 * one timeline a student walks down instead of a wall of scraped text.
 *
 * Dates are 2026 (source: studentaffairs.pitt.edu Welcome Week 2026). Update
 * annually alongside `moveInArrival.ts`.
 */

import { DEFAULT_UNIVERSITY } from '@/config/universities';

export type MoveInPhaseId = 'before' | 'day' | 'campus-ready' | 'welcome' | 'settled';

export interface MoveInPhaseMeta {
  id: MoveInPhaseId;
  title: string;
  /** One-line orientation shown under the phase title. */
  blurb: string;
}

export const MOVE_IN_PHASES: MoveInPhaseMeta[] = [
  {
    id: 'before',
    title: 'Before move-in',
    blurb: 'Knock these out in the weeks before you arrive.',
  },
  {
    id: 'day',
    title: 'Move-in day',
    blurb: 'Your assigned arrival day - check in, unload, settle your room.',
  },
  {
    id: 'campus-ready',
    title: 'Campus Ready',
    blurb: 'Days 2–3 after arrival - lock down your Pitt ID, dining plan, and campus accounts.',
  },
  {
    id: 'welcome',
    title: 'Welcome Week',
    blurb: 'A week of events to meet people and learn campus.',
  },
  {
    id: 'settled',
    title: 'Settled in',
    blurb: 'The first weeks - dial in the day-to-day before classes hit.',
  },
];

/** Welcome Week 2026 span (Aug 17–23). Drives which phase is "current". */
export const WELCOME_WEEK_RANGE = {
  start: '2026-08-17',
  end: '2026-08-23',
  label: 'Aug 17 – 23, 2026',
  scheduleUrl: 'https://experience.pitt.edu/home_login',
} as const;

export interface WelcomeWeekEvent {
  id: string;
  title: string;
  /** Display-only time string, e.g. "2–3 p.m.". */
  time?: string;
  location?: string;
  /** Pitt-required for new students (vs. an optional highlight). */
  required?: boolean;
}

export interface WelcomeWeekDay {
  id: string;
  /** Short weekday + date, e.g. "Mon, Aug 17". */
  label: string;
  events: WelcomeWeekEvent[];
}

/**
 * Welcome Week 2026 broken out day by day. Required events are checkable in the
 * UI; highlights are optional. Days with no curated event still render so the
 * week reads as a continuous timeline (pointing to ExperiencePitt for the live
 * list). Source: studentaffairs.pitt.edu/new-student-programs/welcome-week-2026.
 */
export const WELCOME_WEEK_DAYS: WelcomeWeekDay[] = [
  {
    id: 'ww-mon',
    label: 'Mon, Aug 17',
    events: [
      {
        id: 'ww-convocation',
        title: 'New Student Convocation',
        time: '2–3 p.m.',
        location: 'Petersen Events Center',
        required: true,
      },
      {
        id: 'ww-class-photo',
        title: 'Class Photo',
        time: '3–3:30 p.m.',
        location: 'Petersen Events Center',
        required: true,
      },
      {
        id: 'ww-floor-meetings',
        title: 'Residence Hall Floor Meetings',
        time: '6 p.m. & 7:30 p.m.',
        required: true,
      },
    ],
  },
  {
    id: 'ww-tue',
    label: 'Tue, Aug 18',
    events: [
      {
        id: 'ww-community',
        title: 'Building a Pitt Community',
        time: '11 a.m.–12:30 p.m.',
        location: 'Petersen Events Center',
        required: true,
      },
      {
        id: 'ww-safety',
        title: 'Navigating Your Safety & Wellbeing',
        time: '3 sessions',
        location: 'Soldiers & Sailors',
        required: true,
      },
    ],
  },
  {
    id: 'ww-wed',
    label: 'Wed, Aug 19',
    events: [
      {
        id: 'ww-pep-rally',
        title: 'Pep Rally & Drone Show',
        time: '8 p.m.',
        location: 'Cathedral Lawn',
      },
      {
        id: 'ww-movie',
        title: 'Move on the Lawn: Legally Blonde',
        time: '9:45 p.m.',
        location: 'Cathedral Lawn',
      },
    ],
  },
  {
    id: 'ww-thu',
    label: 'Thu, Aug 20',
    events: [],
  },
  {
    id: 'ww-fri',
    label: 'Fri, Aug 21',
    events: [
      {
        id: 'ww-academic',
        title: 'Academic Program Meetings',
        time: '8:30 a.m.–1 p.m.',
        required: true,
      },
    ],
  },
  {
    id: 'ww-sat',
    label: 'Sat, Aug 22',
    events: [
      {
        id: 'ww-pantherpalooza',
        title: 'Pantherpalooza',
        time: '8–11 p.m.',
        location: 'Cathedral Lawn',
      },
    ],
  },
  {
    id: 'ww-sun',
    label: 'Sun, Aug 23',
    events: [
      {
        id: 'ww-involvement-fair',
        title: 'Involvement Fair',
        time: '1–4 p.m.',
        location: 'Petersen Events Center',
      },
      {
        id: 'ww-lantern-night',
        title: 'Lantern Night',
        time: '7:15 p.m.',
        location: 'Cathedral Lawn',
      },
    ],
  },
];

/** All checkable Welcome Week required-event ids (for phase progress counts). */
export const WELCOME_WEEK_REQUIRED_IDS: string[] = WELCOME_WEEK_DAYS.flatMap((d) =>
  d.events.filter((e) => e.required).map((e) => e.id),
);

export type UniversityMoveInJourney = {
  phases: MoveInPhaseMeta[];
  welcomeWeekRange: {
    start: string;
    end: string;
    label: string;
    scheduleUrl: string;
  };
  welcomeWeekDays: WelcomeWeekDay[];
  welcomeWeekRequiredIds: string[];
};

const CMU_MOVE_IN_PHASES: MoveInPhaseMeta[] = MOVE_IN_PHASES.map((phase) =>
  phase.id === 'campus-ready'
    ? { ...phase, title: 'Campus ready', blurb: 'Confirm your CMU ID, dining, housing, and safety essentials.' }
    : phase,
);

const CMU_WELCOME_RANGE = {
  start: '2026-08-15',
  end: '2026-08-23',
  label: 'Aug 15 – 23, 2026',
  scheduleUrl: 'https://www.cmu.edu/housing/',
};

const CMU_WELCOME_DAYS: WelcomeWeekDay[] = [
  {
    id: 'cmu-first-year-arrival',
    label: 'Sat, Aug 15',
    events: [{ id: 'cmu-first-year-move-in', title: 'First-year move-in day', required: true }],
  },
  {
    id: 'cmu-upperclass-arrival',
    label: 'Wed–Sun, Aug 19–23',
    events: [
      {
        id: 'cmu-upperclass-move-in',
        title: 'Upper-class move-in by reserved Housing Portal timeslot',
        required: true,
      },
    ],
  },
];

const CARLOW_MOVE_IN_PHASES: MoveInPhaseMeta[] = [
  { id: 'before', title: 'Before move-in', blurb: 'Confirm your assignment, arrival group, and residence instructions.' },
  { id: 'day', title: 'Move-in day', blurb: 'Check in, unload, and settle into your assigned hall.' },
  { id: 'campus-ready', title: 'Campus ready', blurb: 'Save Carlow contacts and finish your residence essentials.' },
  { id: 'welcome', title: 'Welcome and matriculation', blurb: 'Meet the Carlow community before classes begin.' },
  { id: 'settled', title: 'Settled in', blurb: 'Learn your building routines and prepare for the semester.' },
];

const CARLOW_WELCOME_RANGE = {
  start: '2026-08-26',
  end: '2026-08-30',
  label: 'Aug 26 – 30, 2026',
  scheduleUrl: 'https://www.carlow.edu/academic-programs/academic-information/academic-calendar/',
};

const CARLOW_WELCOME_DAYS: WelcomeWeekDay[] = [
  {
    id: 'carlow-first-year-arrival',
    label: 'Wed, Aug 26',
    events: [{ id: 'carlow-first-year-move-in', title: 'New first-year residence halls open at 8 a.m.', required: true }],
  },
  {
    id: 'carlow-matriculation',
    label: 'Thu, Aug 27',
    events: [{ id: 'carlow-welcome-matriculation', title: 'Welcome and Matriculation', required: true }],
  },
  {
    id: 'carlow-returning-arrival',
    label: 'Sat, Aug 29',
    events: [{ id: 'carlow-returning-move-in', title: 'Returning and transfer residence halls open at 8 a.m.', required: true }],
  },
];

/**
 * Journey content keyed by university slug (see `src/config/universities.ts`).
 * Pitt is the only entry until university #2 lands; unknown slugs fall back to
 * the default university's content.
 */
const MOVE_IN_JOURNEYS: Record<string, UniversityMoveInJourney> = {
  pitt: {
    phases: MOVE_IN_PHASES,
    welcomeWeekRange: WELCOME_WEEK_RANGE,
    welcomeWeekDays: WELCOME_WEEK_DAYS,
    welcomeWeekRequiredIds: WELCOME_WEEK_REQUIRED_IDS,
  },
  cmu: {
    phases: CMU_MOVE_IN_PHASES,
    welcomeWeekRange: CMU_WELCOME_RANGE,
    welcomeWeekDays: CMU_WELCOME_DAYS,
    welcomeWeekRequiredIds: ['cmu-first-year-move-in', 'cmu-upperclass-move-in'],
  },
  carlow: {
    phases: CARLOW_MOVE_IN_PHASES,
    welcomeWeekRange: CARLOW_WELCOME_RANGE,
    welcomeWeekDays: CARLOW_WELCOME_DAYS,
    welcomeWeekRequiredIds: [
      'carlow-first-year-move-in',
      'carlow-welcome-matriculation',
      'carlow-returning-move-in',
    ],
  },
};

export function getMoveInJourney(
  slug: string = DEFAULT_UNIVERSITY.slug,
): UniversityMoveInJourney {
  return MOVE_IN_JOURNEYS[slug] ?? MOVE_IN_JOURNEYS[DEFAULT_UNIVERSITY.slug];
}

/**
 * Pick the phase a student is most likely acting on right now, from their
 * assigned move-in date (local-midnight `Date`, or null if unset) and today.
 * Soft signal only - every phase stays visible; this just decides which one
 * auto-expands.
 */
export function resolveCurrentPhase(
  moveInDate: Date | null,
  today: Date,
  welcomeStart: Date,
  welcomeEnd: Date,
): MoveInPhaseId {
  if (!moveInDate) return 'before';
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);
  const moveDay = new Date(moveInDate);
  moveDay.setHours(0, 0, 0, 0);

  if (startOfToday < moveDay) return 'before';
  if (startOfToday.getTime() === moveDay.getTime()) return 'day';
  // After move-in day but before Welcome Week kicks off → the campus-ready admin days.
  if (startOfToday < welcomeStart) return 'campus-ready';
  if (startOfToday <= welcomeEnd) return 'welcome';
  return 'settled';
}
