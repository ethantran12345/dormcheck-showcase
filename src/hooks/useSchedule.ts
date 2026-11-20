import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';
import { useAuth } from '@/hooks/useAuth';
import { rankSection } from '@/lib/schedule/searchRank';

export { rankSection };

export type Building = Tables<'buildings'>;
export type CourseSection = Tables<'course_sections'>;
export type UserClass = Tables<'user_classes'>;
export type HomeLocation = Tables<'user_home_location'>;

/** Current term ingested by scripts/seed-course-sections.mjs. */
export const CURRENT_TERM = '2271';

export function useBuildings() {
  return useQuery({
    queryKey: ['buildings'],
    staleTime: 1000 * 60 * 60, // static reference data
    queryFn: async (): Promise<Building[]> => {
      const { data, error } = await supabase
        .from('buildings')
        .select('*')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * The abbrs of buildings that actually host located classes this term - a
 * cross-reference against the catalog so the building picker can surface real
 * academic buildings ahead of the ~269-row campus registry, most of which are
 * administrative addresses (e.g. "120 McKee Place") that never hold a class.
 * Empty set (unseeded catalog) is treated as "unknown" by callers, who then
 * fall back to showing every building.
 */
export function useClassBuildingAbbrs(term: string = CURRENT_TERM) {
  return useQuery({
    queryKey: ['class-building-abbrs', term],
    staleTime: 1000 * 60 * 60, // static per term
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from('course_sections')
        .select('building_abbr')
        .eq('term', term)
        .not('building_abbr', 'is', null);
      if (error) throw error;
      return new Set(
        (data ?? []).map((r) => r.building_abbr).filter((a): a is string => !!a),
      );
    },
  });
}

/** Search the term catalog by subject / catalog number / title, code matches first. */
export function useCourseSectionSearch(query: string, term: string = CURRENT_TERM) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ['course-sections', term, trimmed.toLowerCase()],
    enabled: trimmed.length >= 2,
    staleTime: 1000 * 60 * 10,
    queryFn: async (): Promise<CourseSection[]> => {
      // 'CHEM 0110' style input: match subject prefix + catalog prefix together.
      const parts = trimmed.split(/\s+/);
      let q = supabase.from('course_sections').select('*').eq('term', term);
      if (parts.length >= 2 && /^[A-Za-z]+$/.test(parts[0])) {
        q = q
          .ilike('subject', `${parts[0]}%`)
          .ilike('catalog_number', `${parts[1]}%`);
      } else {
        q = q.or(
          `subject.ilike.${trimmed}%,catalog_number.ilike.${trimmed}%,title.ilike.%${trimmed}%`,
        );
      }
      const { data, error } = await q
        .order('subject')
        .order('catalog_number')
        .order('section')
        .limit(200);
      if (error) throw error;
      // Rank client-side so "Chem" puts CHEM courses above title matches
      // like "Chemical Engineering" (stable sort preserves catalog order).
      return (data ?? [])
        .map((s, i) => ({ s, i, rank: rankSection(s, trimmed) }))
        .sort((a, b) => a.rank - b.rank || a.i - b.i)
        .slice(0, 50)
        .map(({ s }) => s);
    },
  });
}

/**
 * Housing halls moved to their own hook when Schedule was retired, and stayed
 * there: onboarding and the My Home housing editor need the lookup without
 * pulling in the whole schedule data layer. Re-exported here so schedule
 * callers keep one import.
 */
export { useHousingHalls, type HousingHall } from '@/hooks/useHousingHalls';

