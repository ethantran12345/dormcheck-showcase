// Deterministic roommate compatibility scoring. Pure module: no React, no
// network. Both the Browse card badge and the compatibility filters consume
// scoreRoommateMatch(); tune behavior via the constants below.

import {
  CLEANLINESS_OPTIONS,
  SOCIAL_OPTIONS,
  GUESTS_OPTIONS,
} from '@/lib/roommateOptions';
import { getFreshmanGraduationYear } from '@/lib/academicYear';

export interface MatchInput {
  cleanliness?: string | null;
  social_level?: string | null;
  study_style?: string | null;
  conflict_style?: string | null;
  guests?: string | null;
  guest_preference?: string | null;
  sleep?: string | null;
  sleep_habit?: string | null;
  smoking?: string | null;
  temp?: string | null;
  temp_preference?: string | null;
  dealbreakers?: string[] | null;
  tags?: string[] | null;
  graduation_year?: number | null;
  grade_level?: string | null;
  preferred_areas?: string[] | null;
  current_dorm?: string | null;
  housing_type?: string | null;
  [key: string]: unknown;
}

export interface MatchResult {
  /** 0-100 integer */
  score: number;
  reasons: string[];
  conflicts: string[];
  /** 'low' when too few shared answered dimensions for a meaningful % */
  confidence: 'high' | 'low';
}

export type ViewerPersona = 'underclassman' | 'upperclassman';

// ---- Tunable constants ----
export const WEIGHTS = { lifestyle: 60, dealbreakers: 25, tags: 10, context: 5 };
export const LOW_CONFIDENCE_DIM_THRESHOLD = 3;
export const TOP_MATCH_MIN_SCORE = 75;
const MAX_REASONS = 4;
const CONTEXT_SUBWEIGHTS = { classYear: 0.4, location: 0.4, housingType: 0.2 };

const ONBOARDING_TAG_PREFIX = 'onboarding_interest:';

// ---- Field normalization ----
const norm = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

// Canonical column first, legacy fallback (guest_preference / sleep_habit /
// temp_preference predate the current form, which writes guests/sleep/temp).
const getGuests = (p: MatchInput) => norm(p.guests) ?? norm(p.guest_preference);
const getSleep = (p: MatchInput) => norm(p.sleep) ?? norm(p.sleep_habit);
const getTemp = (p: MatchInput) => norm(p.temp) ?? norm(p.temp_preference);

// ---- Lifestyle dimensions ----
type DimKind = 'ordinal' | 'binary' | 'nominal';
interface Dimension {
  key: string;
  kind: DimKind;
  scale?: readonly string[];
  get: (p: MatchInput) => string | null;
  /** reason copy when both sides match exactly */
  matchReason: (value: string) => string;
}

const LIFESTYLE_DIMENSIONS: Dimension[] = [
  {
    key: 'cleanliness',
    kind: 'ordinal',
    scale: CLEANLINESS_OPTIONS,
    get: (p) => norm(p.cleanliness),
    matchReason: (v) => `You both keep your space ${v.toLowerCase()}`,
  },
  {
    key: 'social_level',
    kind: 'ordinal',
    scale: SOCIAL_OPTIONS,
    get: (p) => norm(p.social_level),
    matchReason: (v) =>
      v === 'Quiet' ? 'You both prefer a quiet room' : `You are both ${v.toLowerCase()} types`,
  },
  {
    key: 'guests',
    kind: 'ordinal',
    scale: GUESTS_OPTIONS,
    get: getGuests,
    matchReason: (v) => `You both have guests over ${v.toLowerCase()}`,
  },
  {
    key: 'sleep',
    kind: 'binary',
    get: getSleep,
    matchReason: (v) => (v === 'Early' ? 'Both early risers' : 'Both night owls'),
  },
  {
    key: 'temp',
    kind: 'binary',
    get: getTemp,
    matchReason: (v) => `You both like the room ${v.toLowerCase()}`,
  },
  {
    key: 'study_style',
    kind: 'nominal',
    get: (p) => norm(p.study_style),
    matchReason: (v) => `You share a focus zone: ${v}`,
  },
  {
    key: 'conflict_style',
    kind: 'nominal',
    get: (p) => norm(p.conflict_style),
    matchReason: () => 'You handle conflict the same way',
  },
  {
    key: 'smoking',
    kind: 'nominal',
    get: (p) => norm(p.smoking),
    matchReason: (v) => (v === 'Non-smoker' ? 'Both non-smokers' : `Both list smoking: ${v}`),
  },
];

