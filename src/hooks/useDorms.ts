import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { Dorm, RoomVariant } from '@/types';
import { getRoomType } from '@/lib/dormUtils';
import { useAuth } from '@/hooks/useAuth';
import { useUniversity } from '@/contexts/UniversityContext';
import { toast } from 'sonner';
import { CARLOW_UNIVERSITY_ID } from '@/config/universities';

// Pitt campus placeholder when image_url is missing (e.g. Mayflower, Shirley)
const DORM_PLACEHOLDER_IMAGE = '/placeholder.svg';
const CARLOW_HOUSING_IMAGE = 'https://www.carlow.edu/wp-content/uploads/2021/01/on-campus-dorm-room.jpg';
const CARLOW_HALLS = new Set(['Frances Warde Hall', 'Dougherty Hall']);

/**
 * Keep the live demo truthful while the matching catalog migration moves through
 * release gates. This only fills missing fields on Carlow's two official halls;
 * database values always win once the migration is applied.
 */
export function withCarlowHousingFallback(row: MasterHousingRow): MasterHousingRow {
  if (row.university_id !== CARLOW_UNIVERSITY_ID || !CARLOW_HALLS.has(row.residence_hall ?? '')) {
    return row;
  }

  return {
    ...row,
    image_url: row.image_url || CARLOW_HOUSING_IMAGE,
    accomodation: row.accomodation || 'Standard double; limited singles for upper-class students',
    details: row.details || "Frances Warde Hall and Dougherty Hall are connected residence halls in the center of Carlow's campus. Standard double rooms are approximately 12 by 16 feet; first-year students share doubles, while upper-class students may apply for a limited number of singles.",
    inroom_amenities: row.inroom_amenities || 'Wall-to-wall carpeting, twin or twin XL bed, desk and chair, chest of drawers, wardrobe or closet, micro-fridge, window air conditioner, streaming HDTV with DVR',
    building_amenities: row.building_amenities || 'Twelve shared lounges, full kitchen, computer lab, study rooms, laundry facilities, 24-hour monitored entrances',
    laundry: row.laundry || 'Free washers and dryers in the residence halls',
    heat_and_air_conditioning: row.heat_and_air_conditioning ?? true,
    wifi_and_cable: row.wifi_and_cable ?? true,
  };
}

/**
 * Row from master_housing (see src/integrations/supabase/types.ts).
 * Filter mappings:
 * - AC: heat_and_air_conditioning → acType
 * - Price: rate_per_term → semesterRate
 * - Freshman/Upperclass: who_lives_here → audienceType
 * - Room style: housing_type, accomodation, room_breakdown → housingType, roomTypes
 * - Amenities (AC, private bath, kitchen): inroom_amenities, building_amenities, amenities_on_each_floor, heat_and_air_conditioning, bathrooms
 */
type MasterHousingRow = Tables<'master_housing'>;

// Keep the highest-traffic housing query explicit. Besides reducing transfer and
// JSON parsing, this prevents a future sensitive/admin column from silently joining
// the student payload just because it was added to master_housing.
export const DORM_SELECT_COLUMNS = 'id, university_id, residence_hall, image_url, rate_per_term, rent_period, laundry, meal_plan_options, heat_and_air_conditioning, details, who_lives_here, housing_type, accomodation, floors, building_amenities, inroom_amenities, community_type, capacity, address, mailing_address, latitude, longitude, building_llc, resident_director, floorplan, terms, important_dates, move_in_date, move_in_parking_lot, move_in_time_window, move_in_entrance, move_in_cart_location, move_in_notes' as const;

