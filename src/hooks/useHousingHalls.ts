import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface HousingHall {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  housingType: string;
  isApartment: boolean;
}

/** Distinct residence halls and leased apartments used by housing setup flows. */
export function useHousingHalls() {
  return useQuery({
    queryKey: ['housing-halls'],
    staleTime: 1000 * 60 * 60,
    queryFn: async (): Promise<HousingHall[]> => {
      const { data, error } = await supabase
        .from('master_housing')
        .select('residence_hall, address, latitude, longitude, housing_type');
      if (error) throw error;

      const byName = new Map<string, HousingHall>();
      for (const row of data ?? []) {
        const name = (row.residence_hall ?? '').trim();
        const lat = typeof row.latitude === 'number' ? row.latitude : parseFloat(String(row.latitude));
        const lng = typeof row.longitude === 'number' ? row.longitude : parseFloat(String(row.longitude));
        if (!name || byName.has(name) || Number.isNaN(lat) || Number.isNaN(lng)) continue;
        const housingType = row.housing_type ?? '';
        byName.set(name, {
          name,
          address: row.address,
          lat,
          lng,
          housingType,
          isApartment: housingType.toLowerCase().includes('apartment'),
        });
      }
      return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}
