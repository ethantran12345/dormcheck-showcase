/**
 * Sublease terms — the structured half of a sublease post.
 *
 * Spec: vault `dormcheck/Reviews Subleases Services PRD.md` §5 Phase 2, plus the
 * 2026-08-05 decision (`08 - Decisions Log`) that restored subleases behind a
 * verified-LISTER gate.
 *
 * The governing rule here is "structured fields only". A sublease is the highest
 * scam-value post on the platform, and free prose is exactly where a scam hides:
 * it is unqueryable, uncomparable, and it lets a listing say whatever it wants in
 * the position a student reads first. So every fact a sublease asserts is a typed
 * column — dates, rent, address, utilities, furnished, parking, gender preference
 * — and the only free text on the whole post is `house_rules` / `additional_rules`,
 * which are rendered LAST and never as a headline. `title` is not a free-text field
 * for a sublease at all: it is a copy of `building_name`, so the card headline is a
 * structured value by construction rather than by review.
 *
 * ── PHOTOS PLUS AN ADDRESS, AND IT PINS (2026-08-18) ─────────────────────────
 * `building_name` is the ADDRESS the student types. It geocodes at submit and the
 * listing gets a pin. Always. There is no registry to be missing from and no
 * unpinnable path to fall into.
 *
 * This reverses Phase 1 (2026-08-17), which made the building a row PICKED from
 * `public.buildings` and left a typed name deliberately un-geocoded and
 * deliberately unpinned. The reasoning behind that was real — geocoding free text
 * is what once put a Pittsburgh address in Lancashire, England, and a map pin
 * asserts location far more confidently than a text line does — but the remedy
 * was aimed at the wrong thing. It protected the map by excluding the student:
 * a building nobody had seeded meant no post at all, and then, once an escape
 * hatch existed, a real sublease at a real address that was silently kept off the
 * one surface the feature exists for. A seeding gap is our debt, not the lister's.
 *
 * The Lancashire guard did not go away; it moved to where it belongs. The
 * geocoder rejects any match beyond `MAX_CAMPUS_DISTANCE_KM` of the LISTING's
 * campus (src/lib/geocode.ts), so an address that resolves implausibly is refused
 * AT SUBMIT and no row is written. That rejects the coordinate rather than the
 * student, and it works for every address, seeded or not — which the registry
 * never could.
 *
 * `building_id` survives as OPTIONAL ENRICHMENT. The address field offers the
 * registry as autocomplete (`SubleaseAddressField`) so a lister can take a known
 * building's street address instead of looking it up, and records the row's id
 * when they do. Nothing downstream requires it: the map groups on the rounded
 * geocoded coordinate (`groupSubleasesByLocation`), never on `building_id`, so a
 * typed listing and a suggested one at the same address land on the same pin.
 *
 * Rows written under Phase 1's typed fallback carry a name and no coordinates.
 * They stay listed under "Not on the map" and are a re-geocode worklist; the
 * recovery query is in docs/sublease-phase1-prod-rollout.md.
 */

import { geocodeAddress, type GeocodeResult } from '@/lib/geocode';
import type { University } from '@/config/universities';

/** Utilities a lister can mark included. Fixed list — free text would defeat the point. */
export const INCLUDED_UTILITIES = [
  'electricity',
  'water',
  'gas',
  'internet',
  'trash',
] as const;
export type IncludedUtility = (typeof INCLUDED_UTILITIES)[number];

/** Roommate/gender preference. `any` is the default and is not surfaced on the card. */
export const GENDER_PREFERENCES = ['any', 'female', 'male'] as const;
export type GenderPreference = (typeof GENDER_PREFERENCES)[number];

