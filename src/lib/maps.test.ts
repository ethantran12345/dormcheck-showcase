import { describe, expect, it } from 'vitest';
import { buildDirectionsUrl } from '@/lib/maps';

describe('buildDirectionsUrl', () => {
  const cathedral = { name: 'Cathedral of Learning', lat: 40.4434, lng: -79.9532 };
  const towers = { name: 'Litchfield Towers', lat: 40.4425, lng: -79.9571 };

  it('apple: coordinates win over name/address', () => {
    const url = buildDirectionsUrl('apple', { to: cathedral });
    expect(url).toBe('https://maps.apple.com/?daddr=40.4434%2C-79.9532');
  });

  it('apple: origin and walking mode', () => {
    const url = new URL(buildDirectionsUrl('apple', { to: cathedral, from: towers, mode: 'walking' }));
    expect(url.searchParams.get('daddr')).toBe('40.4434,-79.9532');
    expect(url.searchParams.get('saddr')).toBe('40.4425,-79.9571');
    expect(url.searchParams.get('dirflg')).toBe('w');
  });

  it('apple: transit maps to dirflg=r', () => {
    const url = new URL(buildDirectionsUrl('apple', { to: cathedral, mode: 'transit' }));
    expect(url.searchParams.get('dirflg')).toBe('r');
  });

  it('google: coordinates, origin, and cycling→bicycling', () => {
    const url = new URL(buildDirectionsUrl('google', { to: cathedral, from: towers, mode: 'cycling' }));
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('destination')).toBe('40.4434,-79.9532');
    expect(url.searchParams.get('origin')).toBe('40.4425,-79.9571');
    expect(url.searchParams.get('travelmode')).toBe('bicycling');
  });

  it('falls back to address text, then name, when coordinates are missing', () => {
    const byAddress = new URL(
      buildDirectionsUrl('google', { to: { address: '3990 Fifth Ave, Pittsburgh, PA', name: 'WPU' } }),
    );
    expect(byAddress.searchParams.get('destination')).toBe('3990 Fifth Ave, Pittsburgh, PA');

    const byName = new URL(buildDirectionsUrl('apple', { to: { name: 'Hillman Library' } }));
    expect(byName.searchParams.get('daddr')).toBe('Hillman Library');
  });

  it('non-finite coordinates are ignored in favor of text', () => {
    const url = new URL(
      buildDirectionsUrl('apple', { to: { lat: NaN, lng: -79.95, name: 'Posvar Hall' } }),
    );
    expect(url.searchParams.get('daddr')).toBe('Posvar Hall');
  });

  it('omits mode and origin params when not provided (legacy call shape)', () => {
    const url = new URL(buildDirectionsUrl('apple', { to: { lat: 40.44, lng: -79.95 } }));
    expect(url.searchParams.has('saddr')).toBe(false);
    expect(url.searchParams.has('dirflg')).toBe(false);
  });
});
