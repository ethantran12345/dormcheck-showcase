/**
 * Typed readers for the University of Pittsburgh's public data feeds.
 *
 * These are the same endpoints PittAPI documents, called directly. We do not
 * depend on PittAPI itself: it is GPL-2.0 Python and this is a TypeScript stack,
 * so the library serves as the map of where Pitt's data lives while the fetching
 * and parsing here are ours. Several parsers are deliberately more tolerant than
 * PittAPI's — see the notes on laundry statuses and dining nutrients.
 *
 * Every function is server-only. The browser must never call these hosts: they
 * are unofficial, rate-limited, carry no SLA, and the app CSP blocks them.
 */

import { arr, bool, int, num, obj, optionalStr, Raw, rows, str } from './pittJson.js';

const USER_AGENT = 'DormCheck/1.0 (+https://dormcheck.app)';

export class UpstreamError extends Error {
  constructor(readonly source: string, readonly status: number, message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}

async function getJson<T>(source: string, url: string, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // dineoncampus 403s without a User-Agent, and PittAPI's own BaseClient.request
    // does not set one — a trap worth not re-walking into.
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new UpstreamError(source, response.status, `${source}: HTTP ${response.status} for ${url}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Retry only what can plausibly succeed on a second try. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 500): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** (attempt - 1)));
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      // A 4xx other than 429 will not improve by asking again.
      if (error instanceof UpstreamError && error.status >= 400 && error.status < 500 && error.status !== 429) {
        throw error;
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Laundry (LaundryView)
// ---------------------------------------------------------------------------
const LAUNDRY_ROOMS_URL = 'https://www.laundryview.com/api/c_room';
const LAUNDRY_MACHINES_URL = 'https://www.laundryview.com/api/currentRoomData';

export interface LaundryRoom {
  externalId: string;
  name: string;
  campus: string;
}

export type MachineType = 'washer' | 'dryer' | 'combo';
export type MachineStatus = 'available' | 'idle' | 'in_use' | 'out_of_service' | 'offline' | 'unknown';

export interface LaundryMachine {
  externalId: string;
  label: string;
  machineType: MachineType;
  status: MachineStatus;
  statusMessage: string | null;
  minutesRemaining: number | null;
  cycleProgressPercent: number | null;
  isStacked: boolean;
}

/** LaundryView's documented status codes. Anything else degrades to 'unknown'. */
const STATUS_BY_CODE: Record<number, MachineStatus> = {
  0: 'available',
  1: 'idle',
  2: 'in_use',
  3: 'out_of_service',
  4: 'offline',
};

export async function fetchLaundryRooms(schoolId: string): Promise<LaundryRoom[]> {
  const data = await getJson<unknown>('laundry', `${LAUNDRY_ROOMS_URL}?cui=1&loc=${encodeURIComponent(schoolId)}`);
  return rows(obj(data).room_data)
    .map((room) => ({
      externalId: str(room.laundry_room_location),
      name: str(room.laundry_room_name).trim(),
      campus: str(room.campus_name).trim(),
    }))
    .filter((room) => room.externalId && room.name);
}

export async function fetchLaundryMachines(schoolId: string, roomId: string): Promise<LaundryMachine[]> {
  const data = await getJson<unknown>(
    'laundry',
    `${LAUNDRY_MACHINES_URL}?school_desc_key=${encodeURIComponent(schoolId)}&location=${encodeURIComponent(roomId)}`,
  );
  const machines: LaundryMachine[] = [];
  for (const object of rows(obj(data).objects)) {
    machines.push(...parseLaundryObject(object));
  }
  return dedupeMachines(machines);
}

/**
 * LaundryView lists a machine that belongs to a manual stack twice: once as a
 * standalone object, and again as the second half of the pair. Holland Hall's
 * dryer "B 2" (id 47714) appears both ways, and seven of its machines do — so a
 * naive read reports 35 machines where 28 exist, and an upsert keyed on the
 * machine id fails outright with "ON CONFLICT DO UPDATE command cannot affect
 * row a second time".
 *
 * These are the same physical machine, so collapse them, keeping whichever entry
 * carries real information: a known status beats `unknown`, and a stack flag
 * from either appearance wins.
 */
export function dedupeMachines(machines: LaundryMachine[]): LaundryMachine[] {
  const byId = new Map<string, LaundryMachine>();
  for (const machine of machines) {
    if (!machine.externalId) continue;
    const seen = byId.get(machine.externalId);
    if (!seen) {
      byId.set(machine.externalId, machine);
      continue;
    }
    byId.set(machine.externalId, {
      ...seen,
      status: seen.status === 'unknown' ? machine.status : seen.status,
      minutesRemaining: seen.minutesRemaining ?? machine.minutesRemaining,
      cycleProgressPercent: seen.cycleProgressPercent ?? machine.cycleProgressPercent,
      isStacked: seen.isStacked || machine.isStacked,
    });
  }
  return [...byId.values()];
}

/**
 * One LaundryView "object" can hold two appliances (a stacked pair, or a
 * washer/dryer combo), addressed by a "2" suffix on every field.
 */
export function parseLaundryObject(data: Raw): LaundryMachine[] {
  const objectType = str(data.type);
  const isCombo = objectType === 'washNdry';
  const isStacked = Boolean(data.stacked || data.manualStack);

  const firstType = resolveMachineType(objectType, data.appliance_desc, isCombo);
  if (!firstType) return [];

  const machines = [parseMachine(data, firstType, '', isStacked)];
  if (data.appliance_desc_key2 !== undefined) {
    const secondType = isCombo
      ? inferComboType(data.appliance_desc2)
      : data.type2 === 'washFL'
        ? 'washer'
        : 'dryer';
    if (secondType) machines.push(parseMachine(data, secondType, '2', isStacked));
  }
  return machines;
}

function resolveMachineType(objectType: string, label: unknown, isCombo: boolean): MachineType | null {
  if (isCombo) return inferComboType(label);
  if (objectType === 'washFL') return 'washer';
  if (objectType === 'dry' || objectType === 'dblDry') return 'dryer';
  return null;
}

/** Combo units alternate washer/dryer by the number in their label. */
function inferComboType(label: unknown): MachineType | null {
  const match = /\d+/.exec(str(label));
  if (!match) return null;
  return Number(match[0]) % 2 === 0 ? 'washer' : 'dryer';
}

function parseMachine(
  data: Raw,
  machineType: MachineType,
  suffix: string,
  isStacked: boolean,
): LaundryMachine {
  const code = num(data[`status_toggle${suffix}`]) ?? -1;
  // PittAPI throws on an unrecognised code, losing the whole room. A machine we
  // cannot classify is still a machine — report it as unknown and move on.
  const status = STATUS_BY_CODE[code] ?? 'unknown';
  const running = status === 'in_use';
  const progress = num(data[`percentage${suffix}`]) ?? -1;
  return {
    externalId: str(data[`appliance_desc_key${suffix}`]),
    label: str(data[`appliance_desc${suffix}`]).trim(),
    machineType,
    status,
    statusMessage: typeof data.time_left_lite === 'string' ? data.time_left_lite : null,
    minutesRemaining: running ? int(data[`time_remaining${suffix}`]) : null,
    cycleProgressPercent: running && progress >= 0 && progress <= 100 ? Math.round(progress) : null,
    isStacked,
  };
}

/**
 * LaundryView names rooms in caps with a floor suffix ("HOLLAND HALL 11TH FL.");
 * master_housing names halls in title case ("Holland Hall"). Normalize, then let
 * the caller match against the halls it actually models — an unmatched room is
 * kept and shown unattached rather than dropped.
 */
export function normalizeRoomName(upstreamName: string): string {
  const cleaned = upstreamName
    .replace(/\b\d+(ST|ND|RD|TH)\b/gi, ' ')
    .replace(/\bFLR?\.?\b|\bFLOOR\b/gi, ' ')
    .replace(/\bAPTS?\b/gi, 'Apartments')
    .replace(/[.\s]+/g, ' ')
    .trim();
  return cleaned
    .split(' ')
    .map((word) => {
      const lower = word.toLowerCase();
      if (lower.startsWith('mc') && lower.length > 2) {
        return `Mc${lower.charAt(2).toUpperCase()}${lower.slice(3)}`;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/**
 * The hall a laundry room belongs to, or null when we model no such hall.
 *
 * Exact match only, deliberately. A prefix rule looks helpful and is not: against
 * real housing rows it mapped the provider's "LITCHFIELD TOWERS" — one room
 * serving the whole complex — onto "Litchfield Towers A", attributing every
 * machine in three towers to one of them. A room shown under its provider name
 * is honest; a room attributed to the wrong building is worse than an unmatched
 * one, so anything short of an exact match stays unmatched.
 *
 * Genuine spelling differences belong in a curated alias map keyed on the
 * provider's name, not in a similarity heuristic.
 */
export function matchResidenceHall(
  normalized: string,
  knownHalls: string[],
  aliases: Record<string, string> = {},
): string | null {
  const alias = aliases[normalized.toLowerCase()];
  const target = (alias ?? normalized).toLowerCase();
  return knownHalls.find((hall) => hall.toLowerCase() === target) ?? null;
}

// ---------------------------------------------------------------------------
// Dining (dineoncampus)
// ---------------------------------------------------------------------------
const DINING_BASE = 'https://api.dineoncampus.com/v1';

export interface DiningLocation {
  externalId: string;
  name: string;
  isOpen: boolean | null;
  statusLabel: string | null;
  address: string | null;
}

export interface DiningHoursDay {
  locationId: string;
  locationName: string;
  date: string;
  intervals: Array<{ start: string; end: string }>;
}

export interface DiningMenu {
  periodName: string;
  categories: Array<{ name: string; items: Array<Record<string, unknown>> }>;
  itemCount: number;
}

export async function fetchDiningLocations(siteId: string): Promise<DiningLocation[]> {
  const data = await getJson<unknown>(
    'dining',
    `${DINING_BASE}/locations/status?site_id=${encodeURIComponent(siteId)}&platform=`,
  );
  return rows(obj(data).locations)
    .map((location) => ({
      externalId: str(location.id),
      name: str(location.name).trim(),
      isOpen: bool(location.open),
      statusLabel: optionalStr(obj(location.status).label),
      address: formatAddress(location.address),
    }))
    .filter((location) => location.externalId && location.name);
}

/** The provider returns address as an object, not a string. */
function formatAddress(address: unknown): string | null {
  if (typeof address === 'string') return address.trim() || null;
  if (!address || typeof address !== 'object') return null;
  const a = obj(address);
  const parts = [a.street, a.city, a.state, a.zip_code]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** `date` is YY-MM-DD, which is what this provider expects. */
export async function fetchDiningWeeklyHours(siteId: string, dateCode: string): Promise<DiningHoursDay[]> {
  const data = await getJson<unknown>(
    'dining',
    `${DINING_BASE}/locations/weekly_schedule?site_id=${encodeURIComponent(siteId)}&date=%22${dateCode}%22`,
  );
  const days: DiningHoursDay[] = [];
  for (const location of rows(obj(data).the_locations)) {
    const name = str(location.name).trim();
    const id = str(location.id);
    for (const week of rows(location.week)) {
      days.push({
        locationId: id,
        locationName: name,
        date: str(week.date),
        intervals: rows(week.hours).map((interval) => ({
          start: formatClock(interval.start_hour, interval.start_minutes),
          end: formatClock(interval.end_hour, interval.end_minutes),
        })),
      });
    }
  }
  return days.filter((day) => day.locationName && day.date);
}

function formatClock(hour: unknown, minutes: unknown): string {
  const h = String(num(hour) ?? 0).padStart(2, '0');
  const m = String(num(minutes) ?? 0).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Locations derived from the weekly-schedule payload.
 *
 * The provider rate-limits by IP and blocks paths independently: /locations/status
 * can be refused while /locations/weekly_schedule still answers. Since the
 * schedule payload carries the same id and name, hours and menus need not be lost
 * to a block on the status endpoint alone.
 */
export function locationsFromHours(hours: DiningHoursDay[]): DiningLocation[] {
  const byId = new Map<string, DiningLocation>();
  for (const day of hours) {
    if (!day.locationId || byId.has(day.locationId)) continue;
    byId.set(day.locationId, {
      externalId: day.locationId,
      name: day.locationName,
      isOpen: null,
      statusLabel: null,
      address: null,
    });
  }
  return [...byId.values()];
}

export type MenuOutcome =
  | { kind: 'ok'; menus: DiningMenu[] }
  | { kind: 'no_periods' }
  | { kind: 'unavailable'; reason: string };

/**
 * A location's menus for one day. Distinguishes "publishes no menu" from "the
 * request failed", so an upstream 502 never renders as an empty menu.
 */
export async function fetchDiningMenus(locationId: string, dateCode: string): Promise<MenuOutcome> {
  let periods: Raw[];
  try {
    const data = await withRetry(() =>
      getJson<unknown>(
        'dining',
        `${DINING_BASE}/location/${encodeURIComponent(locationId)}/periods?platform=0&date=${dateCode}`,
      ),
    );
    periods = rows(obj(data).periods);
  } catch (error) {
    return { kind: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
  }
  if (periods.length === 0) return { kind: 'no_periods' };

  const menus: DiningMenu[] = [];
  for (const period of periods) {
    try {
      const data = await withRetry(() =>
        getJson<unknown>(
          'dining',
          `${DINING_BASE}/location/${encodeURIComponent(locationId)}/periods/${encodeURIComponent(str(period.id))}?platform=0&date=${dateCode}`,
        ),
      );
      const parsed = parseMenu(obj(data).menu);
      if (parsed) menus.push({ ...parsed, periodName: str(period.name) || parsed.periodName });
    } catch {
      // One bad period should not cost the location its other meals.
      continue;
    }
  }
  return menus.length > 0 ? { kind: 'ok', menus } : { kind: 'unavailable', reason: 'no period parsed' };
}

/**
 * Retail brands omit the `uom` key on nutrients. PittAPI reads it unguarded and
 * discards the entire menu when it is missing, which is why Chick-fil-A, Panera,
 * Shake Smart and both Einstein Bros. locations look menu-less through it.
 */
export function parseMenu(menu: unknown): DiningMenu | null {
  const period = obj(obj(menu).periods);
  if (!obj(menu).periods) return null;
  const categories = rows(period.categories).map((category) => ({
    name: str(category.name),
    items: rows(category.items).map((item) => ({
      id: optionalStr(item.id),
      name: optionalStr(item.name),
      description: optionalStr(item.desc),
      portion: optionalStr(item.portion),
      calories: optionalStr(item.calories),
      ingredients: optionalStr(item.ingredients),
      filters: rows(item.filters)
        .map((filter) => optionalStr(filter.name))
        .filter((name): name is string => name !== null),
      nutrients: rows(item.nutrients).map((nutrient) => ({
        name: optionalStr(nutrient.name),
        value: optionalStr(nutrient.value),
        unit: optionalStr(nutrient.uom),
      })),
    })),
  }));
  const itemCount = categories.reduce((total, category) => total + category.items.length, 0);
  return { periodName: str(period.name), categories, itemCount };
}

// ---------------------------------------------------------------------------
// Academic calendar (25Live Publisher)
// ---------------------------------------------------------------------------
export const CALENDAR_FEEDS = {
  academic: 'academic',
  enrollment: 'enrollment',
  grades: 'grades',
  graduation: 'graduation',
  course: 'courseclass',
} as const;

export type CalendarKind = keyof typeof CALENDAR_FEEDS;

export interface CalendarEvent {
  calendar: CalendarKind;
  date: string;
  title: string;
  content: string | null;
  categories: string[];
}

export async function fetchCalendar(prefix: string, kind: CalendarKind): Promise<CalendarEvent[]> {
  const data = await getJson<unknown>(
    'calendar',
    `https://25livepub.collegenet.com/calendars/${prefix}-${CALENDAR_FEEDS[kind]}-calendar.json`,
  );
  const events: CalendarEvent[] = [];
  for (const raw of rows(data)) {
    const date = str(raw.startDateTime).slice(0, 10);
    const title = str(raw.title).trim();
    if (!date || !title) continue;
    const field = obj(arr(raw.customFields)[0]);
    events.push({
      calendar: kind,
      date,
      title,
      content: str(field.label) === 'Event Title' ? optionalStr(field.value) : null,
      categories: str(raw.categoryCalendar).split('|').filter(Boolean),
    });
  }
  return events;
}

// ---------------------------------------------------------------------------
// PeopleSoft session handling
//
// The HighPoint CX endpoints answer a cold request with a 302 that sets a
// session cookie and redirects to the same URL. fetch() follows redirects but
// keeps no cookie jar, so the followed request arrives without the cookie and
// PeopleSoft answers 500 — which reads as "the catalog is behind Passport" when
// it is really a missing cookie. Follow the redirect ourselves, carrying cookies.
// ---------------------------------------------------------------------------
let cxCookies = new Map<string, string>();

function rememberCookies(response: Response): void {
  const raw: string[] =
    typeof (response.headers as { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (response.headers as { getSetCookie: () => string[] }).getSetCookie()
      : [response.headers.get('set-cookie') ?? ''].filter(Boolean);
  for (const cookie of raw) {
    const [pair] = cookie.split(';');
    const index = pair.indexOf('=');
    if (index > 0) cxCookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
}

function cookieHeader(): string {
  return [...cxCookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

/** Reset the PeopleSoft session; exported for tests. */
export function resetCatalogSession(): void {
  cxCookies = new Map();
}

async function getCatalogJson<T>(url: string, timeoutMs = 20000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let target = url;
    for (let hop = 0; hop < 4; hop++) {
      const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
      const cookies = cookieHeader();
      if (cookies) headers.Cookie = cookies;

      const response = await fetch(target, { headers, redirect: 'manual', signal: controller.signal });
      rememberCookies(response);

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new UpstreamError('catalog', response.status, `catalog: ${response.status} with no location`);
        target = new URL(location, target).toString();
        continue;
      }
      if (!response.ok) {
        // A stale cookie is the common cause; drop it so the next hop starts cold.
        resetCatalogSession();
        throw new UpstreamError('catalog', response.status, `catalog: HTTP ${response.status} for ${url}`);
      }
      return (await response.json()) as T;
    }
    throw new UpstreamError('catalog', 508, `catalog: too many redirects for ${url}`);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Course catalog (HighPoint CX)
// ---------------------------------------------------------------------------
const CX_BASE = 'https://pitcsprd.csps.pitt.edu/psc/pitcsprd/EMPLOYEE/SA/s';

export interface CatalogCourse {
  courseId: string;
  subject: string;
  courseNumber: string;
  title: string;
  /**
   * The catalog says up front whether a course has any open term. Only these can
   * yield sections, which is what keeps the backfill to a few thousand requests
   * instead of one per catalog entry.
   */
  hasOpenTerms: boolean;
}

export interface CatalogSection {
  classNumber: string;
  subject: string;
  catalogNumber: string;
  section: string;
  component: string | null;
  title: string | null;
  days: string[];
  startTime: string | null;
  endTime: string | null;
}

export async function fetchSubjects(institution: string): Promise<string[]> {
  const data = await getCatalogJson<{ subjects?: Array<{ subject?: string }> }>(
    `${CX_BASE}/WEBLIB_HCX_CM.H_COURSE_CATALOG.FieldFormula.IScript_CatalogSubjects?institution=${encodeURIComponent(institution)}`,
  );
  return [...new Set((data.subjects ?? []).map((s) => String(s.subject ?? '')).filter(Boolean))].sort();
}

export async function fetchSubjectCourses(institution: string, subject: string): Promise<CatalogCourse[]> {
  const data = await getCatalogJson<unknown>(
    `${CX_BASE}/WEBLIB_HCX_CM.H_COURSE_CATALOG.FieldFormula.IScript_SubjectCourses?institution=${encodeURIComponent(institution)}&subject=${encodeURIComponent(subject)}`,
  );
  const seen = new Set<string>();
  const courses: CatalogCourse[] = [];
  for (const course of rows(obj(data).courses)) {
    const courseId = str(course.crse_id);
    const courseNumber = str(course.catalog_nbr);
    // The catalog repeats a course once per offering; one row per id+number is enough.
    const key = `${courseId}:${courseNumber}`;
    if (!courseId || !courseNumber || seen.has(key)) continue;
    seen.add(key);
    courses.push({
      courseId,
      subject,
      courseNumber,
      title: str(course.descr).trim(),
      hasOpenTerms: course.has_open_terms === true,
    });
  }
  return courses;
}

/** Every section of one course in a term. Carries times but no building. */
export async function fetchCourseSections(
  institution: string,
  courseId: string,
  term: string,
): Promise<CatalogSection[]> {
  const data = await getCatalogJson<unknown>(
    `${CX_BASE}/WEBLIB_HCX_CM.H_BROWSE_CLASSES.FieldFormula.IScript_BrowseSections` +
      `?institution=${encodeURIComponent(institution)}&campus=&location=&course_id=${encodeURIComponent(courseId)}` +
      `&term=${encodeURIComponent(term)}&crse_offer_nbr=1`,
  );
  return rows(obj(data).sections)
    .map((section) => {
      const meeting = obj(arr(section.meetings)[0]);
      return {
        classNumber: str(section.class_nbr),
        subject: str(section.subject),
        catalogNumber: str(section.catalog_nbr),
        section: str(section.class_section),
        component: optionalStr(section.component),
        title: optionalStr(section.descr),
        days: splitMeetingDays(meeting.days),
        startTime: parseCxTime(meeting.start_time),
        endTime: parseCxTime(meeting.end_time),
      };
    })
    .filter((section) => section.classNumber);
}

/**
 * The building code lives only on the per-section detail call — the bulk
 * browse-sections response omits it. This is the one field the walking-route
 * feature actually needs, so the catalog ingest backfills it in its own stage.
 */
export async function fetchSectionBuilding(term: string, classNumber: string): Promise<string | null> {
  const data = await getCatalogJson<unknown>(
    `${CX_BASE}/WEBLIB_HCX_CM.H_CLASS_SEARCH.FieldFormula.IScript_ClassDetails?institution=UPITT&term=${encodeURIComponent(term)}&class_nbr=${encodeURIComponent(classNumber)}`,
  );
  const meeting = obj(arr(obj(obj(data).section_info).meetings)[0]);
  return optionalStr(meeting.bldg_cd);
}

/** "MoWeFr" -> ["Mo","We","Fr"]. */
export function splitMeetingDays(days: unknown): string[] {
  const text = str(days).trim();
  if (!text || text.toUpperCase() === 'TBA') return [];
  return text.match(/Mo|Tu|We|Th|Fr|Sa|Su/g) ?? [];
}

/** "16.30.00.000000" -> "16:30:00". */
export function parseCxTime(value: unknown): string | null {
  const parts = str(value).split('.');
  if (parts.length < 3) return null;
  const [h, m, s] = parts;
  if (!/^\d{1,2}$/.test(h) || !/^\d{2}$/.test(m)) return null;
  return `${h.padStart(2, '0')}:${m}:${(s ?? '00').slice(0, 2)}`;
}

/** Pitt term code: 2 + last two digits of the academic year + 1 (Fall) / 4 (Spring) / 7 (Summer). */
export function currentTermCode(now = new Date()): string {
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  if (month >= 8) return `2${String((year + 1) % 100).padStart(2, '0')}1`;
  if (month >= 5) return `2${String(year % 100).padStart(2, '0')}7`;
  return `2${String(year % 100).padStart(2, '0')}4`;
}