function scoreDimension(dim: Dimension, a: string, b: string): number {
  if (a === b) return 1;
  if (dim.kind === 'ordinal' && dim.scale) {
    const ia = dim.scale.indexOf(a);
    const ib = dim.scale.indexOf(b);
    if (ia === -1 || ib === -1) return 0;
    return Math.abs(ia - ib) === 1 ? 0.5 : 0;
  }
  return 0;
}

// ---- Dealbreaker rules ----
// Maps each preset dealbreaker to the lifestyle it constrains on the OTHER
// person. Returns true when the other profile violates the boundary; null when
// the other profile has not answered the relevant field (no evidence, no
// penalty). Unmapped/custom dealbreaker strings are ignored for scoring.
type DealbreakerRule = (other: MatchInput) => boolean | null;

const DEALBREAKER_RULES: Record<string, DealbreakerRule> = {
  'No Smoking': (o) => {
    const s = norm(o.smoking);
    return s ? s === 'Smoker' || s === 'Vape' : null;
  },
  'No Overnight Guests': (o) => {
    const g = getGuests(o);
    return g ? g === 'Often' : null;
  },
  'No Frequent S.O. Sleepovers': (o) => {
    const g = getGuests(o);
    return g ? g === 'Often' : null;
  },
  'Quiet Hours After 10PM': (o) => {
    const social = norm(o.social_level);
    const sleep = getSleep(o);
    if (!social || !sleep) return null;
    return social === 'Social' && sleep === 'Late';
  },
  'Headphones After 10PM': (o) => {
    const social = norm(o.social_level);
    const sleep = getSleep(o);
    if (!social || !sleep) return null;
    return social === 'Social' && sleep === 'Late';
  },
  'No Heavy Partying': (o) => {
    const social = norm(o.social_level);
    const g = getGuests(o);
    if (!social || !g) return null;
    return social === 'Social' && g === 'Often';
  },
};

const cleanTags = (tags: string[] | null | undefined): string[] =>
  (tags ?? [])
    .map((t) => t.trim())
    .filter((t) => t && !t.startsWith(ONBOARDING_TAG_PREFIX));

/**
 * Score how compatible `candidate` is with `viewer`. Deterministic and
 * symmetric in the lifestyle/tags/context layers; dealbreakers are checked in
 * both directions. Missing answers are neutral: a dimension (or whole layer)
 * with no data on either side is dropped from the denominator, never punished.
 */
