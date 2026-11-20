export interface BuildingResidentRow {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  current_floor: string | null;
  move_in_date: string | null;
  is_self: boolean;
}

export interface GroupedBuildingResidents {
  roommates: BuildingResidentRow[];
  sameFloor: BuildingResidentRow[];
  rest: BuildingResidentRow[];
}

function normalizeFloor(floor: string | null | undefined): string {
  return (floor ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Group building residents for the People & Move-in tab: the viewer's confirmed
 * roommates pinned first, then same-floor residents, then the rest of the
 * building. The viewer's own row is excluded from every section.
 */
export interface MoveInDayGroup {
  /** ISO YYYY-MM-DD; null = the trailing "Date TBD" bucket. */
  dateIso: string | null;
  residents: BuildingResidentRow[];
}

/**
 * Group building residents by arrival day for the People & Move-in tab, so
 * students can see (and dodge) the elevator/parking crunch. Ascending by date,
 * residents without a date collected in a trailing "Date TBD" bucket. The
 * viewer's own row is excluded; within a bucket the input order (the RPC's
 * floor-then-name sort) is preserved.
 */
export function groupResidentsByMoveInDay(rows: BuildingResidentRow[]): MoveInDayGroup[] {
  const byDate = new Map<string, BuildingResidentRow[]>();
  const undated: BuildingResidentRow[] = [];
  for (const row of rows) {
    if (row.is_self) continue;
    if (!row.move_in_date) {
      undated.push(row);
      continue;
    }
    const bucket = byDate.get(row.move_in_date);
    if (bucket) bucket.push(row);
    else byDate.set(row.move_in_date, [row]);
  }
  const groups: MoveInDayGroup[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateIso, residents]) => ({ dateIso, residents }));
  if (undated.length > 0) groups.push({ dateIso: null, residents: undated });
  return groups;
}

export function groupBuildingResidents(
  rows: BuildingResidentRow[],
  opts: { viewerFloor: string | null | undefined; roommateIds: ReadonlySet<string> },
): GroupedBuildingResidents {
  const viewerFloor = normalizeFloor(opts.viewerFloor);
  const roommates: BuildingResidentRow[] = [];
  const sameFloor: BuildingResidentRow[] = [];
  const rest: BuildingResidentRow[] = [];
  for (const row of rows) {
    if (row.is_self) continue;
    if (opts.roommateIds.has(row.id)) {
      roommates.push(row);
    } else if (viewerFloor && normalizeFloor(row.current_floor) === viewerFloor) {
      sameFloor.push(row);
    } else {
      rest.push(row);
    }
  }
  return { roommates, sameFloor, rest };
}
