import { Dorm } from '@/types';
import { useTranslation } from 'react-i18next';
import {
  Home, Wind, Building2,
  Mail, Copy, Check, Calendar, ScrollText,
  Accessibility, User, Users, MapPin,
  ExternalLink
} from 'lucide-react';
import { DormMiniMap } from '@/components/DormMiniMapLazy';
import { useState, useMemo } from 'react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { supabase } from '@/integrations/supabase/client';
import { FloorPlanGallery } from './FloorPlanGallery';
import { MoveInInfoCard } from './MoveInInfoCard';
import { ApplyToHallCard } from './ApplyToHallCard';
import { BuildingChatsWidget } from '@/components/dorm-portal/BuildingChatsWidget';
import { DormRatingsCard } from '@/components/dorm-portal/DormRatingsCard';
import { formatWhoLivesHere } from '@/lib/dormUtils';
import { parseFloorplanUrls, type FloorPlanImage } from '@/lib/floorplanUtils';
import { useAuth } from '@/hooks/useAuth';
import { useUniversity } from '@/contexts/UniversityContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { safeTel, safeMailToEmail } from '@/lib/sanitize';
import { useIsMobile } from '@/hooks/use-mobile';

interface SubBuilding {
  letter: string;
  address: string | null;
  mailingAddress: string | null;
  roomBreakdown: string | null;
  id: number;
}

interface OverviewTabProps {
  dorm: Dorm;
  selectedSubBuilding?: SubBuilding;
  onViewMap?: () => void;
  /** User's floor for this building (e.g. "4" or "Floor 4") to highlight in move-in timeline */
  userFloor?: string | null;
}

/** Explicit shape for master_housing row to avoid deep Supabase type inference (TS2589/TS2590) */
interface MasterHousingRow {
  floorplan?: string | null;
  address?: string | null;
  mailing_address?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  laundry?: string | null;
  heat_and_air_conditioning?: string | null;
  wifi_and_cable?: string | null;
  meal_plan_options?: boolean | null;
  inroom_amenities?: string | null;
  building_amenities?: string | null;
  window_coverings?: string | null;
  mailing_services?: string | null;
  who_lives_here?: string | null;
  community_type?: string | null;
  resident_director?: string | null;
}


// Parse resident_director string. Format: 'Name, Phone, Email'
// Example: 'Jane Staff, 412-555-0100, staff123@pitt.edu'
interface ParsedResidentDirector {
  name: string | null;
  phone: string | null;
  email: string | null;
}

function hasResidentDirectorData(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  const trimmed = String(raw).trim();
  if (!trimmed) return false;
  if (trimmed.toUpperCase() === 'EMPTY') return false;
  return true;
}

function parseResidentDirector(raw: string | null | undefined): ParsedResidentDirector {
  const result: ParsedResidentDirector = { name: null, phone: null, email: null };
  if (!raw || !raw.trim()) return result;

  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return result;

  const phoneRegex = /^\d{3}-\d{3}-\d{4}$/;
  const emailRegex = /\S+@\S+\.\S+/;

  let name: string | null = null;
  let phone: string | null = null;
  let email: string | null = null;

  for (const p of parts) {
    if (phoneRegex.test(p)) phone = p;
    else if (emailRegex.test(p)) email = p;
    else if (!name && p) name = p;
  }

  result.name = name;
  result.phone = phone;
  result.email = email;
  return result;
}

/** Split resident_director by multiple entries (semicolon, newline, or pipe). Returns array of parsed directors. */
function parseResidentDirectors(raw: string | null | undefined): ParsedResidentDirector[] {
  if (!raw || !raw.trim()) return [];
  const chunks = raw.split(/[;\n|]+/).map((s) => s.trim()).filter(Boolean);
  if (chunks.length <= 1) {
    const single = parseResidentDirector(raw);
    return (single.name || single.phone || single.email) ? [single] : [];
  }
  const parsed = chunks.map((chunk) => parseResidentDirector(chunk)).filter(
    (p) => p.name || p.phone || p.email
  );
  return parsed;
}


// Parse heat_and_air_conditioning (string column; treat as boolean-ish)
function parseHeatAndAC(raw: string | null | undefined): boolean {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  if (lower === 'true' || lower.includes('yes') || lower.includes('included') ||
      lower.includes('central') || lower.includes('air') || lower.includes('heating')) return true;
  if (lower === 'false' || lower.includes('none') || lower.includes('no ')) return false;
  return false;
}

// Parse window_coverings (string column; treat as boolean-ish)
function parseWindowCoverings(raw: string | null | undefined): boolean {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  return lower === 'true' || lower.includes('yes') || lower.includes('included');
}

// Split amenity string into list items (handles comma, semicolon, newline separators)
function parseAmenityList(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}


// Parse move-in dates into structured timeline data
interface MoveInDateEntry {
  floorRange: string; // e.g., "G-1", "2-3", "7"
  primaryFloorNumber: string; // First number/letter for badge (e.g., "G", "2", "7")
  date: string; // e.g., "Thu 8/21/25"
  time: string; // e.g., "9am-1pm"
  description: string; // Additional context like "First-Year Students Only"
  fullText: string; // Original text
}

