import type { Dorm } from '@/types';
import { supabase } from '@/integrations/supabase/client';

export type HousingTab = 'freshman' | 'upperclass';

/**
 * Normalizes residence hall names for comparison (lowercase, trimmed, single spaces)
 */
function normalizeResidenceHallName(name: string | null | undefined): string {
  return (name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Fetches all unique residence halls from the master_housing table in Supabase.
 * Returns an alphabetically sorted array of unique dorm names.
 */
export async function fetchAllResidenceHalls(): Promise<string[]> {
  const { data, error } = await supabase
    .from('master_housing')
    .select('residence_hall')
    .not('residence_hall', 'is', null);

  if (error) throw error;

  // Extract unique residence hall names (no duplicates), normalized for case/whitespace
  const canonicalToDisplay = new Map<string, string>();
  const rows = (data ?? []) as { residence_hall: string | null }[];

  for (const row of rows) {
    const raw = row.residence_hall;
    if (!raw) continue;

    const display = raw.trim().replace(/\s+/g, ' ');
    if (!display) continue;

    const canonical = normalizeResidenceHallName(display);
    if (!canonicalToDisplay.has(canonical)) {
      canonicalToDisplay.set(canonical, display);
    }
  }

  return Array.from(canonicalToDisplay.values()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
}

/** Canonical room type badges for cards and display. */
export type RoomTypeBadge = 'Double' | 'Triple' | 'Quad' | 'Quintuple' | 'Single' | 'Suite';

/**
 * Maps internal room type labels to standard dorm terminology for display.
 * Use in DormCard badges and DormSearch filter buttons.
 */
const ROOM_TYPE_TO_DISPLAY: Record<string, string> = {
  '1-Person': 'Single',
  '1-Bed': 'Single',
  'Single': 'Single',
  '2-Person': 'Double',
  '2-Bed': 'Double',
  'Double': 'Double',
  '3-Person': 'Triple',
  '3-Bed': 'Triple',
  'Triple': 'Triple',
  '4-Person': 'Quad',
  '4-Bed': 'Quad',
  'Quad': 'Quad',
  '5-Person': 'Quintuple',
  '5-Bed': 'Quintuple',
  'Quintuple': 'Quintuple',
  'Suite': 'Suite',
};

export function toRoomTypeDisplayLabel(badge: string): string {
  return ROOM_TYPE_TO_DISPLAY[badge] ?? badge;
}

/**
 * Maps accommodation text (from accomodation, housing_type, room_breakdown) to a canonical
 * room type badge. Used for card badges and ensuring a unique set per building.
 * - Doubles: 'Shared Room', '2-Person', 'Double'
 * - Triples: '3-Person Suite' (if not single), 'Triple'
 * - Quads: '4-Person' → Quad; '5-Person' → Quintuple
 * - Singles: 'Private', 'Single', 'Studio'
 * - Fallback: 'Suite'
 */
export function getRoomType(text: string | null | undefined): RoomTypeBadge {
  const t = String(text ?? '').trim();
  const lower = t.toLowerCase();
  if (!t) return 'Suite';

  // Singles/Studios first (take precedence over 3-Person Suite, etc.)
  if (/\bprivate\b/i.test(lower) || /\bsingle\b/i.test(lower) || /\bstudio\b/i.test(lower))
    return 'Single';

  // Triples: '3-Person Suite' or 'Triple'
  if (/3-person suite/i.test(lower) || /\btriple\b/i.test(lower)) return 'Triple';

  // Quads and Quints
  if (/4-person/i.test(lower)) return 'Quad';
  if (/5-person/i.test(lower)) return 'Quintuple';

  // Doubles
  if (/shared room/i.test(lower) || /2-person/i.test(lower) || /\bdouble\b/i.test(lower))
    return 'Double';

  return 'Suite';
}

/**
 * Determines which housing tab (Freshman Housing vs Upperclass & Apartments) a dorm
 * belongs to for display (badge, suggestion label). Uses audienceType and housingType.
 */
const ROOM_TYPE_PRIORITY: readonly string[] = [
  '1-Person',
  'Single',
  '2-Person',
  'Double',
  '3-Person',
  'Triple',
  '4-Person',
  '5-Person',
  '1-Bed',
  '2-Bed',
  'Suite',
] as const;

/** Room-type pill label for DormCard / map carousel (same rules as DormCard). */
export function formatRoomTypeBadge(roomType: string): string {
  const lower = roomType.toLowerCase();

  const bedroomMatch = roomType.match(/(\d+)\s*-\s*[Bb]edroom/i) || roomType.match(/(\d+)\s*[Bb]edroom/i);
  if (bedroomMatch) {
    return `${bedroomMatch[1]}-Bed`;
  }

  const personMatch = roomType.match(/(\d+)-[Pp]erson(?:\s+(?:[Ss]uite|[Aa]partment))?/i);
  if (personMatch) {
    return `${personMatch[1]}-Person`;
  }

  if (/\bprivate\b/i.test(lower) || /\bsingle\b/i.test(lower) || /\bstudio\b/i.test(lower)) {
    return 'Single';
  }
  if (/\bshared room\b/i.test(lower) || /2-person/i.test(lower) || /\bdouble\b/i.test(lower)) {
    return 'Double';
  }
  if (/3-person/i.test(lower) || /\btriple\b/i.test(lower)) {
    return '3-Person';
  }
  if (/4-person/i.test(lower) || /\bquad\b/i.test(lower)) {
    return '4-Person';
  }
  if (/5-person/i.test(lower) || /\bquintuple\b/i.test(lower)) {
    return '5-Person';
  }

  const canonical = getRoomType(roomType);
  switch (canonical) {
    case 'Triple':
      return '3-Person';
    case 'Quad':
      return '4-Person';
    case 'Quintuple':
      return '5-Person';
    default:
      return canonical;
  }
}

function getRoomBadgePriorityIndex(badge: string): number {
  if (badge === '1-Person' || badge === 'Single') {
    return 0;
  }
  const index = ROOM_TYPE_PRIORITY.indexOf(badge);
  return index !== -1 ? index : 999;
}

function sortRoomBadgesByPriority(badges: string[]): string[] {
  return badges.sort((a, b) => {
    const indexA = getRoomBadgePriorityIndex(a);
    const indexB = getRoomBadgePriorityIndex(b);
    if (indexA === indexB) {
      if (a === '1-Person' && b === 'Single') return -1;
      if (a === 'Single' && b === '1-Person') return 1;
      return a.localeCompare(b);
    }
    return indexA - indexB;
  });
}

export type DormCardRoomConfigBadges = {
  badges: string[];
  hasMore: boolean;
  moreCount: number;
};

/** Room-type tags for list/map cards (max 3 visible + overflow count). */
export function getDormCardRoomConfigBadges(dorm: Dorm): DormCardRoomConfigBadges {
  const badgeSet = new Set<string>();

  if (Array.isArray(dorm.variants) && dorm.variants.length > 0) {
    dorm.variants.forEach((variant) => {
      if (variant.roomType) {
        const badge = formatRoomTypeBadge(variant.roomType);
        if (badge) badgeSet.add(badge);
      }
    });
  }

  if (badgeSet.size === 0 && Array.isArray(dorm.roomTypes) && dorm.roomTypes.length > 0) {
    dorm.roomTypes.forEach((roomType) => {
      if (roomType) {
        const badge = formatRoomTypeBadge(roomType);
        if (badge) badgeSet.add(badge);
      }
    });
  }

  const badges = Array.from(badgeSet);
  const deduplicatedBadges = badges.filter((badge) => {
    if (badge === 'Single' && badgeSet.has('1-Person')) {
      return false;
    }
    return true;
  });

  const sortedBadges = sortRoomBadgesByPriority(deduplicatedBadges);
  const seenDisplayLabels = new Set<string>();
  const uniqueByVisibleLabel = sortedBadges.filter((badge) => {
    const visible = toRoomTypeDisplayLabel(badge);
    if (seenDisplayLabels.has(visible)) return false;
    seenDisplayLabels.add(visible);
    return true;
  });
  const displayBadges = uniqueByVisibleLabel.slice(0, 3);
  const remainingCount = uniqueByVisibleLabel.length - 3;

  return {
    badges: displayBadges,
    hasMore: remainingCount > 0,
    moreCount: remainingCount,
  };
}

export function getDormCardHeaderBadges(dorm: Dorm): {
  audienceBadge: string;
  housingBadge: string;
} {
  const tab = getDormTab(dorm);
  const audienceBadge = tab === 'freshman' ? 'Freshman' : 'Upperclass';
  const ht = (dorm.housingType || '').toLowerCase();
  const housingBadge =
    ht.includes('apartment') || ht.includes('off-campus') ? 'Off-Campus' : 'On-Campus';
  return { audienceBadge, housingBadge };
}

/** Audience chip colors: freshman green, upperclass violet (matches map marker colors). */
export function getAudienceBadgeClassName(dorm: Dorm): string {
  const tab = getDormTab(dorm);
  if (tab === 'freshman') {
    return 'bg-primary/10 text-primary border border-primary/20';
  }
  return 'bg-[#7C3AED]/10 text-[#7C3AED] border border-[#7C3AED]/25';
}

export function getDormTab(dorm: Dorm): HousingTab {
  // Special case: Pennsylvania Apartments should always be Freshman
  const name = (dorm.name || '').toLowerCase();
  if (name === 'pennsylvania apartments') return 'freshman';
  
  const ht = (dorm.housingType || '').toLowerCase();
  if (ht.includes('apartment')) return 'upperclass';

  const roomTypes = (dorm.roomTypes || []).map((r) => (r || '').toLowerCase());
  if (roomTypes.some((r) => r.includes('apartment'))) return 'upperclass';

  if (dorm.audienceType === 'Freshman') return 'freshman';
  return 'upperclass';
}

/**
 * Parses who_lives_here string for display. Extracts main audience badge and optional floor-specific notes.
 * Examples:
 *   'First-Year Students' → { badge: 'First Year', housingNotes: undefined }
 *   'Upperclass Students' → { badge: 'Upperclass', housingNotes: undefined }
 *   'First-Year Students; Floors 4-11 for 2024-25' → { badge: 'First Year', housingNotes: 'Floors 4-11 for 2024-25' }
 */
export function formatWhoLivesHere(
  whoLivesHere: string | null | undefined,
  fallbackAudience: 'Freshman' | 'Upperclassman'
): { badge: string; mainLabel: string; housingNotes?: string } {
  const fallbackBadge = fallbackAudience === 'Freshman' ? 'First Year' : 'Upperclass';
  const fallbackLabel = fallbackAudience === 'Freshman' ? 'First-Year Students' : 'Upperclass Students';

  const raw = String(whoLivesHere ?? '').trim();
  if (!raw) {
    return { badge: fallbackBadge, mainLabel: fallbackLabel };
  }

  // Split by semicolon or comma for main part vs notes; look for floor-specific patterns
  const parts = raw.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  let mainAudience = parts[0] || '';
  let floorNotes = parts.slice(1).find((p) =>
    /floors?\s+\d|^\d+-\d+|for\s+\d{4}/i.test(p)
  );
  // Also check if main string contains inline floor notes (e.g., "First-Year Students Floors 4-11 for 2024-25")
  if (!floorNotes && /floors?\s+[\d\-A-Z]+/i.test(mainAudience)) {
    const match = mainAudience.match(/^(.+?)\s+(floors?\s+[\d\-A-Z]+(?:\s+for\s+\d{4}(?:-\d{2})?)?)/i);
    if (match) {
      mainAudience = match[1].trim();
      floorNotes = match[2].trim();
    }
  }

  if (!mainAudience) {
    return { badge: fallbackBadge, mainLabel: fallbackLabel };
  }

  const lower = mainAudience.toLowerCase();
  let badge = mainAudience;
  if (lower.includes('first-year') || lower.includes('first year') || lower.includes('freshman')) {
    badge = 'First Year';
  } else if (lower.includes('upperclass') || lower.includes('upper class')) {
    badge = 'Upperclass';
  } else if (mainAudience.length > 12) {
    badge = mainAudience.length > 16 ? mainAudience.slice(0, 14) + '…' : mainAudience;
  }

  return {
    badge,
    mainLabel: mainAudience,
    housingNotes: floorNotes || undefined,
  };
}

/**
 * Returns true if the building should appear in the given tab. Uses the "any row" rule:
 * if any row in the residence_hall group matches the tab, the entire building is shown.
 * Aligns grid filtering with search (buildings in search must be visible in the grid when on the right tab).
 */
export function belongsInTab(dorm: Dorm, tab: HousingTab): boolean {
  // Special case: Pennsylvania Apartments should always be in Freshman tab
  const name = (dorm.name || '').toLowerCase();
  if (name === 'pennsylvania apartments') {
    return tab === 'freshman';
  }
  
  if (tab === 'upperclass') {
    if (dorm.hasUpperclassRow === true) return true;
    const ht = (dorm.housingType || '').toLowerCase();
    if (ht.includes('apartment')) return true;
    if ((dorm.roomTypes || []).some((r) => (r || '').toLowerCase().includes('apartment'))) return true;
    if ((dorm.name || '').toLowerCase().includes('apartment')) return true; // e.g. Shirley Apartments, Mayflower Apartments
    if (dorm.audienceType === 'Upperclassman') return true; // fallback when hasUpperclassRow unset
    return false;
  }
  return dorm.hasFreshmanRow === true || dorm.audienceType === 'Freshman';
}