export function scoreRoommateMatch(viewer: MatchInput, candidate: MatchInput): MatchResult {
  const reasons: string[] = [];
  const conflicts: string[] = [];

  // -- Lifestyle layer --
  let lifestyleHits = 0;
  let lifestyleApplicable = 0;
  let jointDims = 0;
  const dimReasons: { score: number; text: string }[] = [];
  for (const dim of LIFESTYLE_DIMENSIONS) {
    const a = dim.get(viewer);
    const b = dim.get(candidate);
    if (!a || !b) continue;
    jointDims += 1;
    lifestyleApplicable += 1;
    const s = scoreDimension(dim, a, b);
    lifestyleHits += s;
    if (s === 1) dimReasons.push({ score: s, text: dim.matchReason(a) });
  }

  // -- Dealbreaker layer (both directions) --
  let dbApplicable = 0;
  let dbHits = 0;
  const directions: Array<[MatchInput, MatchInput, 'yours' | 'theirs']> = [
    [viewer, candidate, 'yours'],
    [candidate, viewer, 'theirs'],
  ];
  for (const [holder, other, side] of directions) {
    for (const db of holder.dealbreakers ?? []) {
      const rule = DEALBREAKER_RULES[db];
      if (!rule) continue; // custom/unmapped: shown in profile UI, not scored
      const violated = rule(other);
      if (violated === null) continue; // other side unanswered: neutral
      dbApplicable += 1;
      if (violated) {
        conflicts.push(
          side === 'yours'
            ? `Your boundary "${db}" conflicts with their lifestyle answers`
            : `Their boundary "${db}" conflicts with your lifestyle answers`,
        );
      } else {
        dbHits += 1;
      }
    }
  }

  // -- Tags layer (Jaccard) --
  const viewerTags = new Set(cleanTags(viewer.tags));
  const candidateTags = new Set(cleanTags(candidate.tags));
  const union = new Set([...viewerTags, ...candidateTags]);
  const shared = [...viewerTags].filter((t) => candidateTags.has(t));
  const tagsApplicable = union.size > 0;
  const tagsScore = tagsApplicable ? shared.length / union.size : 0;
  for (const t of shared.slice(0, 3)) reasons.push(`Shared: ${t}`);

  // -- Context layer --
  let ctxHits = 0;
  let ctxApplicable = 0;
  if (viewer.graduation_year != null && candidate.graduation_year != null) {
    ctxApplicable += CONTEXT_SUBWEIGHTS.classYear;
    if (viewer.graduation_year === candidate.graduation_year) {
      ctxHits += CONTEXT_SUBWEIGHTS.classYear;
      reasons.push('Same class year');
    }
  }
  const viewerAreas = new Set((viewer.preferred_areas ?? []).map((a) => a.trim()).filter(Boolean));
  const candidateAreas = new Set(
    (candidate.preferred_areas ?? []).map((a) => a.trim()).filter(Boolean),
  );
  const viewerDorm = norm(viewer.current_dorm);
  const candidateDorm = norm(candidate.current_dorm);
  const hasLocation =
    (viewerAreas.size > 0 && candidateAreas.size > 0) || (viewerDorm && candidateDorm);
  if (hasLocation) {
    ctxApplicable += CONTEXT_SUBWEIGHTS.location;
    const areaOverlap = [...viewerAreas].some((a) => candidateAreas.has(a));
    const sameDorm = !!viewerDorm && viewerDorm === candidateDorm;
    if (areaOverlap || sameDorm) {
      ctxHits += CONTEXT_SUBWEIGHTS.location;
      reasons.push(sameDorm ? 'Same dorm' : 'Overlapping preferred areas');
    }
  }
  const viewerHousing = norm(viewer.housing_type);
  const candidateHousing = norm(candidate.housing_type);
  if (viewerHousing && candidateHousing) {
    ctxApplicable += CONTEXT_SUBWEIGHTS.housingType;
    if (viewerHousing === candidateHousing) ctxHits += CONTEXT_SUBWEIGHTS.housingType;
  }

  // -- Combine layers; a layer with no applicable data drops its weight --
  let weightedHits = 0;
  let weightedApplicable = 0;
  if (lifestyleApplicable > 0) {
    weightedHits += WEIGHTS.lifestyle * (lifestyleHits / lifestyleApplicable);
    weightedApplicable += WEIGHTS.lifestyle;
  }
  if (dbApplicable > 0) {
    weightedHits += WEIGHTS.dealbreakers * (dbHits / dbApplicable);
    weightedApplicable += WEIGHTS.dealbreakers;
  }
  if (tagsApplicable) {
    weightedHits += WEIGHTS.tags * tagsScore;
    weightedApplicable += WEIGHTS.tags;
  }
  if (ctxApplicable > 0) {
    weightedHits += WEIGHTS.context * (ctxHits / ctxApplicable);
    weightedApplicable += WEIGHTS.context;
  }

  const score =
    weightedApplicable > 0 ? Math.round((100 * weightedHits) / weightedApplicable) : 0;

  // Lead with a couple of lifestyle agreements, then tags/context, capped - 
  // mixing kinds reads better than four lifestyle lines.
  const finalReasons = [...dimReasons.slice(0, 2).map((r) => r.text), ...reasons].slice(
    0,
    MAX_REASONS,
  );

  return {
    score: Math.max(0, Math.min(100, score)),
    reasons: finalReasons,
    conflicts,
    confidence: jointDims < LOW_CONFIDENCE_DIM_THRESHOLD ? 'low' : 'high',
  };
}

/**
 * Classify the viewer for default UX emphasis (never a hard wall).
 * Freshman/Sophomore = underclassman (lifestyle-led browse, match band);
 * Junior/Senior/Graduate = upperclassman (logistics-led posts surface).
 * Unknown data defaults to underclassman; the band is still gated on having
 * high-confidence matches, so the default is safe.
 */
export function getViewerPersona(profile: MatchInput): ViewerPersona {
  const grade = norm(profile.grade_level);
  if (grade) {
    if (grade === 'Freshman' || grade === 'Sophomore') return 'underclassman';
    return 'upperclassman';
  }
  const gradYear = profile.graduation_year;
  if (gradYear != null) {
    // Freshman class graduates in baseYear; sophomores in baseYear - 1.
    const baseYear = getFreshmanGraduationYear();
    return gradYear >= baseYear - 1 ? 'underclassman' : 'upperclassman';
  }
  return 'underclassman';
}
