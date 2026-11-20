import { describe, expect, it } from 'vitest';
import {
  currentTermCode,
  dedupeMachines,
  locationsFromHours,
  matchResidenceHall,
  normalizeRoomName,
  parseCxTime,
  parseLaundryObject,
  parseMenu,
  splitMeetingDays,
} from './pittSources.js';
import { toDisplayTitle } from '../cron/campus-catalog.js';
import { dedupeByKey } from './pittIngest.js';

describe('normalizeRoomName', () => {
  // The eight rooms LaundryView actually publishes for Pitt, verbatim.
  it.each([
    ['BRACKENRIDGE HALL 13TH FLR', 'Brackenridge Hall'],
    ['FORBES CRAIG APTS', 'Forbes Craig Apartments'],
    ['HOLLAND HALL 11TH FL.', 'Holland Hall'],
    ['LITCHFIELD TOWERS', 'Litchfield Towers'],
    ['LOTHROP HALL', 'Lothrop Hall'],
    ['MCCORMICK HALL 11TH FL.', 'McCormick Hall'],
    ['SUTHERLAND EAST', 'Sutherland East'],
    ['SUTHERLAND WEST', 'Sutherland West'],
  ])('normalizes %s', (raw, expected) => {
    expect(normalizeRoomName(raw)).toBe(expected);
  });
});

describe('matchResidenceHall', () => {
  const halls = ['Litchfield Towers', 'Sutherland East', 'Sutherland West', 'Holland Hall', 'Nordenberg Hall'];

  it('matches exactly, case-insensitively', () => {
    expect(matchResidenceHall('Holland Hall', halls)).toBe('Holland Hall');
  });

  it('returns null for a hall we do not model rather than guessing', () => {
    expect(matchResidenceHall('Panther Hall', halls)).toBeNull();
  });

  it('refuses a prefix match that would attribute a whole complex to one building', () => {
    // The provider publishes one room for "LITCHFIELD TOWERS"; housing models
    // "Litchfield Towers A". A prefix rule silently credits three towers' machines
    // to Tower A, so this must not match.
    expect(matchResidenceHall('Litchfield Towers', ['Litchfield Towers A'])).toBeNull();
    expect(matchResidenceHall('Sutherland East', ['Sutherland Hall'])).toBeNull();
  });

  it('accepts a curated alias where the two systems genuinely spell a hall differently', () => {
    expect(
      matchResidenceHall('Litchfield Towers', ['Litchfield Towers A'], { 'litchfield towers': 'Litchfield Towers A' }),
    ).toBe('Litchfield Towers A');
  });
});

describe('parseLaundryObject', () => {
  it('reads a single washer', () => {
    const [machine] = parseLaundryObject({
      type: 'washFL',
      appliance_desc: '01',
      appliance_desc_key: '47634',
      status_toggle: 0,
    });
    expect(machine).toMatchObject({ machineType: 'washer', status: 'available', externalId: '47634' });
  });

  it('reports remaining minutes only while running', () => {
    const [machine] = parseLaundryObject({
      type: 'dry',
      appliance_desc: '05',
      appliance_desc_key: '900',
      status_toggle: 2,
      time_remaining: 27,
      percentage: 55,
    });
    expect(machine).toMatchObject({ machineType: 'dryer', status: 'in_use', minutesRemaining: 27, cycleProgressPercent: 55 });
  });

  it('expands a stacked pair into two machines', () => {
    const machines = parseLaundryObject({
      type: 'dblDry',
      stacked: true,
      appliance_desc: '07',
      appliance_desc_key: 'a',
      status_toggle: 0,
      appliance_desc2: '08',
      appliance_desc_key2: 'b',
      status_toggle2: 4,
      type2: 'dry',
    });
    expect(machines).toHaveLength(2);
    expect(machines.every((m) => m.isStacked)).toBe(true);
    expect(machines[1].status).toBe('offline');
  });

  it('degrades an unrecognised status code instead of losing the machine', () => {
    // PittAPI raises here, which costs the caller the entire room.
    const [machine] = parseLaundryObject({
      type: 'washFL',
      appliance_desc: '02',
      appliance_desc_key: 'x',
      status_toggle: 99,
    });
    expect(machine.status).toBe('unknown');
  });
});

