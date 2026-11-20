import { useQuery } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

/**
 * Read hooks for the campus_* tables fed by the scheduled ingests
 * (api/cron/campus-*.ts).
 *
 * No filter by university is applied here on purpose: every campus_* table
 * carries the class-A RESTRICTIVE tenant_isolation policy, so a signed-in
 * student can only ever read their own school's rows. Filtering again in the
 * client would imply the guarantee lives here, which it does not.
 *
 * The generated Database types do not yet describe these tables — they arrive
 * with migration 20261004000000 and types.ts is regenerated only after a batch
 * of migrations reaches prod. Until then the row shapes below are the contract.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see the note above
const db = supabase as unknown as SupabaseClient<any, 'public', any>;

/**
 * Row shapes as the campus_* tables return them. Declared here rather than
 * inferred because the generated Database types do not describe these tables
 * until types.ts is regenerated after migration 20261004000000 reaches prod.
 */
interface LaundryRoomRow {
  id: string;
  upstream_name: string;
  residence_hall: string | null;
  free_washers: number | null;
  total_washers: number | null;
  free_dryers: number | null;
  total_dryers: number | null;
  observed_at: string;
}

interface LaundryMachineRow {
  id: string;
  room_id: string;
  label: string | null;
  machine_type: LaundryMachine['machineType'];
  status: LaundryMachine['status'];
  minutes_remaining: number | null;
}

interface DiningLocationRow {
  id: string;
  name: string;
  is_open: boolean | null;
  has_menu: boolean | null;
}

interface DiningHoursRow {
  location_name: string;
  intervals: Array<{ start: string; end: string }> | null;
}

interface DiningMenuRow {
  location_id: string;
  period_name: string;
  item_count: number | null;
  categories: MenuCategory[] | null;
}

interface AcademicEventRow {
  id: string;
  calendar: string;
  event_date: string;
  title: string;
  content: string | null;
}

interface IngestRunRow {
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  error: string | null;
}

export type IngestSource = 'laundry' | 'dining' | 'calendar' | 'catalog';

export interface LaundryMachine {
  id: string;
  label: string | null;
  machineType: 'washer' | 'dryer' | 'combo';
  status: 'available' | 'in_use' | 'idle' | 'out_of_service' | 'offline' | 'unknown';
  minutesRemaining: number | null;
}

export interface LaundryRoom {
  id: string;
  upstreamName: string;
  residenceHall: string | null;
  freeWashers: number;
  totalWashers: number;
  freeDryers: number;
  totalDryers: number;
  observedAt: string;
  machines: LaundryMachine[];
}

export function useLaundryRooms() {
  return useQuery({
    queryKey: ['campus-laundry'],
    // Machines change on a cycle, not a page view; the ingest runs every 15 min.
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async (): Promise<LaundryRoom[]> => {
      const { data: rooms, error } = await db
        .from('campus_laundry_rooms')
        .select('id, upstream_name, residence_hall, free_washers, total_washers, free_dryers, total_dryers, observed_at')
        .order('residence_hall', { ascending: true, nullsFirst: false });
      if (error) throw error;
      const roomRows = (rooms ?? []) as unknown as LaundryRoomRow[];
      if (roomRows.length === 0) return [];

      const { data: machines, error: machineError } = await db
        .from('campus_laundry_machines')
        .select('id, room_id, label, machine_type, status, minutes_remaining')
        .in('room_id', roomRows.map((room) => room.id));
      if (machineError) throw machineError;

      const byRoom = new Map<string, LaundryMachine[]>();
      for (const raw of (machines ?? []) as unknown as LaundryMachineRow[]) {
        const list = byRoom.get(raw.room_id) ?? [];
        list.push({
          id: raw.id,
          label: raw.label ?? null,
          machineType: raw.machine_type,
          status: raw.status,
          minutesRemaining: raw.minutes_remaining ?? null,
        });
        byRoom.set(raw.room_id, list);
      }

      return roomRows.map((room) => ({
        id: room.id,
        upstreamName: room.upstream_name,
        residenceHall: room.residence_hall ?? null,
        freeWashers: room.free_washers ?? 0,
        totalWashers: room.total_washers ?? 0,
        freeDryers: room.free_dryers ?? 0,
        totalDryers: room.total_dryers ?? 0,
        observedAt: room.observed_at,
        machines: (byRoom.get(room.id) ?? []).sort((a, b) => (a.label ?? '').localeCompare(b.label ?? '')),
      }));
    },
  });
}

