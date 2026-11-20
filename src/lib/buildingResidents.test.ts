import { describe, it, expect } from 'vitest';
import {
  groupBuildingResidents,
  groupResidentsByMoveInDay,
  type BuildingResidentRow,
} from '@/lib/buildingResidents';

function row(partial: Partial<BuildingResidentRow> & { id: string }): BuildingResidentRow {
  return {
    full_name: null,
    avatar_url: null,
    current_floor: null,
    move_in_date: null,
    is_self: false,
    ...partial,
  };
}

describe('groupBuildingResidents', () => {
  it('pins roommates, splits same floor from rest, excludes self', () => {
    const rows = [
      row({ id: 'me', is_self: true, current_floor: '3' }),
      row({ id: 'roomie', current_floor: '3' }),
      row({ id: 'floormate', current_floor: '3' }),
      row({ id: 'neighbor', current_floor: '7' }),
    ];
    const grouped = groupBuildingResidents(rows, {
      viewerFloor: '3',
      roommateIds: new Set(['roomie']),
    });
    expect(grouped.roommates.map((r) => r.id)).toEqual(['roomie']);
    expect(grouped.sameFloor.map((r) => r.id)).toEqual(['floormate']);
    expect(grouped.rest.map((r) => r.id)).toEqual(['neighbor']);
  });

  it('normalizes floor strings when matching', () => {
    const rows = [row({ id: 'a', current_floor: ' 3 ' }), row({ id: 'b', current_floor: '3a' })];
    const grouped = groupBuildingResidents(rows, { viewerFloor: '3', roommateIds: new Set() });
    expect(grouped.sameFloor.map((r) => r.id)).toEqual(['a']);
    expect(grouped.rest.map((r) => r.id)).toEqual(['b']);
  });

  it('puts everyone in rest when the viewer has no floor', () => {
    const rows = [row({ id: 'a', current_floor: '2' })];
    const grouped = groupBuildingResidents(rows, { viewerFloor: null, roommateIds: new Set() });
    expect(grouped.sameFloor).toEqual([]);
    expect(grouped.rest.map((r) => r.id)).toEqual(['a']);
  });

  it('handles empty input', () => {
    const grouped = groupBuildingResidents([], { viewerFloor: '1', roommateIds: new Set() });
    expect(grouped).toEqual({ roommates: [], sameFloor: [], rest: [] });
  });
});

describe('groupResidentsByMoveInDay', () => {
  it('buckets by day ascending with undated last', () => {
    const rows = [
      row({ id: 'late', move_in_date: '2026-08-23' }),
      row({ id: 'tbd' }),
      row({ id: 'early-1', move_in_date: '2026-08-21' }),
      row({ id: 'early-2', move_in_date: '2026-08-21' }),
    ];
    const groups = groupResidentsByMoveInDay(rows);
    expect(groups.map((g) => g.dateIso)).toEqual(['2026-08-21', '2026-08-23', null]);
    expect(groups[0].residents.map((r) => r.id)).toEqual(['early-1', 'early-2']);
    expect(groups[2].residents.map((r) => r.id)).toEqual(['tbd']);
  });

  it('excludes the viewer', () => {
    const rows = [
      row({ id: 'me', is_self: true, move_in_date: '2026-08-21' }),
      row({ id: 'other', move_in_date: '2026-08-21' }),
    ];
    const groups = groupResidentsByMoveInDay(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].residents.map((r) => r.id)).toEqual(['other']);
  });

  it('omits the TBD bucket when everyone has a date', () => {
    const groups = groupResidentsByMoveInDay([row({ id: 'a', move_in_date: '2026-08-20' })]);
    expect(groups.map((g) => g.dateIso)).toEqual(['2026-08-20']);
  });

  it('returns all-null dates as a single TBD bucket', () => {
    const groups = groupResidentsByMoveInDay([row({ id: 'a' }), row({ id: 'b' })]);
    expect(groups).toEqual([{ dateIso: null, residents: [row({ id: 'a' }), row({ id: 'b' })] }]);
  });

  it('handles empty input', () => {
    expect(groupResidentsByMoveInDay([])).toEqual([]);
  });
});
