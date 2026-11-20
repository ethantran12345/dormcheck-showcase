import { WashingMachine } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { useLaundryRooms, type LaundryRoom } from '@/hooks/usePittCampusLive';
import { FreshnessNote } from './FreshnessNote';

function Availability({ label, free, total }: { label: string; free: number; total: number }) {
  const none = total > 0 && free === 0;
  return (
    <div className="flex-1 rounded-xl bg-muted/60 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-lg font-bold', none ? 'text-muted-foreground' : 'text-malachite-800')}>
        {free}
        <span className="text-sm font-medium text-muted-foreground"> of {total} free</span>
      </p>
    </div>
  );
}

function RoomRow({ room, disambiguate }: { room: LaundryRoom; disambiguate: boolean }) {
  const soonest = room.machines
    .filter((machine) => machine.status === 'in_use' && machine.minutesRemaining !== null)
    .sort((a, b) => (a.minutesRemaining ?? 0) - (b.minutesRemaining ?? 0))[0];

  return (
    <li className="rounded-xl border border-border bg-card p-3">
      <p className="text-sm font-semibold text-foreground">{room.residenceHall ?? room.upstreamName}</p>
      {!room.residenceHall ? (
        <p className="text-xs text-muted-foreground">Reported by the laundry provider as {room.upstreamName}.</p>
      ) : disambiguate ? (
        // Two provider rooms can belong to one hall (Sutherland East and West).
        // Identical headings read as a duplicate, so name the room.
        <p className="text-xs text-muted-foreground">{room.upstreamName}</p>
      ) : null}
      <div className="mt-2 flex gap-2">
        <Availability label="Washers" free={room.freeWashers} total={room.totalWashers} />
        <Availability label="Dryers" free={room.freeDryers} total={room.totalDryers} />
      </div>
      {room.freeWashers === 0 && room.freeDryers === 0 && soonest?.minutesRemaining != null && (
        <p className="mt-2 text-xs text-muted-foreground">
          Next machine free in about {soonest.minutesRemaining} min.
        </p>
      )}
    </li>
  );
}

/**
 * Live washer and dryer availability. `hallFilter` narrows to one building for
 * the My Home widget; without it every room the provider publishes is listed.
 */
export function LaundryCard({ hallFilter, className }: { hallFilter?: string | null; className?: string }) {
  const { data, isPending, isError } = useLaundryRooms();
  const rooms = hallFilter
    ? (data ?? []).filter((room) => room.residenceHall === hallFilter)
    : (data ?? []);

  return (
    <section
      aria-labelledby="laundry-heading"
      className={cn('rounded-xl border border-border bg-card p-4 shadow-raised', className)}
    >
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-malachite-600/15">
          <WashingMachine className="h-5 w-5 text-malachite-700" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 id="laundry-heading" className="text-base font-bold text-foreground">Laundry</h2>
          <FreshnessNote source="laundry" />
        </div>
      </header>

      {isPending && (
        <div className="mt-3 space-y-2" aria-hidden>
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      )}

      {isError && (
        <p className="mt-3 text-sm text-destructive">Laundry availability could not be loaded right now.</p>
      )}

      {!isPending && !isError && rooms.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          {hallFilter
            ? `The laundry provider does not publish machine status for ${hallFilter} yet.`
            : 'No laundry rooms are published for your school yet.'}
        </p>
      )}

      {rooms.length > 0 && (
        <ul className="mt-3 space-y-2">
          {rooms.map((room) => (
            <RoomRow
              key={room.id}
              room={room}
              disambiguate={
                !!room.residenceHall &&
                rooms.filter((other) => other.residenceHall === room.residenceHall).length > 1
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}