/** A menu category as stored in campus_dining_menus.categories. */
export interface MenuCategory {
  name: string;
  items: Array<Record<string, unknown>>;
}

export interface DiningLocationToday {
  id: string;
  name: string;
  isOpen: boolean | null;
  hasMenu: boolean;
  intervals: Array<{ start: string; end: string }>;
  periods: Array<{ periodName: string; itemCount: number; categories: MenuCategory[] }>;
}

function localIsoDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function useDiningToday() {
  const serviceDate = localIsoDate();
  return useQuery({
    queryKey: ['campus-dining', serviceDate],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<DiningLocationToday[]> => {
      const [locationsResult, hoursResult, menusResult] = await Promise.all([
        db.from('campus_dining_locations').select('id, name, is_open, has_menu').order('name'),
        db.from('campus_dining_hours').select('location_name, intervals').eq('service_date', serviceDate),
        db.from('campus_dining_menus').select('location_id, period_name, item_count, categories').eq('service_date', serviceDate),
      ]);
      if (locationsResult.error) throw locationsResult.error;

      const hoursByName = new Map<string, Array<{ start: string; end: string }>>();
      for (const raw of (hoursResult.data ?? []) as unknown as DiningHoursRow[]) {
        hoursByName.set(raw.location_name, raw.intervals ?? []);
      }
      const menusByLocation = new Map<string, DiningLocationToday['periods']>();
      for (const raw of (menusResult.data ?? []) as unknown as DiningMenuRow[]) {
        const list = menusByLocation.get(raw.location_id) ?? [];
        list.push({ periodName: raw.period_name, itemCount: raw.item_count ?? 0, categories: raw.categories ?? [] });
        menusByLocation.set(raw.location_id, list);
      }

      return ((locationsResult.data ?? []) as unknown as DiningLocationRow[]).map((location) => ({
        id: location.id,
        name: location.name,
        isOpen: location.is_open ?? null,
        hasMenu: Boolean(location.has_menu),
        intervals: hoursByName.get(location.name) ?? [],
        periods: menusByLocation.get(location.id) ?? [],
      }));
    },
  });
}

export interface AcademicEvent {
  id: string;
  calendar: string;
  eventDate: string;
  title: string;
  content: string | null;
}

/** Upcoming registrar dates, nearest first. */
export function useUpcomingAcademicDates(limit = 8) {
  const today = localIsoDate();
  return useQuery({
    queryKey: ['campus-academic-dates', today, limit],
    staleTime: 60 * 60_000,
    queryFn: async (): Promise<AcademicEvent[]> => {
      const { data, error } = await db
        .from('campus_academic_events')
        .select('id, calendar, event_date, title, content')
        .gte('event_date', today)
        .order('event_date', { ascending: true })
        .limit(limit);
      if (error) throw error;
      return ((data ?? []) as unknown as AcademicEventRow[]).map((raw) => ({
        id: raw.id,
        calendar: raw.calendar,
        eventDate: raw.event_date,
        title: raw.title,
        content: raw.content ?? null,
      }));
    },
  });
}

export interface IngestFreshness {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
}

/**
 * When each feed last succeeded. The UI shows this rather than assuming the
 * data on screen is current: a stalled ingest and a quiet campus look identical
 * otherwise.
 */
export function useIngestFreshness(source: IngestSource) {
  return useQuery({
    queryKey: ['campus-ingest-freshness', source],
    staleTime: 60_000,
    queryFn: async (): Promise<IngestFreshness> => {
      const { data, error } = await db
        .from('campus_ingest_runs')
        .select('started_at, finished_at, ok, error')
        .eq('source', source)
        .order('started_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      const runs = (data ?? []) as unknown as IngestRunRow[];
      const success = runs.find((run) => run.ok === true);
      return {
        lastSuccessAt: success?.finished_at ?? success?.started_at ?? null,
        lastAttemptAt: runs[0]?.started_at ?? null,
        lastError: runs[0]?.ok === false ? (runs[0]?.error ?? 'unknown error') : null,
      };
    },
  });
}