export type SubleaseTerms = {
  /** ISO `YYYY-MM-DD`. */
  sublease_start?: string | null;
  sublease_end?: string | null;
  /**
   * OPTIONAL enrichment: the registry row (`public.buildings.id`) whose address
   * autocomplete the lister accepted. Never required, never consulted for
   * pinning, and null on every listing whose address was simply typed — which is
   * a completely ordinary, fully pinned listing.
   */
  building_id?: string | null;
  /**
   * THE ADDRESS the lister typed. It is the geocoder's input at submit and the
   * card headline — a sublease has no title input, so `subleaseTitle()` copies
   * this string into `title`.
   *
   * The column keeps its Phase-1 name rather than gaining a `street_address`
   * sibling. Its ORIGINAL meaning was exactly this (the geocoding migration's own
   * comment reads "Geocoded latitude from building_name address"), so restoring
   * the meaning is a smaller change than adding a column: no expand/contract, no
   * backfill, and no second question about which of the two is the headline when
   * they disagree.
   */
  building_name?: string | null;
  included_utilities?: string[] | null;
  is_furnished?: boolean | null;
  has_parking?: boolean | null;
  gender_preference?: string | null;
  /** The ONLY free text on a sublease. Never a headline. */
  house_rules?: string | null;
  additional_rules?: string | null;
};

export function isIncludedUtility(v: string): v is IncludedUtility {
  return (INCLUDED_UTILITIES as readonly string[]).includes(v);
}

/**
 * Has the lister said WHERE?
 *
 * The address alone, and `building_id` is deliberately NOT consulted. A picked
 * suggestion always fills the address too, so an id with no address is not a
 * state the composer can produce — and treating an id as a substitute would let
 * a listing satisfy "where" with a value the geocoder never sees and the card
 * cannot print.
 */
function subleaseBuildingProvided(terms: SubleaseTerms): boolean {
  return Boolean((terms.building_name ?? '').trim());
}

/**
 * The required structured set: where, and for how long. Rent is validated by the
 * shared price requirement in the create flow, not here.
 *
 * "Where" is the address (`building_name`). See the module header for why that is
 * the only question asked here, and why a registry id is not an answer to it.
 *
 * Dates are compared as ISO strings deliberately — `YYYY-MM-DD` sorts
 * lexicographically, and `new Date('2026-09-01')` is UTC-midnight, which reads as
 * the previous day for every student west of Greenwich.
 */
export function subleaseTermsValid(terms: SubleaseTerms): boolean {
  const start = (terms.sublease_start ?? '').trim();
  const end = (terms.sublease_end ?? '').trim();
  return (
    subleaseBuildingProvided(terms) && Boolean(start) && Boolean(end) && end > start
  );
}

/**
 * Which requirement is unmet, in field order. `null` when the terms are complete.
 *
 * The `'building'` discriminant is unchanged across the strict-picker era, its
 * typed fallback, and today's plain address: callers key their copy off this
 * string, and it has always named the same question ("where is this room?"),
 * whichever field answered it.
 */
export function firstUnmetSubleaseTerm(
  terms: SubleaseTerms,
): 'building' | 'dates' | 'range' | null {
  if (!subleaseBuildingProvided(terms)) return 'building';
  const start = (terms.sublease_start ?? '').trim();
  const end = (terms.sublease_end ?? '').trim();
  if (!start || !end) return 'dates';
  if (end <= start) return 'range';
  return null;
}

/**
 * `Sep 1 – Dec 20`, or the single bound when only one is set.
 *
 * Parsed as a local date (split, not `Date.parse`) for the timezone reason above:
 * a lease that starts on the 1st must never render as the 31st.
 */
export function formatSubleaseRange(
  start?: string | null,
  end?: string | null,
  locale = 'en-US',
): string {
  const fmt = (iso?: string | null): string | null => {
    const parts = (iso ?? '').trim().split('-');
    if (parts.length !== 3) return null;
    const [y, m, d] = parts.map(Number);
    if (!y || !m || !d) return null;
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(
      new Date(y, m - 1, d),
    );
  };
  const a = fmt(start);
  const b = fmt(end);
  if (a && b) return `${a} – ${b}`;
  return a ?? b ?? '';
}

