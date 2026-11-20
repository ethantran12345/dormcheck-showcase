/**
 * Per-tenant campus building coordinates, keyed by `University.slug`.
 *
 * The move-in journey turns a step's `building` string into a Mapbox waypoint so
 * it can show a walking time from the student's dorm. That lookup used to be a
 * flat Pitt-only table (`pittCampusMapData.ts`) with a `resolveAnyPittBuilding`
 * export, which meant a CMU student whose step said "Cathedral of Learning" got
 * an Oakland waypoint and a confident, wrong walking time.
 *
 * This is the same shape `campusLandmarks.ts` was refactored into — read that
 * file first if you are adding a tenant. **An empty entry is a correct outcome.**
 * The goal is not to invent CMU coordinates; it is to make sure a CMU student
 * gets no walking time rather than a Pitt one.
 */

export interface NamedCoord {
  name: string;
  lng: number;
  lat: number;
  /** Extra line for popups */
  description?: string;
}

/**
 * A class-building entry with an optional short label for cards/chips.
 * `shortName` lets us render compact labels (e.g. "Chevron") instead of the
 * full canonical name ("Chevron Science Center").
 */
export interface CourseBuilding extends NamedCoord {
  shortName?: string;
}

/** Academic buildings students pick for courses (must match Select options / normalization) */
const PITT_COURSE_BUILDINGS: CourseBuilding[] = [
  {
    name: 'Cathedral of Learning',
    lng: -79.9532,
    lat: 40.4434,
    shortName: 'Cathedral',
    description: 'Main academic tower & language labs',
  },
  {
    name: 'Benedum Hall',
    lng: -79.9546,
    lat: 40.444,
    shortName: 'Benedum',
    description: 'Engineering',
  },
  {
    name: 'William Pitt Union',
    lng: -79.9542,
    lat: 40.4449,
    shortName: 'WPU',
    description: 'Student union & student services',
  },
  {
    name: 'Hillman Library',
    lng: -79.954,
    lat: 40.4429,
    shortName: 'Hillman',
    description: 'Main campus library',
  },
  {
    name: 'Posvar Hall',
    lng: -79.9538,
    lat: 40.4417,
    shortName: 'Posvar',
    description: 'Social sciences & offices',
  },
  {
    name: 'Lawrence Hall',
    lng: -79.9547,
    lat: 40.4416,
    shortName: 'Lawrence',
    description: 'Residence & classrooms',
  },
  {
    name: 'Alumni Hall',
    lng: -79.9536,
    lat: 40.4455,
    shortName: 'Alumni',
    description: 'Classrooms & studios',
  },
  {
    name: 'Chevron Science Center',
    lng: -79.9523,
    lat: 40.4431,
    shortName: 'Chevron',
    description: 'Natural sciences',
  },
  {
    name: 'David Lawrence Hall',
    lng: -79.9555,
    lat: 40.4413,
    shortName: 'D. Lawrence',
    description: 'Lecture halls',
  },
  {
    name: 'Fitzgerald Field House',
    lng: -79.9592,
    lat: 40.4478,
    shortName: 'Fitzgerald',
    description: 'Athletics & recreation',
  },
  {
    name: 'Trees Hall',
    lng: -79.96,
    lat: 40.4475,
    shortName: 'Trees',
    description: 'Pool & recreation',
  },
  {
    name: 'Peterson Events Center',
    lng: -79.9618,
    lat: 40.4438,
    shortName: 'Peterson',
    description: 'Basketball & events',
  },
  // Coordinates from Wikipedia/GeoHack (verified against Pitt campus map).
  {
    name: 'Sennott Square',
    lng: -79.9563,
    lat: 40.4415,
    shortName: 'Sennott',
    description: 'Computer Science, Psychology & Business',
  },
  {
    name: 'Litchfield Towers',
    lng: -79.9571,
    lat: 40.4425,
    shortName: 'Litchfield',
    description: 'Residence halls & dining',
  },
];

/** Always-visible gray reference pins */
const PITT_CAMPUS_REFERENCE_PINS: NamedCoord[] = [
  {
    name: 'Panther Central',
    lng: -79.9542,
    lat: 40.4449,
    description: 'William Pitt Union - ID cards, mail, and student services',
  },
  {
    name: 'Market Central',
    lng: -79.9585,
    lat: 40.4452,
    description: 'Main dining hall (Litchfield Towers area)',
  },
  {
    name: 'Forbes and Fifth',
    lng: -79.9572,
    lat: 40.4444,
    description: 'Retail dining on Forbes Avenue',
  },
];

/**
 * CMU has no building table on purpose — the same call as `CMU_LANDMARKS` in
 * `campusLandmarks.ts`. Nobody has surveyed coordinates for Wean, Doherty, the
 * UC or Tepper, and a guessed pin produces a walking time that is precise to the
 * minute and simply wrong. Until someone measures them, a CMU move-in step's
 * building renders as plain text with no walk estimate, which is honest. Add
 * entries here when they are verified.
 */
const CMU_COURSE_BUILDINGS: CourseBuilding[] = [];
const CMU_CAMPUS_REFERENCE_PINS: NamedCoord[] = [];

const COURSE_BUILDINGS_BY_SLUG: Record<string, CourseBuilding[]> = {
  pitt: PITT_COURSE_BUILDINGS,
  cmu: CMU_COURSE_BUILDINGS,
};

const REFERENCE_PINS_BY_SLUG: Record<string, NamedCoord[]> = {
  pitt: PITT_CAMPUS_REFERENCE_PINS,
  cmu: CMU_CAMPUS_REFERENCE_PINS,
};

/**
 * Resolve a building name for ONE school against either its academic course
 * buildings or its always-visible reference pins (Panther Central, Market
 * Central, etc.).
 *
 * Uses case-insensitive exact match for predictability.
 *
 * `slug` is required, and a school with no registry entry returns null rather
 * than falling back to Pitt — the fallback is what made this a defect.
 *
 * Returns a `NamedCoord` so the caller can use the coords directly as a
 * Mapbox waypoint.
 */
/**
 * Every surveyed destination for ONE school — academic buildings plus the
 * always-visible reference pins — deduped by name and alphabetized, for
 * "directions to a campus building" pickers. A school with no verified
 * coordinates returns `[]` (callers hide the picker rather than guess; see the
 * CMU note above).
 */
export function campusDestinationsForSlug(slug: string): CourseBuilding[] {
  const academic = COURSE_BUILDINGS_BY_SLUG[slug] ?? [];
  const seen = new Set(academic.map((b) => b.name.toLowerCase()));
  const reference = (REFERENCE_PINS_BY_SLUG[slug] ?? []).filter(
    (p) => !seen.has(p.name.toLowerCase()),
  );
  return [...academic, ...reference].sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveCampusBuilding(
  name: string | null | undefined,
  slug: string,
): NamedCoord | null {
  if (!name) return null;
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return null;

  const academic = (COURSE_BUILDINGS_BY_SLUG[slug] ?? []).find(
    (b) => b.name.toLowerCase() === trimmed,
  );
  if (academic) return { name: academic.name, lat: academic.lat, lng: academic.lng };

  const reference = (REFERENCE_PINS_BY_SLUG[slug] ?? []).find(
    (p) => p.name.toLowerCase() === trimmed,
  );
  if (reference) return { name: reference.name, lat: reference.lat, lng: reference.lng };

  return null;
}
