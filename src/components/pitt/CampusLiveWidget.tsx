import { Link } from 'react-router';
import { ChevronRight, Radio } from 'lucide-react';
import { useLaundryRooms } from '@/hooks/usePittCampusLive';
import { FreshnessNote } from './FreshnessNote';

/**
 * My Home tile for Campus Live. Answers the single most-asked question the feed
 * can answer (is a washer free in my building) and links to the full page.
 *
 * When the student's hall has no published laundry room, the tile says so rather
 * than showing zeros, which would read as "everything is busy".
 */
export function CampusLiveWidget({ residenceHall }: { residenceHall?: string | null }) {
  const { data, isPending } = useLaundryRooms();
  const rooms = data ?? [];
  const mine = residenceHall ? rooms.filter((room) => room.residenceHall === residenceHall) : [];
  const scope = mine.length > 0 ? mine : rooms;
  const freeWashers = scope.reduce((total, room) => total + room.freeWashers, 0);
  const freeDryers = scope.reduce((total, room) => total + room.freeDryers, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2">
        <Radio className="h-4 w-4 text-malachite-700" aria-hidden />
        <h3 className="text-sm font-bold text-foreground">Campus Live</h3>
      </div>

      {isPending ? (
        <p className="mt-2 text-sm text-muted-foreground">Checking laundry…</p>
      ) : scope.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No live laundry data is published for your school yet.
        </p>
      ) : (
        <>
          <p className="mt-2 text-2xl font-bold text-malachite-800">
            {freeWashers}
            <span className="text-sm font-medium text-muted-foreground"> washers free</span>
          </p>
          <p className="text-sm text-muted-foreground">{freeDryers} dryers free</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {mine.length > 0 ? residenceHall : 'Across all buildings'}
          </p>
          <FreshnessNote source="laundry" className="mt-1" />
        </>
      )}

      <Link
        to="/campus-live"
        className="mt-auto flex items-center gap-1 pt-3 text-xs font-semibold text-malachite-800 hover:underline dark:text-malachite-300"
      >
        Laundry, dining and key dates
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </div>
  );
}