// Helper to parse rate (handles string or number with currency formatting)
function parseRate(rate: string | number | null | undefined): number {
  if (typeof rate === 'number') return rate;
  if (typeof rate === 'string') {
    // Remove $, commas, and other non-numeric chars except decimal
    const cleaned = rate.replace(/[^0-9.]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : Math.round(parsed);
  }
  return 0;
}

// who_lives_here → audienceType. NULL, empty, or 'Upperclass Students' / 'Upperclass' → Upperclassman. First-year/freshman → Freshman.
function parseAudienceType(whoLivesHere: string | null | undefined): 'Freshman' | 'Upperclassman' {
  const raw = String(whoLivesHere ?? '').trim();
  if (!raw) return 'Upperclassman';
  const lower = raw.toLowerCase();
  // First-year check runs first: mixed-population halls (e.g. "First-Year and Upperclass
  // Students") badge as Freshman, matching pre-normalization behavior.
  if (lower.includes('first-year') || lower.includes('first year') || lower.includes('freshman')) return 'Freshman';
  if (lower.includes('upperclass students') || lower.includes('upperclass')) return 'Upperclassman';
  return 'Upperclassman';
}

// Coerce master_housing.meal_plan_options to boolean (DB may return boolean or string 'TRUE'/'FALSE')
function parseMealPlanRequired(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toUpperCase() === 'TRUE';
  return false;
}

// Coerce master_housing.floors to number (DB may return number or string)
function parseFloors(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string') {
    const n = parseInt(value.trim(), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Helper to determine badges based on data
function determineBadges(housingType: string | null, floors: number | string | null, roomBreakdown: string | null): ('available' | 'suite' | 'highrise')[] {
  const badges: ('available' | 'suite' | 'highrise')[] = ['available'];
  
  const ht = (housingType || '').toLowerCase();
  const rb = (roomBreakdown || '').toLowerCase();
  
  if (ht.includes('suite') || ht.includes('apartment') || rb.includes('suite')) {
    badges.push('suite');
  }
  
  const floorCount = typeof floors === 'number' ? floors : parseFloors(floors);
  if (floorCount != null && floorCount > 5) {
    badges.push('highrise');
  }
  
  return badges;
}

// Helper to parse AC type
function parseAcType(acString: string | null | undefined): 'Central' | 'Window Unit' | 'None' {
  const s = String(acString || '').trim();
  if (!s) return 'None';
  const lower = s.toLowerCase();
  if (lower.includes('central')) return 'Central';
  if (lower.includes('window') || lower.includes('unit')) return 'Window Unit';
  if (lower.includes('air conditioning') || lower.includes('a/c') || lower.includes('ac')) return 'Central';
  if (lower.includes('no air')) return 'None';
  return 'None';
}

// Extract room type from accommodation or housing_type field
function extractRoomType(row: MasterHousingRow): string {
  // Try to get room type from accomodation field first
  if (row.accomodation) {
    return row.accomodation;
  }
  // Fall back to housing_type (room_breakdown is not a master_housing column — verified against live schema)
  if (row.housing_type) {
    return row.housing_type;
  }
  return 'Standard';
}

// Check if a building name is part of the Bouquet Gardens complex
function isBouquetGardens(name: string | null | undefined): boolean {
  const n = String(name || '').trim();
  return /^Bouquet Gardens [A-J]$/i.test(n);
}

// Extract the building letter from Bouquet Gardens name
function extractBouquetLetter(name: string | null | undefined): string | null {
  const n = String(name || '');
  const match = n.match(/^Bouquet Gardens ([A-J])$/i);
  return match ? (match[1] || '').toUpperCase() : null;
}

// Group rows by building name and merge details
export function deduplicateDorms(rows: MasterHousingRow[]): Dorm[] {
  const groupedByName = new Map<string, MasterHousingRow[]>();
  
  // Group rows by residence_hall name, consolidating Bouquet Gardens
  rows.forEach((row) => {
    let name = (String(row.residence_hall || '').trim()) || 'Unknown Dorm';
    
    // Consolidate all Bouquet Gardens buildings into one
    if (isBouquetGardens(name)) {
      name = 'Bouquet Gardens';
    }
    
    if (!groupedByName.has(name)) {
      groupedByName.set(name, []);
    }
    groupedByName.get(name)!.push(row);
  });
  
  // Merge each group into a single Dorm object
  const mergedDorms: Dorm[] = [];
  
  groupedByName.forEach((dormRows, name) => {
    // Collect all rates and find the minimum
    const rates = dormRows.map(r => parseRate(r.rate_per_term)).filter(r => r > 0);
    const minRate = rates.length > 0 ? Math.min(...rates) : 0;
    
    // Build variants array with all room configurations
    const variants: RoomVariant[] = dormRows.map(row => ({
      id: String(row.id),
      roomType: extractRoomType(row),
      rate: parseRate(row.rate_per_term),
      capacity: row.capacity,
      dimensions: null, // room_dimensions is not a master_housing column (verified against live schema)
      description: row.details,
    }));
    
    // Sort variants by rate (lowest first)
    variants.sort((a, b) => a.rate - b.rate);
    
    // Collect unique canonical room type badges for display (grouping: e.g. five "Shared Room" rows → one "Double" badge)
    const roomTypesSet = new Set<string>();
    dormRows.forEach((row) => {
      // room_breakdown is not a column on master_housing (verified against live schema); dropped.
      const combined = [row.accomodation, row.housing_type]
        .filter(Boolean)
        .join(' ');
      roomTypesSet.add(getRoomType(combined));
    });
    const roomTypes = Array.from(roomTypesSet);
    
    // Collect all amenities (unique) from master_housing for AC, private bath, kitchen filters
    const allAmenities = new Set<string>();
    dormRows.forEach(row => {
      // amenities_on_each_floor and bathrooms are not columns on master_housing (verified against live schema); dropped.
      [row.inroom_amenities, row.building_amenities].forEach(field => {
        if (field) {
          String(field).split(/[,\n]/).forEach(item => {
            const trimmed = item.trim();
            if (trimmed) allAmenities.add(trimmed);
          });
        }
      });
    });
    
    // Use the first row as the base for non-aggregated fields
    const baseRow = dormRows[0];
    // Rent period for display: use the row that has the minimum rate (so label matches the shown price)
    const minRateRow = dormRows.find((r) => parseRate(r.rate_per_term) === minRate) ?? baseRow;
    const rawRentPeriod = minRateRow.rent_period;
    const rentPeriod: 'month' | 'semester' | null =
      rawRentPeriod === 'month' ? 'month' : (rawRentPeriod === 'semester' ? 'semester' : null);

    const hasApartment = dormRows.some((r) => String(r.housing_type || '').toLowerCase().includes('apartment'));
    const apartmentRow = dormRows.find((r) => String(r.housing_type || '').toLowerCase().includes('apartment'));
    
    // Special case: Pennsylvania Apartments should always be Freshman
    const isPennsylvaniaApartments = name.toLowerCase() === 'pennsylvania apartments';
    
    // If any row in the building matches a tab, the entire building appears there (default grouping). Also treat residence_hall name containing "apartment" as upperclass (e.g. Shirley Apartments, Mayflower Apartments).
    // Exception: Pennsylvania Apartments is always Freshman regardless of name or housing_type
    const nameIsApartment = !isPennsylvaniaApartments && (name || '').toLowerCase().includes('apartment');
    const hasUpperclassRow =
      !isPennsylvaniaApartments &&
      (nameIsApartment ||
      dormRows.some(
        (r) => String(r.housing_type || '').toLowerCase().includes('apartment') || parseAudienceType(r.who_lives_here) === 'Upperclassman'
      ));
    const hasFreshmanRow = isPennsylvaniaApartments || dormRows.some((r) => parseAudienceType(r.who_lives_here) === 'Freshman');
    const audienceType =
      isPennsylvaniaApartments ? 'Freshman' : (hasApartment || hasUpperclassRow ? 'Upperclassman' : hasFreshmanRow ? 'Freshman' : 'Upperclassman');

    // Collect all badges from all room types
    const allBadges = new Set<'available' | 'suite' | 'highrise'>();
    dormRows.forEach(row => {
      determineBadges(row.housing_type, row.floors, null).forEach(b => allBadges.add(b));
    });
    
    // Find the first valid image_url from all rows; use placeholder if none. Resilient: missing/broken image must not hide the block.
    const rawImg = dormRows.find((r) => (r.image_url || '').trim())?.image_url;
    const image = (rawImg && String(rawImg).trim()) ? rawImg : DORM_PLACEHOLDER_IMAGE;

    // For Bouquet Gardens, collect sub-building data for the building selector
    let subBuildings: { letter: string; address: string | null; mailingAddress: string | null; roomBreakdown: string | null; id: number }[] | undefined;
    if (name === 'Bouquet Gardens') {
      const buildingMap = new Map<string, { address: string | null; mailingAddress: string | null; roomBreakdown: string | null; id: number }>();
      dormRows.forEach(row => {
        const letter = extractBouquetLetter(row.residence_hall || '');
        if (letter && !buildingMap.has(letter)) {
          buildingMap.set(letter, {
            address: row.address,
            mailingAddress: row.mailing_address,
            roomBreakdown: null, // room_breakdown is not a master_housing column (verified against live schema)
            id: row.id,
          });
        }
      });
      // Sort by letter
      subBuildings = Array.from(buildingMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([letter, data]) => ({ letter, ...data }));
    }

    mergedDorms.push({
      id: String(baseRow.id),
      name, // residence_hall mapped to name
      image,
      badges: Array.from(allBadges),
      semesterRate: minRate,
      minRate, // Lowest price for "From $X" display
      rentPeriod, // Drives "/ month" vs "/ semester" label on cards
      roomTypes: roomTypes.length > 0 ? roomTypes : undefined,
      variants: variants.length > 1 ? variants : undefined, // Only include if multiple variants exist
      laundryPrice: baseRow.laundry || 'In-building',
      mealPlanRequired: parseMealPlanRequired(baseRow.meal_plan_options),
      acType: parseAcType(String(baseRow.heat_and_air_conditioning)),
      heat_and_air_conditioning: baseRow.heat_and_air_conditioning,
      description: baseRow.details || 'On-campus housing.',
      audienceType,
      // Extended fields - take first non-empty value
      address: dormRows.find(r => r.address)?.address || baseRow.address,
      mailingAddress: dormRows.find(r => r.mailing_address)?.mailing_address || baseRow.mailing_address,
      capacity: dormRows.find(r => r.capacity)?.capacity || baseRow.capacity,
      floors: parseFloors(dormRows.find(r => r.floors != null)?.floors ?? baseRow.floors) ?? undefined,
      latitude: baseRow.latitude ? parseFloat(String(baseRow.latitude)) : undefined,
      longitude: baseRow.longitude ? parseFloat(String(baseRow.longitude)) : undefined,
      housingType: apartmentRow?.housing_type || baseRow.housing_type || 'Residence Hall',
      // The following Dorm fields have no backing column on master_housing (verified
      // against the live schema on 2026-07-21): room_breakdown, room_dimensions, gallery,
      // resident_assistant, ada_accommodations, shuttle_access. They were always undefined
      // at runtime; sourced as null here rather than inventing columns. Product gap: these
      // detail sections render empty until the columns (and data) exist.
      roomBreakdown: null,
      roomDimensions: null,
      buildingAmenities: Array.from(allAmenities).join(', ') || 'Standard amenities included',
      inroomAmenities: baseRow.inroom_amenities,
      buildingLLC: dormRows.find(r => r.building_llc)?.building_llc ?? baseRow.building_llc ?? null,
      buildingLLCs: (() => {
        const seen = new Set<string>();
        dormRows.forEach(row => {
          const raw = row.building_llc;
          if (!raw || !String(raw).trim()) return;
          String(raw)
            .split(/[,;/]+/)
            .map((s) => s.trim())
            .filter(Boolean)
            .forEach((s) => seen.add(s));
        });
        return seen.size > 0 ? Array.from(seen) : undefined;
      })(),
      floorplan: baseRow.floorplan,
      gallery: null,
      whoLivesHere: dormRows.find(r => r.who_lives_here)?.who_lives_here ?? baseRow.who_lives_here,
      communityType: dormRows.find(r => r.community_type)?.community_type ?? baseRow.community_type ?? null,
      residentAssistant: null,
      residentDirector: baseRow.resident_director ?? undefined,
      adaAccommodations: null,
      shuttleAccess: null,
      terms: baseRow.terms,
      importantDates: dormRows.find(r => r.important_dates)?.important_dates ?? baseRow.important_dates,
      moveInDate: dormRows.find(r => r.move_in_date)?.move_in_date ?? baseRow.move_in_date ?? null,
      moveInParkingLot: dormRows.find(r => r.move_in_parking_lot)?.move_in_parking_lot ?? baseRow.move_in_parking_lot ?? null,
      moveInTimeWindow: dormRows.find(r => r.move_in_time_window)?.move_in_time_window ?? baseRow.move_in_time_window ?? null,
      moveInEntrance: dormRows.find(r => r.move_in_entrance)?.move_in_entrance ?? baseRow.move_in_entrance ?? null,
      moveInCartLocation: dormRows.find(r => r.move_in_cart_location)?.move_in_cart_location ?? baseRow.move_in_cart_location ?? null,
      moveInNotes: dormRows.find(r => r.move_in_notes)?.move_in_notes ?? baseRow.move_in_notes ?? null,
      subBuildings, // For Bouquet Gardens building selector
      hasUpperclassRow,
      hasFreshmanRow,
    });
  });
  
  return mergedDorms;
}

/** Flat list for map: one entry per master_housing row with valid coords. Uses full residence_hall name (e.g. "Bouquet Gardens A") so each building shows as a distinct pin. */
function buildMapDorms(rows: MasterHousingRow[]): Dorm[] {
  const mapDorms: Dorm[] = [];
  for (const row of rows) {
    const lat = row.latitude ? parseFloat(String(row.latitude)) : NaN;
    const lng = row.longitude ? parseFloat(String(row.longitude)) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const name = (String(row.residence_hall || '').trim()) || 'Residence Hall';
    mapDorms.push({
      id: String(row.id),
      name,
      image: (row.image_url && String(row.image_url).trim()) ? row.image_url : DORM_PLACEHOLDER_IMAGE,
      badges: ['available'],
      semesterRate: parseRate(row.rate_per_term),
      rent_period: row.rent_period ?? undefined,
      rentPeriod: row.rent_period === 'month' ? 'month' : (row.rent_period === 'semester' ? 'semester' : null),
      laundryPrice: row.laundry || 'In-building',
      mealPlanRequired: parseMealPlanRequired(row.meal_plan_options),
      acType: parseAcType(String(row.heat_and_air_conditioning)),
      heat_and_air_conditioning: row.heat_and_air_conditioning,
      description: row.details || 'On-campus housing.',
      audienceType: parseAudienceType(row.who_lives_here),
      latitude: lat,
      longitude: lng,
      housingType: row.housing_type || 'Residence Hall',
    });
  }
  return mapDorms;
}

async function fetchDormsFromSupabase(universityId: string): Promise<{ dorms: Dorm[]; mapDorms: Dorm[] }> {
  const { data, error } = await supabase
    .from('master_housing')
    .select(DORM_SELECT_COLUMNS)
    .eq('university_id', universityId)
    .limit(10000);

  if (error) {
    console.error('Error fetching dorms:', error);
    toast.error('Failed to load dorms');
    throw error instanceof Error ? error : new Error('Failed to fetch dorms');
  }

  const rows = ((data ?? []) as MasterHousingRow[]).map(withCarlowHousingFallback);
  // Force grouping first: group by residence_hall before any filtering. Filtering (tab, search, etc.) happens in Index.
  const dorms = deduplicateDorms(rows);

  // Sort: Freshman first
  dorms.sort((a, b) => {
    if (a.audienceType === 'Freshman' && b.audienceType !== 'Freshman') return -1;
    if (a.audienceType !== 'Freshman' && b.audienceType === 'Freshman') return 1;
    return 0;
  });

  const mapDorms = buildMapDorms(rows);
  return { dorms, mapDorms };
}

export function useDorms() {
  const { user } = useAuth();
  const { university } = useUniversity();
  const isAuthenticated = Boolean(user);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dorms', isAuthenticated ? 'authenticated' : 'anon', university.id],
    queryFn: () => fetchDormsFromSupabase(university.id),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const normalizedError =
    error == null ? null : error instanceof Error ? error : new Error(String(error));

  return {
    dorms: data?.dorms ?? [],
    mapDorms: data?.mapDorms ?? [],
    isLoading,
    error: normalizedError,
    refetch,
  };
}

// Export a function to find a dorm by ID (returns the merged dorm)
export async function findDormById(dormId: string): Promise<Dorm | null> {
  try {
    const { data: singleRow, error: singleError } = await supabase
      .from('master_housing')
      .select('residence_hall, university_id')
      .eq('id', parseInt(dormId, 10))
      .single();

    if (singleError || !singleRow) return null;

    const buildingName = (singleRow as { residence_hall: string | null }).residence_hall;
    const universityId = (singleRow as { university_id: string | null }).university_id;
    if (!buildingName || !universityId) return null;

    const { data, error } = await supabase
      .from('master_housing')
      .select(DORM_SELECT_COLUMNS)
      .eq('residence_hall', buildingName)
      .eq('university_id', universityId);

    if (error) {
      console.error('Error finding dorm by ID:', error);
      return null;
    }

    const rows = (data ?? []) as MasterHousingRow[];
    const mergedDorms = deduplicateDorms(rows);
    return mergedDorms[0] || null;
  } catch (err) {
    console.error('Error finding dorm by ID:', err);
    return null;
  }
}