export function useUserClasses() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['user-classes', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<UserClass[]> => {
      const { data, error } = await supabase
        .from('user_classes')
        .select('*')
        .order('start_time');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useHomeLocation() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['home-location', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<HomeLocation | null> => {
      const { data, error } = await supabase
        .from('user_home_location')
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useAddUserClass() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: Omit<TablesInsert<'user_classes'>, 'user_id'>) => {
      if (!user) throw new Error('Not signed in');
      const { error } = await supabase
        .from('user_classes')
        .insert({ ...row, user_id: user.id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-classes'] }),
  });
}

/**
 * Effective room/building for a class: the student's override (for sections
 * whose room 25Live hides) wins over what the catalog copied in.
 */
export function effectiveLocation(
  cls: Pick<UserClass, 'room' | 'building_id' | 'override_room' | 'override_building_id'>,
): { room: string | null; buildingId: string | null } {
  // Guard against "(private)" placeholder rooms from older seeds.
  const baseRoom = cls.room && !/^\(private\)$/i.test(cls.room.trim()) ? cls.room : null;
  return {
    room: cls.override_room ?? baseRoom,
    buildingId: cls.override_building_id ?? cls.building_id,
  };
}

export function useUpdateUserClass() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: { id: string } & Partial<Pick<UserClass, 'override_room' | 'override_building_id' | 'color'>>) => {
      const { error } = await supabase.from('user_classes').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-classes'] }),
  });
}

export function useDeleteUserClass() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('user_classes').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-classes'] }),
  });
}

export function useSetHomeLocation() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: Omit<TablesInsert<'user_home_location'>, 'user_id'>) => {
      if (!user) throw new Error('Not signed in');
      const { error } = await supabase
        .from('user_home_location')
        .upsert({ ...row, user_id: user.id, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['home-location'] }),
  });
}

export interface WalkingRoute {
  distanceMeters: number;
  durationSeconds: number;
  geometry: GeoJSON.LineString;
}

/**
 * Mapbox Directions walking route between two points. Results are cached by
 * coordinate pair for the session; route data is not persisted (Mapbox ToS).
 */
export function useWalkingRoute(
  from: { lat: number; lng: number } | null,
  to: { lat: number; lng: number } | null,
) {
  const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
  const enabled = !!from && !!to && !!token;
  return useQuery({
    queryKey: [
      'walking-route',
      from?.lat, from?.lng, to?.lat, to?.lng,
    ],
    enabled,
    staleTime: 1000 * 60 * 30,
    queryFn: async (): Promise<WalkingRoute> => {
      const coords = `${from!.lng},${from!.lat};${to!.lng},${to!.lat}`;
      const url =
        `https://api.mapbox.com/directions/v5/mapbox/walking/${coords}` +
        `?geometries=geojson&overview=simplified&access_token=${token}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Directions request failed (${res.status})`);
      const json = await res.json();
      const route = json.routes?.[0];
      if (!route) throw new Error('No walking route found');
      return {
        distanceMeters: route.distance,
        durationSeconds: route.duration,
        geometry: route.geometry,
      };
    },
  });
}

export interface WalkingPath {
  distanceMeters: number;
  durationSeconds: number;
  geometry: GeoJSON.LineString;
}

/**
 * Mapbox Directions walking route threading through an ordered list of points
 * (home -> class 1 -> class 2 -> ...) as one connected line, so the student sees
 * where the whole day takes them at a glance. Cached by the coordinate sequence
 * for the session; route data is not persisted (Mapbox ToS). Mapbox caps a single
 * Directions request at 25 waypoints.
 */
export function useWalkingPath(
  points: { lat: number; lng: number }[] | null,
) {
  const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
  const enabled = !!points && points.length >= 2 && points.length <= 25 && !!token;
  return useQuery({
    queryKey: ['walking-path', points?.map((p) => `${p.lat},${p.lng}`).join(';')],
    enabled,
    staleTime: 1000 * 60 * 30,
    queryFn: async (): Promise<WalkingPath> => {
      const coords = points!.map((p) => `${p.lng},${p.lat}`).join(';');
      const url =
        `https://api.mapbox.com/directions/v5/mapbox/walking/${coords}` +
        `?geometries=geojson&overview=simplified&access_token=${token}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Directions request failed (${res.status})`);
      const json = await res.json();
      const route = json.routes?.[0];
      if (!route) throw new Error('No walking path found');
      return {
        distanceMeters: route.distance,
        durationSeconds: route.duration,
        geometry: route.geometry,
      };
    },
  });
}