describe('dedupeMachines', () => {
  it('collapses a machine LaundryView lists both standalone and inside a manual stack', () => {
    // Holland Hall dryer "B 2" (47714) is published twice; seven of its machines
    // are, which is why a naive read reports 35 machines where 28 exist.
    const merged = dedupeMachines([
      { externalId: '47714', label: 'B 2', machineType: 'dryer', status: 'unknown', statusMessage: null, minutesRemaining: null, cycleProgressPercent: null, isStacked: false },
      { externalId: '47714', label: 'B 2', machineType: 'dryer', status: 'offline', statusMessage: 'Offline', minutesRemaining: null, cycleProgressPercent: null, isStacked: true },
      { externalId: '47713', label: 'B 1', machineType: 'dryer', status: 'available', statusMessage: null, minutesRemaining: null, cycleProgressPercent: null, isStacked: true },
    ]);
    expect(merged).toHaveLength(2);
    const b2 = merged.find((m) => m.externalId === '47714');
    expect(b2).toMatchObject({ status: 'offline', isStacked: true });
  });

  it('drops entries with no id rather than colliding them on an empty key', () => {
    const merged = dedupeMachines([
      { externalId: '', label: '', machineType: 'washer', status: 'available', statusMessage: null, minutesRemaining: null, cycleProgressPercent: null, isStacked: false },
      { externalId: '', label: '', machineType: 'dryer', status: 'available', statusMessage: null, minutesRemaining: null, cycleProgressPercent: null, isStacked: false },
    ]);
    expect(merged).toHaveLength(0);
  });
});

describe('parseMenu', () => {
  it('keeps retail items whose nutrients omit the unit key', () => {
    // Regression for the upstream defect: PittAPI reads nutrient["uom"]
    // unguarded, so one missing unit discards the whole retail menu.
    const menu = parseMenu({
      id: 1,
      date: '2026-08-27',
      periods: {
        id: 1,
        name: 'Every Day',
        categories: [
          {
            id: 'c1',
            name: 'Wraps',
            items: [
              {
                id: 'i1',
                name: 'Cool Wrap',
                calories: '660',
                nutrients: [{ name: 'Calories', value: '660' }],
                filters: [{ name: 'Contains Gluten' }],
              },
            ],
          },
        ],
      },
    });
    expect(menu?.itemCount).toBe(1);
    expect(menu?.categories[0].items[0]).toMatchObject({ name: 'Cool Wrap', filters: ['Contains Gluten'] });
    expect((menu?.categories[0].items[0] as { nutrients: unknown[] }).nutrients).toEqual([
      { name: 'Calories', value: '660', unit: null },
    ]);
  });

  it('returns null when there is no period payload', () => {
    expect(parseMenu(undefined)).toBeNull();
    expect(parseMenu({})).toBeNull();
  });
});

describe('locationsFromHours', () => {
  it('dedupes a week of rows into one location each', () => {
    const locations = locationsFromHours([
      { locationId: 'a', locationName: 'The Eatery', date: '2026-08-27', intervals: [] },
      { locationId: 'a', locationName: 'The Eatery', date: '2026-08-28', intervals: [] },
      { locationId: 'b', locationName: 'Forbes Street Market', date: '2026-08-27', intervals: [] },
    ]);
    expect(locations.map((l) => l.externalId)).toEqual(['a', 'b']);
  });
});

describe('dedupeByKey', () => {
  it('collapses rows sharing a composite conflict key, keeping the last', () => {
    // Pitt's grades calendar publishes two entries with the same date and title;
    // Postgres refuses an upsert that touches one row twice.
    const rows = dedupeByKey(
      [
        { university_id: 'u', calendar: 'grades', event_date: '2026-08-30', title: 'Rosters', content: 'first' },
        { university_id: 'u', calendar: 'grades', event_date: '2026-08-30', title: 'Rosters', content: 'second' },
        { university_id: 'u', calendar: 'grades', event_date: '2026-08-31', title: 'Rosters', content: 'other day' },
      ],
      'university_id,calendar,event_date,title',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].content).toBe('second');
  });

  it('treats a null key component as its own value rather than a collision', () => {
    const rows = dedupeByKey([{ a: null, b: 1 }, { a: 'x', b: 2 }], 'a');
    expect(rows).toHaveLength(2);
  });
});

describe('catalog parsing', () => {
  it('splits meeting days and ignores TBA', () => {
    expect(splitMeetingDays('MoWeFr')).toEqual(['Mo', 'We', 'Fr']);
    expect(splitMeetingDays('TuTh')).toEqual(['Tu', 'Th']);
    expect(splitMeetingDays('TBA')).toEqual([]);
    expect(splitMeetingDays(null)).toEqual([]);
  });

  it('converts PeopleSoft times', () => {
    expect(parseCxTime('16.30.00.000000')).toBe('16:30:00');
    expect(parseCxTime('09.05.00.000000')).toBe('09:05:00');
    expect(parseCxTime('')).toBeNull();
  });

  it('derives the Pitt term code from the academic calendar', () => {
    expect(currentTermCode(new Date(2026, 7, 27))).toBe('2271'); // August -> Fall 2026
    expect(currentTermCode(new Date(2027, 1, 3))).toBe('2274'); // February -> Spring 2027
    expect(currentTermCode(new Date(2027, 5, 3))).toBe('2277'); // June -> Summer 2027
  });

  it('title-cases catalog titles without capitalising minor words', () => {
    expect(toDisplayTitle('INTRODUCTION TO COMPUTER PROGRAMMING')).toBe('Introduction to Computer Programming');
    expect(toDisplayTitle('THE ART OF WAR')).toBe('The Art of War');
    expect(toDisplayTitle(null)).toBeNull();
  });
});
