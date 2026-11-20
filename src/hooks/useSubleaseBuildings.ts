import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchGroupUniversityIds } from '@/lib/marketplaceGroup';

/**
 * The sublease building registry — the rows a lister may pick from.
 *
 * Sourced from `public.buildings`, which is a different table from the dorm
 * catalogue `useDorms` reads (`master_housing`). That separation is the product
 * decision, not an accident of schema: Pitt housing contracts prohibit subletting
 * a dorm room, so residence halls are deliberately absent from this list and the
 * picker has no way to offer one.
 *
 * `is_subleasable` is the filter rather than `kind`, so opting a building in is one
 * flag flip and never a re-classification. The 269 Pitt-owned academic buildings
 * already in the table default to false and stay out.
 *
 * SCOPED TO THE MARKETPLACE GROUP, NOT TO ONE SCHOOL (2026-08-17). A building is a
 * physical object: Skyvue is a mile from CMU, Carlow is across the street from Pitt,
 * and the 40-row Oakland registry is "the buildings in Oakland" rather than "Pitt's
 * buildings" — the `university_id` on those rows records who seeded them, not who may
 * live there. Scoping this query to one school is what made a CMU student unable to
 * attach the building they actually live in. Migration 20261002000000 widened
 * `buildings.tenant_isolation` to match, and that RESTRICTIVE policy — not this
 * query — is the real boundary; the filter here only mirrors it so the picker does
 * not silently render a shorter list than the database would allow.
 */
export type SubleaseBuilding = {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
};

async function fetchSubleaseBuildings(universityId: string): Promise<SubleaseBuilding[]> {
  const universityIds = await fetchGroupUniversityIds(universityId);

  const { data, error } = await supabase
    .from('buildings')
    .select('id, name, address, lat, lng')
    .in('university_id', universityIds)
    .eq('is_subleasable', true)
    .order('name');

  if (error) throw error;
  return (data ?? []) as SubleaseBuilding[];
}

/**
 * @param universityId the LISTING's university, not necessarily the viewer's.
 *   Same reasoning as `MeetupLocationMap`: everything spatial on a listing resolves
 *   against the school the listing belongs to. At create time those coincide, but
 *   passing the listing's id is what keeps that true when they stop coinciding — and
 *   it is why the group is resolved from THIS id rather than from the session's
 *   `current_marketplace_group()`.
 */
export function useSubleaseBuildings(universityId: string | undefined) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['sublease-buildings', universityId],
    queryFn: () => fetchSubleaseBuildings(universityId as string),
    enabled: Boolean(universityId),
    // The registry is a curated list that changes when someone runs a seed, not
    // when a student does anything. Refetching it per composer open is waste.
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return {
    buildings: data ?? [],
    isLoading,
    error: error == null ? null : error instanceof Error ? error : new Error(String(error)),
  };
}