function parseMoveInDates(importantDates: string | null | undefined): MoveInDateEntry[] {
  if (!importantDates || !importantDates.trim()) {
    return [];
  }

  const entries: MoveInDateEntry[] = [];
  const lines = importantDates.split(';').map(s => s.trim()).filter(Boolean);

  for (const line of lines) {
    // Extract floor range - patterns like "Floors G-1", "Floors 2-3", "Floor 7", "G-1", etc.
    const floorMatch = line.match(/(?:floors?|floor)\s+([A-Z]?\d+(?:-\d+)?|[A-Z]-\d+)/i) ||
                       line.match(/([A-Z]-\d+|[A-Z]?\d+-\d+)(?:\s*:)/i);
    
    let floorRange = '';
    let primaryFloorNumber = '';
    
    if (floorMatch) {
      floorRange = floorMatch[1].trim();
      // Extract primary floor number (first number or letter-number combo)
      // Handle "G-1" -> "G", "2-3" -> "2", "7" -> "7"
      if (floorRange.includes('-')) {
        primaryFloorNumber = floorRange.split('-')[0];
      } else {
        primaryFloorNumber = floorRange;
      }
    }

    // Extract date pattern - formats like "Sun 8/17/25", "Thu 8/21/25", "Aug 21", etc.
    const dateMatch = line.match(/([A-Za-z]{3})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i) ||
                      line.match(/([A-Za-z]+\.?\s+\d{1,2}|\d{1,2}\/[/\d]+)/i);
    
    let date = '';
    if (dateMatch) {
      if (dateMatch[2]) {
        // Format: "Thu 8/21/25"
        date = `${dateMatch[1]} ${dateMatch[2]}`;
      } else {
        date = dateMatch[1];
      }
    }

    // Extract time range - patterns like "8am-7pm", "9am-1pm", "1pm-5pm"
    const timeMatch = line.match(/(\d{1,2}(?:am|pm)-\d{1,2}(?:am|pm))/i);
    const time = timeMatch ? timeMatch[1] : '';

    // Extract description (text before the floor/date info, before colon)
    let description = '';
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const beforeColon = line.substring(0, colonIndex).trim();
      // Only use as description if it doesn't contain floor info
      if (beforeColon && !beforeColon.toLowerCase().includes('floor')) {
        description = beforeColon;
      }
    }

    // If no floor found but we have a description, try to infer from context
    if (!floorRange && description) {
      // Check if description contains floor-like patterns
      const descFloorMatch = description.match(/([A-Z]-\d+|[A-Z]?\d+-\d+)/i);
      if (descFloorMatch) {
        floorRange = descFloorMatch[1];
        primaryFloorNumber = floorRange.split('-')[0];
      }
    }

    entries.push({
      floorRange: floorRange || (description ? 'All Floors' : ''),
      primaryFloorNumber: primaryFloorNumber || (description ? 'All' : '?'),
      date,
      time,
      description,
      fullText: line,
    });
  }

  return entries;
}


function parseMoveInDateForSort(dateStr: string): number {
  if (!dateStr) return 0;
  const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (match) {
    const [, month, day, year] = match;
    const y = year.length === 2 ? 2000 + parseInt(year, 10) : parseInt(year, 10);
    return new Date(y, parseInt(month, 10) - 1, parseInt(day, 10)).getTime();
  }
  return new Date(dateStr).getTime() || 0;
}

