import { describe, expect, it } from 'vitest';
import {
  estWalkMinutes,
  haversineMeters,
  nearestBusStops,
  nearestPogohStations,
} from '@/lib/transitNearby';
import type { BusStop, PogohStation } from '@/lib/transitMap';

// Litchfield Towers → Cathedral of Learning is ~350m straight-line.
const TOWERS = { lat: 40.4425, lng: -79.9571 };
const CATHEDRAL = { lat: 40.4434, lng: -79.9532 };

function stop(overrides: Partial<BusStop>): BusStop {
  return {
    objectID: 1,
    stop_id: 's1',
    stop_code: 'c1',
    stop_name: 'Fifth Ave at Bigelow',
    stop_lat: CATHEDRAL.lat,
    stop_lon: CATHEDRAL.lng,
    ...overrides,
  };
}

describe('haversineMeters / estWalkMinutes', () => {
  it('measures the Towers→Cathedral hop in the expected range', () => {
    const d = haversineMeters(TOWERS, CATHEDRAL);
    expect(d).toBeGreaterThan(280);
    expect(d).toBeLessThan(420);
  });

  it('zero distance is zero meters but at least a 1 minute walk', () => {
    expect(haversineMeters(TOWERS, TOWERS)).toBe(0);
    expect(estWalkMinutes(0)).toBe(1);
  });

  it('pads straight-line distance for street routing (~5-6 min for 350m)', () => {
    const min = estWalkMinutes(350);
    expect(min).toBeGreaterThanOrEqual(5);
    expect(min).toBeLessThanOrEqual(7);
  });
});

describe('nearestBusStops', () => {
  it('groups directional twins by name, unions routes, keeps the nearest coords', () => {
    const stops: BusStop[] = [
      stop({ objectID: 1, routes: '71B, 71D', stop_lat: 40.4434 }),
      stop({ objectID: 2, routes: '61A,61B', stop_lat: 40.4436 }),
      stop({ objectID: 3, stop_name: 'Forbes Ave at Atwood', routes: '61C', stop_lat: 40.4409, stop_lon: -79.9576 }),
    ];
    const result = nearestBusStops(stops, TOWERS, { limit: 3 });
    expect(result).toHaveLength(2);
    const fifth = result.find((s) => s.name === 'Fifth Ave at Bigelow');
    expect(fifth?.routes).toEqual(['61A', '61B', '71B', '71D']);
    // Forbes at Atwood is much closer to Towers than the Fifth Ave pair.
    expect(result[0].name).toBe('Forbes Ave at Atwood');
    expect(result[0].walkMin).toBeGreaterThanOrEqual(1);
  });

  it('drops stops beyond maxMeters and rows with invalid coordinates', () => {
    const stops: BusStop[] = [
      stop({ objectID: 1, stop_name: 'Downtown', stop_lat: 40.4406, stop_lon: -80.0 }),
      stop({ objectID: 2, stop_name: 'Broken', stop_lat: NaN }),
    ];
    expect(nearestBusStops(stops, TOWERS, { maxMeters: 1200 })).toHaveLength(0);
  });

  it('respects the limit, closest first', () => {
    const stops: BusStop[] = [
      stop({ objectID: 1, stop_name: 'A', stop_lat: 40.4426, stop_lon: -79.9572 }),
      stop({ objectID: 2, stop_name: 'B', stop_lat: 40.4434, stop_lon: -79.9532 }),
      stop({ objectID: 3, stop_name: 'C', stop_lat: 40.443, stop_lon: -79.955 }),
    ];
    const result = nearestBusStops(stops, TOWERS, { limit: 2 });
    expect(result.map((s) => s.name)).toEqual(['A', 'C']);
  });
});

describe('nearestPogohStations', () => {
  it('sorts by distance, carries docks, and skips invalid rows', () => {
    const stations: PogohStation[] = [
      { Id: 1, Name: 'Fifth & Bigelow', 'Total Docks': 15, Latitude: CATHEDRAL.lat, Longitude: CATHEDRAL.lng },
      { Id: 2, Name: 'Forbes & Bouquet', 'Total Docks': 12, Latitude: 40.4419, Longitude: -79.9566 },
      { Id: 3, Name: 'Bad row', 'Total Docks': 10, Latitude: NaN, Longitude: -79.95 },
    ];
    const result = nearestPogohStations(stations, TOWERS);
    expect(result.map((s) => s.name)).toEqual(['Forbes & Bouquet', 'Fifth & Bigelow']);
    expect(result[0].docks).toBe(12);
  });
});
