import { supabase } from '@/integrations/supabase/client';
import { normalizeResidenceHallName } from '@/lib/housing-match';
import type { HousingHall } from '@/hooks/useSchedule';

/**
 * Single source of truth for "which residence hall": profiles.current_dorm.
 * These one-shot helpers keep user_home_location (class-schedule home) and
 * profiles in step when a hall is picked in either surface. Halls only - 
 * off-campus addresses stay schedule-only in user_home_location.
 */

/** Find a hall record by name (same normalization as the SQL RLS helper). */
export function findHallByName(
  halls: HousingHall[] | undefined,
  name: string | null | undefined,
): HousingHall | undefined {
  const target = normalizeResidenceHallName(name);
  if (!target) return undefined;
  return halls?.find((h) => normalizeResidenceHallName(h.name) === target);
}

/**
 * Mirror a hall selection made in profiles (onboarding / My Home editor)
 * into user_home_location so the schedule's walking routes work without a
 * second ask. Same row shape SetHomeDialog writes for a hall pick.
 */
export async function syncHallToHomeLocation(
  userId: string,
  hall: Pick<HousingHall, 'name' | 'lat' | 'lng'>,
): Promise<void> {
  const { error } = await supabase.from('user_home_location').upsert({
    user_id: userId,
    building_id: null,
    label: hall.name,
    lat: hall.lat,
    lng: hall.lng,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

/**
 * Mirror a hall picked in the schedule's SetHomeDialog back into profiles.
 * No-ops when current_dorm already matches (guards against redundant writes
 * and the building-chat ejection trigger). Never touches floor/room/move-in.
 */
export async function syncHomeHallToProfile(userId: string, hallName: string): Promise<void> {
  const { data: profile, error: readError } = await supabase
    .from('profiles')
    .select('current_dorm, housing_type')
    .eq('id', userId)
    .maybeSingle();
  if (readError) throw readError;
  const same =
    normalizeResidenceHallName(profile?.current_dorm) === normalizeResidenceHallName(hallName) &&
    profile?.housing_type === 'on-campus';
  if (same) return;
  const { error } = await supabase
    .from('profiles')
    .update({ current_dorm: hallName, housing_type: 'on-campus' })
    .eq('id', userId);
  if (error) throw error;
}

/**
 * Would syncing this hall to the profile actually change it?
 * Used by SetHomeDialog to decide whether to show the confirm step.
 */
export function hallDiffersFromProfile(
  profile: { current_dorm: string | null; housing_type: string | null } | null | undefined,
  hallName: string,
): boolean {
  return !(
    normalizeResidenceHallName(profile?.current_dorm) === normalizeResidenceHallName(hallName) &&
    profile?.housing_type === 'on-campus'
  );
}