/** Compact label for date pill: e.g. "Sun 8/17" */
function formatMoveInPillLabel(dateStr: string): string {
  if (!dateStr || dateStr === 'TBD') return 'TBD';
  const match = dateStr.match(/([A-Za-z]{3})\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (match) {
    const [, weekday = '', month, day] = match;
    return `${weekday} ${month}/${day}`;
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
  }
  return dateStr;
}


/** One row in the full move-in schedule: Floor | Date • Time */
interface MoveInScheduleRow {
  floorLabel: string;
  dateShort: string;
  timeDisplay: string;
  sortKey: number;
  timeStr: string;
  floorNumber: number;
}

/** Numeric floor for sorting: "Floor 4" → 4; "Floor 2" → 2. Non-numeric (e.g. "Floor G-1") sorts after numbers. */
function getFloorSortNumber(floorLabel: string): number {
  const match = floorLabel.match(/^Floor\s+(\d+)$/i);
  if (match) return parseInt(match[1], 10);
  const digitsOnly = floorLabel.replace(/\D/g, '');
  const num = digitsOnly ? parseInt(digitsOnly, 10) : NaN;
  return Number.isNaN(num) ? Number.POSITIVE_INFINITY : num;
}

function buildMoveInScheduleRows(entries: MoveInDateEntry[]): MoveInScheduleRow[] {
  const rows: MoveInScheduleRow[] = [];
  for (const entry of entries) {
    const dateShort = formatMoveInPillLabel(entry.date?.trim() || 'TBD');
    const timeRaw = entry.time?.trim() || 'TBD';
    const timeDisplay = timeRaw === 'TBD' ? timeRaw : timeRaw.replace('-', ' – ');
    const sortKey = parseMoveInDateForSort(entry.date?.trim() || '');
    const labels = expandFloorRangeToLabels(entry.floorRange);
    if (labels.length === 0) continue;
    for (const floorLabel of labels) {
      rows.push({
        floorLabel,
        dateShort,
        timeDisplay,
        sortKey,
        timeStr: timeRaw,
        floorNumber: getFloorSortNumber(floorLabel),
      });
    }
  }
  rows.sort((a, b) => {
    if (a.floorNumber !== b.floorNumber) return a.floorNumber - b.floorNumber;
    if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
    const t = a.timeStr.localeCompare(b.timeStr);
    if (t !== 0) return t;
    return a.floorLabel.localeCompare(b.floorLabel);
  });
  return rows;
}

/** Expand a floor range into individual floor labels for floor-first UI */
function expandFloorRangeToLabels(floorRange: string): string[] {
  const r = floorRange?.trim();
  if (!r || r === 'All Floors') return [];
  const lower = r.toLowerCase();
  if (lower.startsWith('floor') || lower.startsWith('floors')) {
    const numPart = r.replace(/^floors?\s+/i, '').trim();
    if (numPart.includes('-')) {
      const [a, b] = numPart.split('-').map((s) => s.trim());
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      if (!isNaN(na) && !isNaN(nb)) {
        return Array.from({ length: nb - na + 1 }, (_, i) => `Floor ${na + i}`);
      }
      return [`Floor ${numPart}`];
    }
    const n = parseInt(numPart, 10);
    if (!isNaN(n)) return [`Floor ${n}`];
    return [`Floor ${numPart}`];
  }
  if (/^[A-Za-z]-\d+$/i.test(r)) return [`Floor ${r}`];
  const single = parseInt(r, 10);
  if (!isNaN(single)) return [`Floor ${single}`];
  return [`Floor ${r}`];
}

// Bouquet Gardens specific building data
const BOUQUET_GARDENS_DATA: Record<string, { address: string; units: string[] }> = {
  'A': { address: '3990 Fifth Ave, Pittsburgh, PA 15213', units: ['4-Person Apartments'] },
  'B': { address: '301 Oakland Ave, Pittsburgh, PA 15213', units: ['4-Person Apartments'] },
  'C': { address: '315 Oakland Ave, Pittsburgh, PA 15213', units: ['4-Person Apartments'] },
  'D': { address: '245 Oakland Ave, Pittsburgh, PA 15213', units: ['4-Person Apartments'] },
  'E': { address: '4910 Sennott St, Pittsburgh, PA 15213', units: ['4-Person Apartments'] },
  'F': { address: '235 Oakland Ave, Pittsburgh, PA 15213', units: ['4-Person Apartments'] },
  'G': { address: '4900 Sennott St, Pittsburgh, PA 15213', units: ['4-Person Apartments'] },
  'H': { address: '215 Oakland Ave, Pittsburgh, PA 15213', units: ['4-Person Apartments'] },
  'J': { address: '315 Oakland Ave, Pittsburgh, PA 15213', units: ['2-Person Apartments', '3-Person Apartments', '4-Person Apartments'] },
};

const BOUQUET_GARDENS_PRICE = 5805;

/**
 * Panther Central — Pitt's housing office, and the legacy app-wide address
 * fallback from when Pitt was the only tenant. Every use MUST be gated on
 * `university.slug === 'pitt'`: it is a Pitt fact, and showing it to another
 * school's students is a wrong address, not a neutral placeholder.
 */
const PANTHER_CENTRAL_ADDRESS = '3990 Fifth Avenue, Pittsburgh, PA 15213';
const PANTHER_CENTRAL_CITY_STATE_ZIP = 'Pittsburgh, PA 15213';

// Format address for display (e.g. ensure "3990 Fifth Avenue, Pittsburgh, PA 15213")
function formatAddressForDisplay(raw: string | null | undefined, fallback = ''): string {
  if (!raw || !raw.trim()) return fallback;
  const s = raw.trim();
  // If already "Street, City, ST ZIP", use as-is; else try to insert comma before "Pittsburgh" if missing
  if (/,\s*Pittsburgh/i.test(s)) return s;
  const cityMatch = s.match(/\s+(Pittsburgh,?\s+PA\s+\d{5})/i);
  if (cityMatch) {
    const idx = s.indexOf(cityMatch[1]);
    const street = s.slice(0, idx).trim();
    const rest = s.slice(idx).trim();
    return street.endsWith(',') ? `${street} ${rest}` : `${street}, ${rest}`;
  }
  return s;
}

/** Normalize user floor for comparison with move-in floor labels (e.g. "4" or "Floor 4" -> "Floor 4") */
function normalizeFloorLabel(value: string | null | undefined): string | null {
  if (value == null || String(value).trim() === '') return null;
  const s = String(value).trim();
  const lower = s.toLowerCase();
  if (lower.startsWith('floor')) return s.charAt(0).toUpperCase() + s.slice(1).trim();
  return `Floor ${s}`;
}

export function OverviewTab({ dorm, selectedSubBuilding, onViewMap, userFloor }: OverviewTabProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { university } = useUniversity();
  const [copied, setCopied] = useState(false);
  const [supabaseDisplayName, setSupabaseDisplayName] = useState<string | null>(null);
  const [subBuildingFloorPlans, setSubBuildingFloorPlans] = useState<FloorPlanImage[]>([]);
  const [fetchedAddress, setFetchedAddress] = useState<string | null>(null);
  const [fetchedMailingAddress, setFetchedMailingAddress] = useState<string | null>(null);
  const [fetchedAmenities, setFetchedAmenities] = useState<{
    laundry: string | null;
    heat_and_air_conditioning: string | null;
    wifi_and_cable: string | null;
    meal_plan_options: boolean | null;
  } | null>(null);
  const [fetchedProfile, setFetchedProfile] = useState<{
    inroom_amenities: string | null;
    building_amenities: string | null;
    window_coverings: string | null;
    mailing_services: string | null;
    who_lives_here: string | null;
    community_type: string | null;
    resident_director: string | null;
  } | null>(null);
  const [fetchedCoordinates, setFetchedCoordinates] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  // Fetch display name from Supabase profiles for mailing address
  React.useEffect(() => {
    if (!user?.id) {
      setSupabaseDisplayName(null);
      return;
    }
    supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        const name = (data as { full_name?: string | null } | null)?.full_name?.trim();
        setSupabaseDisplayName(name || null);
      });
  }, [user?.id]);

  // Check if this is Bouquet Gardens
  const isBouquetGardens = dorm.name === 'Bouquet Gardens';
  
  // Get Bouquet Gardens specific data if applicable
  const bouquetData = isBouquetGardens && selectedSubBuilding 
    ? BOUQUET_GARDENS_DATA[selectedSubBuilding.letter] 
    : null;

  // Fetch floorplan, address, mailing_address, and amenities from master_housing (sub-building when applicable, else main dorm)
  React.useEffect(() => {
    const id = selectedSubBuilding?.id ?? (dorm.id ? Number(dorm.id) : null);
    if (id == null) {
      setSubBuildingFloorPlans([]);
      setFetchedAddress(null);
      setFetchedMailingAddress(null);
      setFetchedAmenities(null);
      setFetchedProfile(null);
      setFetchedCoordinates(null);
      return;
    }
    const selectCols = selectedSubBuilding?.id
      ? 'floorplan, address, mailing_address, latitude, longitude, laundry, heat_and_air_conditioning, wifi_and_cable, meal_plan_options, inroom_amenities, building_amenities, window_coverings, mailing_services, who_lives_here, community_type, resident_director'
      : 'address, mailing_address, latitude, longitude, laundry, heat_and_air_conditioning, wifi_and_cable, meal_plan_options, inroom_amenities, building_amenities, window_coverings, mailing_services, who_lives_here, community_type, resident_director';
    // selectCols is a dynamic string, so Supabase's generic .select() blows up the
    // type resolver (TS2589/2590). Reach the table through a minimal typed shape so
    // the dynamic select never triggers the deep query-type instantiation.
    const query = (
      supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (k: string, v: string | number) => {
              single: () => Promise<{ data: MasterHousingRow | null; error: { message: string } | null }>;
            };
          };
        };
      }
    )
      .from('master_housing')
      .select(selectCols)
      .eq('id', id)
      .single();
    query.then(({ data, error }) => {
        if (error || !data) {
          if (selectedSubBuilding?.id) {
            setSubBuildingFloorPlans([]);
          }
          setFetchedAddress(null);
          setFetchedMailingAddress(null);
          setFetchedAmenities(null);
          setFetchedProfile(null);
          setFetchedCoordinates(null);
          return;
        }
        if (selectedSubBuilding?.id) {
          const fp = data.floorplan;
          if (fp) {
            setSubBuildingFloorPlans(parseFloorplanUrls(fp));
          } else {
            setSubBuildingFloorPlans([]);
          }
        } else {
          setSubBuildingFloorPlans([]);
        }
        const d = data as MasterHousingRow;
        const lat = d.latitude != null && d.latitude !== '' ? parseFloat(String(d.latitude)) : null;
        const lng = d.longitude != null && d.longitude !== '' ? parseFloat(String(d.longitude)) : null;
        setFetchedCoordinates(
          lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
            ? { latitude: lat, longitude: lng }
            : null
        );
        const addr = d.address;
        setFetchedAddress(addr && String(addr).trim() ? String(addr).trim() : null);
        const mail = d.mailing_address;
        setFetchedMailingAddress(mail && String(mail).trim() ? String(mail).trim() : null);
        setFetchedAmenities({
          laundry: d.laundry ?? null,
          heat_and_air_conditioning: d.heat_and_air_conditioning ?? null,
          wifi_and_cable: d.wifi_and_cable ?? null,
          meal_plan_options: d.meal_plan_options ?? null,
        });
        setFetchedProfile({
          inroom_amenities: d.inroom_amenities ?? null,
          building_amenities: d.building_amenities ?? null,
          window_coverings: d.window_coverings ?? null,
          mailing_services: d.mailing_services ?? null,
          who_lives_here: d.who_lives_here ?? null,
          community_type: d.community_type ?? null,
          resident_director: d.resident_director ?? null,
        });
      });
  }, [selectedSubBuilding?.id, dorm.id]);

  // Use selected sub-building name if available
  const displayName = selectedSubBuilding 
    ? `${dorm.name} ${selectedSubBuilding.letter}` 
    : dorm.name;

  // Building id + residence-hall name for the BuildingChatsWidget. Must match
  // the values stored in profiles.current_dorm / master_housing.residence_hall
  // for the dorm-match RLS check to succeed.
  const widgetBuildingId = useMemo<number | null>(() => {
    if (selectedSubBuilding?.id != null) {
      return selectedSubBuilding.id;
    }
    const fromVariants = dorm.variants?.[0]?.id;
    if (fromVariants != null) {
      const n = Number(fromVariants);
      return Number.isFinite(n) ? n : null;
    }
    const baseId = Number(dorm.id);
    return Number.isFinite(baseId) ? baseId : null;
  }, [selectedSubBuilding, dorm]);

  const widgetResidenceHallName = useMemo<string>(() => {
    if (selectedSubBuilding?.letter && dorm.name === 'Bouquet Gardens') {
      return `Bouquet Gardens ${selectedSubBuilding.letter}`;
    }
    return dorm.name;
  }, [selectedSubBuilding, dorm.name]);

  // Address for At a Glance (physical location): keep using address column only
  const glanceAddress = formatAddressForDisplay(
    fetchedAddress ?? bouquetData?.address ?? selectedSubBuilding?.address ?? dorm.address,
    // Legacy Pitt-wide default (Panther Central); wrong for other tenants' dorms.
    university.slug === 'pitt' ? PANTHER_CENTRAL_ADDRESS : '',
  );

  // Mail Address: use mailing_address column; mailing_services for building-specific instructions (e.g., 'Towers Mail Center').
  const mailSource = fetchedMailingAddress ?? selectedSubBuilding?.mailingAddress ?? dorm.mailingAddress;
  const mailingServices = fetchedProfile?.mailing_services;
  const mailLines = mailSource
    ? mailSource.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    : [];
  // Same gate as `glanceAddress` above: the Panther Central fallback is a Pitt
  // fact, not a DormCheck one. Ungated it printed a Pitt mailing address inside
  // a CMU student's mail card — and the copy button put it on their clipboard.
  // Other tenants get nothing rather than something wrong.
  const displayAddress =
    bouquetData?.address ||
    selectedSubBuilding?.address ||
    dorm.address ||
    (university.slug === 'pitt' ? PANTHER_CENTRAL_ADDRESS : '');
  const addressParts = displayAddress.split(', ');
  const streetAddress = addressParts[0] || '';
  const cityStateZip =
    addressParts.slice(1).join(', ') ||
    (university.slug === 'pitt' ? PANTHER_CENTRAL_CITY_STATE_ZIP : '');

  // Get price - use Bouquet Gardens price if applicable
  const displayPrice = isBouquetGardens ? BOUQUET_GARDENS_PRICE : dorm.semesterRate;

  // First line of Mail Address: display_name from profile, then user metadata, then fallback
  const mailNameLine = user
    ? (supabaseDisplayName || (user.user_metadata?.full_name as string | undefined) || user.email?.split('@')[0] || 'Your Name')
    : 'Your Name';

  const handleCopy = () => {
    const lines: string[] = [mailNameLine];
    if (mailLines.length > 0) {
      lines.push(...mailLines.slice(1));
    } else {
      lines.push(displayName);
      if (mailingServices?.trim()) lines.push(mailingServices.trim());
      // Empty when the dorm has no address and the tenant isn't Pitt — copying
      // blank lines is better than copying somebody else's housing office.
      lines.push(...[streetAddress, cityStateZip].filter(Boolean));
    }
    const text = lines.join('\n');
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success(t('housing:portal.overview.addressCopied'));
  };

  const hasAC = fetchedAmenities?.heat_and_air_conditioning != null
    ? parseHeatAndAC(fetchedAmenities.heat_and_air_conditioning)
    : (dorm.acType !== 'None');
  const lat = fetchedCoordinates?.latitude ?? dorm.latitude;
  const lng = fetchedCoordinates?.longitude ?? dorm.longitude;
  const hasCoords =
    lat != null &&
    lng != null &&
    Number.isFinite(typeof lat === 'number' ? lat : parseFloat(String(lat))) &&
    Number.isFinite(typeof lng === 'number' ? lng : parseFloat(String(lng)));
  const latNum = typeof lat === 'number' ? lat : parseFloat(String(lat ?? ''));
  const lngNum = typeof lng === 'number' ? lng : parseFloat(String(lng ?? ''));

  const sectionTitle = cn(
    'font-semibold text-foreground',
    isMobile ? 'text-base tracking-tight mb-3' : 'text-xl text-foreground mb-3',
  );
  const sectionBlock = cn('border-b border-border', isMobile ? 'pb-5' : 'py-6');
  const bodyCopy = cn(
    'text-muted-foreground',
    isMobile ? 'text-sm leading-relaxed' : 'leading-relaxed',
  );
  const groupLabel = cn(
    'font-semibold text-foreground flex items-center gap-2',
    isMobile ? 'text-sm mb-2' : 'text-sm text-foreground mb-3',
  );
  const captionText = cn(
    'text-muted-foreground',
    isMobile ? 'text-xs leading-relaxed mb-3' : 'text-xs mb-2',
  );

  const glanceStats = [
    dorm.capacity
      ? { Icon: Users, label: String(dorm.capacity) }
      : null,
    dorm.floors != null && Number.isFinite(dorm.floors)
      ? { Icon: Building2, label: `${dorm.floors} Floors` }
      : null,
    { Icon: Wind, label: hasAC ? 'AC Included' : 'No AC' },
  ].filter((item) => item != null);

  return (
    <div
      className={cn(
        'w-full animate-fade-in',
        isMobile ? 'space-y-5 py-4' : 'space-y-6 py-6',
      )}
    >
      {/* Apply to this hall - Pitt only; opens StarRez, links to the native Get Housing guide */}
      {university.slug === 'pitt' && <ApplyToHallCard dorm={dorm} />}

      {/* Move-In Info - admin-curated logistics card; renders only if any move_in_* field is set */}
      <MoveInInfoCard dorm={dorm} />

      {/* Building Chats - sign-in CTA for guests; full widget for users whose
          current_dorm matches this building; hidden otherwise. */}
      <BuildingChatsWidget
        buildingId={widgetBuildingId}
        residenceHallName={widgetResidenceHallName}
      />

      {/* Student ratings - per-category averages for everyone; the entry form
          only for residents of this building (enforced in RLS, not here). */}
      <DormRatingsCard
        buildingId={widgetBuildingId}
        dormName={widgetResidenceHallName}
      />

      {/* A. About & Community */}
        <section className={cn('border-b border-border', isMobile ? 'pb-5' : 'pb-6')}>
          <h2 className={sectionTitle}>{t('housing:portal.overview.aboutSection', { name: displayName })}</h2>
          {glanceAddress && (
            <div className={cn('flex items-start gap-2.5', captionText, 'mb-4')}>
              <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" aria-hidden />
              <span>{glanceAddress}</span>
            </div>
          )}
          <div
            className={cn(
              'mb-4 grid items-stretch overflow-hidden rounded-xl border border-border bg-muted/80 divide-x divide-border md:max-w-xl',
              glanceStats.length === 1 && 'grid-cols-1',
              glanceStats.length === 2 && 'grid-cols-2',
              glanceStats.length >= 3 && 'grid-cols-3',
            )}
          >
            {glanceStats.map(({ Icon, label }) => (
              <div
                key={label}
                className="flex min-w-0 flex-col items-center justify-center gap-1.5 px-2 py-3 text-center md:py-4"
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground md:h-5 md:w-5" aria-hidden />
                <span className="text-[11px] font-medium leading-tight text-muted-foreground md:text-sm">
                  {label}
                </span>
              </div>
            ))}
          </div>
          <p className={cn(bodyCopy, 'mb-4')}>
            {dorm.description}
          </p>
          {(() => {
            const whoRaw = fetchedProfile?.who_lives_here ?? dorm.whoLivesHere ?? null;
            const communityRaw = fetchedProfile?.community_type ?? dorm.communityType ?? null;
            const { mainLabel, housingNotes } = formatWhoLivesHere(whoRaw, dorm.audienceType);
            const hasWho = mainLabel && mainLabel.trim();
            const hasCommunity = communityRaw && communityRaw.trim();
            const hasNotes = housingNotes && housingNotes.trim();
            const llcs = dorm.buildingLLCs && dorm.buildingLLCs.length > 0
              ? dorm.buildingLLCs
              : (dorm.buildingLLC && dorm.buildingLLC.trim()
                ? dorm.buildingLLC.split(/[,;/]+/).map((s) => s.trim()).filter(Boolean)
                : []);
            const hasTerms = dorm.terms && dorm.terms.trim();
            if (!hasWho && !hasCommunity && !hasNotes && llcs.length === 0 && !hasTerms) return null;
            return (
              <div className={cn('flex flex-wrap', isMobile ? 'gap-2.5' : 'gap-2')}>
                {hasWho && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted text-foreground text-sm font-medium">
                    <Users className="w-3.5 h-3.5 text-muted-foreground" />
                    {mainLabel}
                  </span>
                )}
                {hasCommunity && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted text-foreground text-sm font-medium">
                    <Home className="w-3.5 h-3.5 text-muted-foreground" />
                    {communityRaw.trim()}
                  </span>
                )}
                {llcs.map((llc, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted text-foreground text-sm font-medium"
                  >
                    🎓 {llc.trim().endsWith('(LLC)') ? llc.trim() : `${llc.trim()} (LLC)`}
                  </span>
                ))}
                {hasNotes && (
                  <span className="inline-flex px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium">
                    {housingNotes}
                  </span>
                )}
                {hasTerms && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted text-foreground text-sm font-medium">
                    <ScrollText className="w-4 h-4 text-muted-foreground shrink-0" />
                    {dorm.terms.trim()}
                  </span>
                )}
              </div>
            );
          })()}
        </section>

        {/* B. Room Rates */}
        <section className={sectionBlock}>
          <h2 className={sectionTitle}>{t('housing:portal.overview.roomRatesSection')}</h2>
          {(() => {
            const periodStr = String(dorm.rent_period ?? dorm.rentPeriod ?? '').trim().toLowerCase();
            const periodLabel = periodStr === 'month' ? 'month' : 'semester';
            const rateRows =
              isBouquetGardens && bouquetData
                ? bouquetData.units.map((unit) => ({
                    key: unit,
                    name: unit,
                    price: `$${BOUQUET_GARDENS_PRICE.toLocaleString()} / ${periodLabel}`,
                  }))
                : (dorm.variants ?? []).map((variant) => ({
                    key: variant.id,
                    name: `${variant.roomType}${variant.dimensions ? ` · ${variant.dimensions}` : ''}`,
                    price: `$${variant.rate.toLocaleString()} / ${periodLabel}`,
                  }));
            return (
              <>
                <p className={cn(bodyCopy, 'mb-4')}>
                  <span className="font-semibold text-foreground">{t('housing:portal.overview.startingAt')} </span>
                  <span className="font-bold text-foreground">${displayPrice.toLocaleString()}</span>
                  <span> / {periodLabel}</span>
                </p>
                {rateRows.length > 0 ? (
                  <ul className="divide-y divide-border rounded-xl border border-border bg-card md:grid md:max-w-2xl md:grid-cols-2 md:gap-3 md:divide-y-0 md:rounded-none md:border-0 md:bg-transparent">
                    {rateRows.map((row) => (
                      <li
                        key={row.key}
                        className="px-3 py-3.5 md:rounded-xl md:border md:border-border md:bg-card md:px-4"
                      >
                        <p className="text-sm font-medium leading-snug text-foreground">{row.name}</p>
                        <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                          {row.price}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : dorm.roomTypes && dorm.roomTypes.length > 0 ? (
                  <p className={cn(bodyCopy)}>Room types: {dorm.roomTypes.join(', ')}</p>
                ) : null}
              </>
            );
          })()}
        </section>

        {/* Map Section - full-width */}
        {hasCoords && onViewMap && (
          <div className="w-full max-w-none h-96 overflow-hidden rounded-2xl shadow-raised border border-border">
            <DormMiniMap
              latitude={latNum}
              longitude={lngNum}
              buildingName={displayName}
              onViewMap={onViewMap}
              className="w-full h-full min-h-0 rounded-2xl"
            />
          </div>
        )}

        {/* C. Amenities */}
        {(() => {
          const inroomRaw = fetchedProfile?.inroom_amenities ?? dorm.inroomAmenities ?? null;
          const buildingRaw = fetchedProfile?.building_amenities ?? dorm.buildingAmenities ?? null;
          const hasWindowCoverings = fetchedProfile?.window_coverings != null
            ? parseWindowCoverings(fetchedProfile.window_coverings)
            : false;
          const inroomItems = parseAmenityList(inroomRaw);
          if (hasWindowCoverings && !inroomItems.some((s) => /window\s*(blinds|coverings|curtains)/i.test(s))) {
            inroomItems.push(t('housing:portal.overview.windowBlinds'));
          }
          const buildingItems = parseAmenityList(buildingRaw);
          const hasAmenities = inroomItems.length > 0 || buildingItems.length > 0;
          if (!hasAmenities) return null;
          return (
            <section className={sectionBlock}>
              <h2 className={sectionTitle}>{t('housing:portal.overview.amenitiesSection')}</h2>
              <div
                className={cn(
                  isMobile ? 'flex flex-col gap-5' : 'grid grid-cols-1 gap-8 sm:grid-cols-2',
                )}
              >
                {inroomItems.length > 0 && (
                  <div className="rounded-xl border border-border bg-muted/50 px-3 py-3.5 md:px-5 md:py-4">
                    <h3 className={groupLabel}>
                      <Home className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
                      {t('housing:portal.overview.inRoom')}
                    </h3>
                    <p className={captionText}>{t('housing:portal.overview.inRoomDescription')}</p>
                    <ul className={cn(bodyCopy, isMobile ? 'space-y-2.5' : 'space-y-2')}>
                      {inroomItems.map((item, i) => (
                        <li key={i} className="flex items-start gap-2.5">
                          <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" aria-hidden />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {buildingItems.length > 0 && (
                  <div className="rounded-xl border border-border bg-muted/50 px-3 py-3.5 md:px-5 md:py-4">
                    <h3 className={groupLabel}>
                      <Building2 className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
                      {t('housing:portal.overview.building')}
                    </h3>
                    <ul className={cn(bodyCopy, isMobile ? 'space-y-2.5' : 'space-y-2')}>
                      {buildingItems.map((item, i) => (
                        <li key={i} className="flex items-start gap-2.5">
                          <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" aria-hidden />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          );
        })()}

        {/* D. Floor Plans - only render when floor plan data exists */}
        {(() => {
          const floorPlans = subBuildingFloorPlans.length > 0
            ? subBuildingFloorPlans
            : parseFloorplanUrls(dorm.floorplan);
          if (!floorPlans || floorPlans.length === 0) return null;
          return (
            <section className={sectionBlock}>
              <h2 className={sectionTitle}>{t('housing:portal.overview.floorPlansSection')}</h2>
              <FloorPlanGallery
                floorPlans={floorPlans}
                buildingName={dorm.name}
                subBuildingLetter={selectedSubBuilding?.letter}
              />
            </section>
          );
        })()}

        {/* E. Resident Essentials */}
        <section className={cn(isMobile ? 'pb-2' : 'py-6')}>
          <h2 className={sectionTitle}>{t('housing:portal.overview.essentialsSection')}</h2>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="move-in">
              <AccordionTrigger
                className={cn(
                  'text-foreground hover:no-underline',
                  isMobile ? 'min-h-[44px] py-3.5 text-sm font-medium' : 'py-4',
                )}
              >
                <span className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  {t('housing:portal.overview.moveInDates')}
                </span>
              </AccordionTrigger>
              <AccordionContent className="overflow-hidden">
                {dorm.importantDates && dorm.importantDates.trim() ? (() => {
                  const entries = parseMoveInDates(dorm.importantDates);
                  const rows = buildMoveInScheduleRows(entries);
                  if (rows.length === 0) {
                    return <p className="text-sm text-muted-foreground">{t('housing:portal.overview.contactHousingForSchedule')}</p>;
                  }
                  const userFloorNorm = normalizeFloorLabel(userFloor ?? null);

                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {rows.map((row, idx) => {
                        const isUserFloor = userFloorNorm != null && row.floorLabel === userFloorNorm;
                        return (
                          <div
                            key={`${row.floorLabel}-${row.dateShort}-${row.timeDisplay}-${idx}`}
                            className={cn(
                              'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
                              isUserFloor
                                ? 'border-foreground bg-muted'
                                : 'border-border bg-card'
                            )}
                          >
                            <span
                              className={cn(
                                'font-bold shrink-0',
                                isUserFloor ? 'font-semibold' : 'text-foreground'
                              )}
                              style={isUserFloor ? { color: '#0B702B' } : undefined}
                            >
                              {row.floorLabel}
                            </span>
                            <span className="text-muted-foreground/60 shrink-0" aria-hidden>|</span>
                            <span className={cn(
                              'text-foreground min-w-0',
                              isUserFloor && 'font-medium'
                            )} style={isUserFloor ? { color: '#0B702B' } : undefined}>
                              {row.dateShort} • {row.timeDisplay}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })() : (
                  <p className="text-sm text-muted-foreground">{t('housing:portal.overview.contactHousingForSchedule')}</p>
                )}
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="mailing">
              <AccordionTrigger
                className={cn(
                  'text-foreground hover:no-underline',
                  isMobile ? 'min-h-[44px] py-3.5 text-sm font-medium' : 'py-4',
                )}
              >
                <span className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  {mailingServices && mailingServices.trim() ? t('housing:portal.overview.mailingServices') : t('housing:portal.overview.mailingAddress')}
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm text-muted-foreground leading-relaxed space-y-0.5">
                    {mailingServices && mailingServices.trim() && <p className="font-medium text-foreground">{mailingServices.trim()}</p>}
                    {mailLines.length > 0 ? (
                      <>
                        <p className="italic">{mailNameLine}</p>
                        {mailLines.slice(1).map((line, i) => <p key={i}>{line}</p>)}
                      </>
                    ) : (
                      <>
                        <p className="italic">{mailNameLine}</p>
                        <p className="font-medium text-foreground">{displayName}</p>
                        {streetAddress && <p>{streetAddress}</p>}
                        {cityStateZip && <p>{cityStateZip}</p>}
                      </>
                    )}
                  </div>
                  <button onClick={handleCopy} className="p-1.5 rounded-full hover:bg-muted shrink-0" aria-label="Copy address">
                    {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </div>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="staff">
              <AccordionTrigger
                className={cn(
                  'text-foreground hover:no-underline',
                  isMobile ? 'min-h-[44px] py-3.5 text-sm font-medium' : 'py-4',
                )}
              >
                <span className="flex items-center gap-2">
                  <User className="w-4 h-4 text-muted-foreground" />
                  {t('housing:portal.overview.staffSection')}
                </span>
              </AccordionTrigger>
              <AccordionContent>
                {(() => {
                  const rdRaw = fetchedProfile?.resident_director ?? dorm.residentDirector ?? null;
                  if (!hasResidentDirectorData(rdRaw)) return <p className="text-sm text-muted-foreground">{t('housing:portal.overview.noRD')}</p>;
                  const directors = parseResidentDirectors(rdRaw);
                  if (directors.length === 0) return <p className="text-sm text-muted-foreground">{t('housing:portal.overview.noRD')}</p>;
                  return (
                    <div className={cn('space-y-4', directors.length > 1 && 'grid grid-cols-1 sm:grid-cols-2 gap-4')}>
                      {directors.map((rd, idx) => {
                        const hasContactData = rd.name || rd.phone || rd.email;
                        if (!hasContactData) return null;
                        return (
                          <div key={idx}>
                            {rd.name && <p className="text-sm font-semibold text-foreground">{rd.name}</p>}
                            <div className="space-y-1 text-sm text-muted-foreground mt-1">
                              {rd.phone && (() => { const p = safeTel(rd.phone); return p ? <a href={`tel:${p}`} className="block text-primary hover:underline">{rd.phone}</a> : null; })()}
                              {rd.email && (() => { const e = safeMailToEmail(rd.email); return e ? <a href={`mailto:${e}`} className="block text-primary hover:underline">{rd.email}</a> : null; })()}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {/* DRS contact block is Pitt-specific; hide for other tenants until
              their accommodations office is curated. */}
          {university.slug === 'pitt' && (
          <div className={cn('border-t border-border', isMobile ? 'mt-5 pt-5' : 'mt-6 pt-6')}>
            <h3 className={cn(groupLabel, isMobile ? 'mb-2.5' : 'mb-2')}>
              <Accessibility className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
              {t('housing:portal.overview.a11ySection')}
            </h3>
            <p className={cn(bodyCopy, 'mb-3')}>
              {t('housing:portal.overview.a11yDescription')}
            </p>
            <div className="space-y-1 text-sm text-muted-foreground mb-3">
              <span className="block">{t('housing:portal.overview.drsAddress')}</span>
              <a href="tel:412-648-7890" className="text-primary hover:underline">{t('housing:portal.overview.drsPhone')}</a>
              <a href="mailto:drsrecep@pitt.edu" className="text-primary hover:underline block">{t('housing:portal.overview.drsEmail')}</a>
            </div>
            <Button variant="outline" size="sm" className="gap-2" asChild>
              <a href="https://www.wellbeing.pitt.edu/disability-access/disability-resources-services" target="_blank" rel="noopener noreferrer">
                {t('housing:portal.overview.drsPage')} <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </Button>
          </div>
          )}
        </section>
    </div>
  );
}
