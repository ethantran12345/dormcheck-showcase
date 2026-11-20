import { describe, it, expect } from 'vitest';
import { resolveCampusBuilding } from './campusMapData';

describe('resolveCampusBuilding', () => {
  it('resolves Pitt buildings for the Pitt tenant', () => {
    expect(resolveCampusBuilding('Cathedral of Learning', 'pitt')).toEqual({
      name: 'Cathedral of Learning',
      lat: 40.4434,
      lng: -79.9532,
    });
  });

  it('resolves reference pins as well as academic buildings', () => {
    expect(resolveCampusBuilding('Panther Central', 'pitt')).toEqual({
      name: 'Panther Central',
      lat: 40.4449,
      lng: -79.9542,
    });
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    expect(resolveCampusBuilding('  hillman library  ', 'pitt')?.name).toBe('Hillman Library');
  });

  it('never hands Pitt coordinates to another tenant', () => {
    // The defect this registry replaced: a CMU move-in step naming a building
    // resolved against the flat Pitt table and produced an Oakland walk time.
    expect(resolveCampusBuilding('Cathedral of Learning', 'cmu')).toBeNull();
    expect(resolveCampusBuilding('Panther Central', 'cmu')).toBeNull();
  });

  it('returns null for CMU, whose building set is deliberately empty', () => {
    expect(resolveCampusBuilding('Wean Hall', 'cmu')).toBeNull();
  });

  it('returns null for an unknown slug rather than falling back to Pitt', () => {
    expect(resolveCampusBuilding('Cathedral of Learning', 'rice')).toBeNull();
  });

  it('returns null for empty or blank input', () => {
    expect(resolveCampusBuilding(null, 'pitt')).toBeNull();
    expect(resolveCampusBuilding(undefined, 'pitt')).toBeNull();
    expect(resolveCampusBuilding('   ', 'pitt')).toBeNull();
  });
});