/**
 * `$850` — a monthly rent, whole dollars.
 *
 * Lives here rather than in the map component because two sublease surfaces read
 * it (the marker's cheapest-rent headline and the list card) and
 * docs/AUDIT_REPORT.md already counts eight private re-implementations of this
 * exact `Intl.NumberFormat` config across the marketplace. Adding a ninth inside
 * a component would be the same mistake at a smaller scale; the sublease domain
 * module is where the next sublease surface will look for it.
 *
 * No fraction digits: rent is quoted in whole dollars everywhere in the composer,
 * and `$850.00` on a map pin is two characters of noise on the app's smallest
 * label.
 */
export function formatRent(price: number, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

/**
 * Turn the typed address into the coordinates a listing pins from.
 *
 * ONE function for both write paths on purpose. Create and edit are two screens
 * that must produce identical rows, and "the edit path forgot to geocode" is the
 * exact way a sublease ends up pinned at the address it used to have — the pre-
 * 2026-06 code did both, and the edit half is the one that gets dropped in a
 * rewrite.
 *
 * `proximity` is the LISTING's campus centre, never the viewer's. A Pitt student
 * browsing a CMU sublease must not shift where that listing's address resolves,
 * and the argument is required by `geocodeAddress` precisely so a call site
 * cannot quietly omit it.
 *
 * Returns `null` when the address resolves nowhere, every provider fails, or the
 * only matches sit beyond `MAX_CAMPUS_DISTANCE_KM` from campus. The caller must
 * treat that as a REFUSAL and write no row — not as "post it without a pin".
 * That is the whole safety story now that any address posts: the check that keeps
 * a Pittsburgh listing out of Lancashire is this one, and it only works if a null
 * stops the submit.
 */
export async function geocodeSubleaseAddress(
  address: string,
  university: Pick<University, 'campusCenter' | 'city'>,
): Promise<GeocodeResult | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;
  return geocodeAddress(trimmed, university.campusCenter, { censusCity: university.city });
}

/**
 * The stored `title` for a sublease: the address, nothing else.
 *
 * This is what keeps the "never a free-text headline" rule true at the DATA layer
 * rather than in every card that renders a listing. A sublease has no title input.
 */
export function subleaseTitle(terms: SubleaseTerms): string {
  return (terms.building_name ?? '').trim();
}

/**
 * The structured field block a sublease hands to `ListingTrustChrome` — the one
 * trust layer every card type shares.
 *
 * Only typed columns appear here, and that is enforced by shape rather than by
 * discipline: `house_rules`/`additional_rules` are not read by this function at
 * all, so no card can accidentally promote free text into the field block or the
 * headline. They render in the detail view, last, and nowhere else.
 *
 * Omits anything unset and anything at its default (`gender_preference: 'any'`,
 * furnished/parking false) — a card that lists every absent amenity reads as a
 * form, and a `Furnished: No` row is noise on a feed.
 */
export function subleaseTrustFields(
  terms: SubleaseTerms,
  t: (key: string) => string,
  locale = 'en-US',
): Array<{ label: string; value: string }> {
  const fields: Array<{ label: string; value: string }> = [];

  const range = formatSubleaseRange(terms.sublease_start, terms.sublease_end, locale);
  if (range) fields.push({ label: t('marketplace:sublease.datesShort'), value: range });

  const utilities = (terms.included_utilities ?? []).filter(isIncludedUtility);
  if (utilities.length > 0) {
    fields.push({
      label: t('marketplace:sublease.utilitiesShort'),
      value: utilities.map((u) => t(`marketplace:sublease.utility.${u}`)).join(', '),
    });
  }

  if (terms.is_furnished) {
    fields.push({ label: t('marketplace:sublease.furnished'), value: t('common:state.yes') });
  }
  if (terms.has_parking) {
    fields.push({ label: t('marketplace:sublease.parking'), value: t('common:state.yes') });
  }

  const gender = (terms.gender_preference ?? 'any').trim();
  if (gender && gender !== 'any') {
    fields.push({
      label: t('marketplace:sublease.genderPreference'),
      value: t(`marketplace:sublease.gender.${gender}`),
    });
  }

  return fields;
}
