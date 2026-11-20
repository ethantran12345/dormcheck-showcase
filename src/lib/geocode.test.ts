import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { distanceKm, geocodeAddress } from './geocode';
import { PITT, CMU, type University } from '@/config/universities';
import { campusCenterLatLng } from './campusLandmarks';

const pitt = campusCenterLatLng(PITT);
const cmu = campusCenterLatLng(CMU);

describe('distanceKm (the geocode sanity guard)', () => {
  it('is zero for the same point', () => {
    expect(distanceKm(cmu, cmu)).toBeCloseTo(0, 6);
  });

  it('puts the two Pittsburgh campuses within a couple of km', () => {
    const d = distanceKm(pitt, cmu);
    expect(d).toBeGreaterThan(0.5);
    expect(d).toBeLessThan(5);
  });

  it('rejects the Lancashire match Mapbox returned for "Towers lobby"', () => {
    // The real regression, observed 2026-08-06: proximity is a bias, not a
    // filter, so a free-text meetup string resolved to a village in England.
    const lancashire = { lat: 53.978244, lng: -2.104676 };
    expect(distanceKm(lancashire, cmu)).toBeGreaterThan(30);
  });

  it('is symmetric', () => {
    expect(distanceKm(pitt, cmu)).toBeCloseTo(distanceKm(cmu, pitt), 9);
  });
});

/**
 * A third tenant that is NOT in Pittsburgh. Pitt and CMU share a city, so they
 * can never prove a hardcoded "Pittsburgh, PA" was removed — only a school
 * somewhere else can.
 */
const RICE: University = {
  ...PITT,
  slug: 'rice',
  name: 'Rice University',
  shortName: 'Rice',
  city: 'Houston, TX',
  campusCenter: [-95.4018, 29.7174],
};

const mapboxHit = (lng: number, lat: number, placeName: string) => ({
  ok: true,
  json: async () => ({ features: [{ center: [lng, lat], place_name: placeName }] }),
});
const censusHit = (x: number, y: number, matchedAddress: string) => ({
  ok: true,
  json: async () => ({
    result: { addressMatches: [{ coordinates: { x, y }, matchedAddress }] },
  }),
});
const noMatch = { ok: true, json: async () => ({ features: [] }) };

/** Every fetch made during the last geocode call, in order. */
const calledUrls = (fetchMock: ReturnType<typeof vi.fn>): string[] =>
  fetchMock.mock.calls.map((c) => String(c[0]));

describe('geocodeAddress (one geocoder, per-tenant)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', 'test-token');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('biases Mapbox to the tenant campus centre it was handed, not to Pitt', async () => {
    fetchMock.mockResolvedValue(mapboxHit(-95.4, 29.717, '6100 Main St, Houston, Texas'));
    const res = await geocodeAddress('6100 Main St', RICE.campusCenter, {
      censusCity: RICE.city,
    });
    expect(res).toEqual({ lat: 29.717, lng: -95.4, label: '6100 Main St, Houston, Texas' });
    const url = calledUrls(fetchMock)[0];
    expect(url).toContain('proximity=-95.4018%2C29.7174');
    expect(url).not.toContain('40.44'); // no Pitt/Oakland latitude anywhere
  });

  it('returns the Mapbox label so the caller can show a confirm step', async () => {
    fetchMock.mockResolvedValue(mapboxHit(-79.9564, 40.4406, '123 Atwood St, Pittsburgh, PA'));
    const res = await geocodeAddress('123 Atwood St', PITT.campusCenter, {
      censusCity: PITT.city,
    });
    expect(res?.label).toBe('123 Atwood St, Pittsburgh, PA');
  });

  it('appends the tenant city to the Census fallback, never a hardcoded Pittsburgh', async () => {
    fetchMock
      .mockResolvedValueOnce(noMatch) // Mapbox finds nothing
      .mockResolvedValueOnce(censusHit(-95.4, 29.717, '6100 MAIN ST, HOUSTON, TX, 77005'));
    const res = await geocodeAddress('6100 Main St', RICE.campusCenter, {
      censusCity: RICE.city,
    });
    const censusUrl = calledUrls(fetchMock)[1];
    expect(censusUrl).toContain('geocoding.geo.census.gov');
    expect(censusUrl).toContain(encodeURIComponent('6100 Main St, Houston, TX'));
    expect(censusUrl).not.toContain('Pittsburgh');
    expect(res?.lat).toBeCloseTo(29.717, 4);
  });

  it('sends the CMU student their own city, resolved from config not a literal', async () => {
    fetchMock
      .mockResolvedValueOnce(noMatch)
      .mockResolvedValueOnce(censusHit(-79.9426, 40.4433, '5000 FORBES AVE, PITTSBURGH, PA'));
    await geocodeAddress('5000 Forbes Ave', CMU.campusCenter, { censusCity: CMU.city });
    const censusUrl = calledUrls(fetchMock)[1];
    expect(censusUrl).toContain(encodeURIComponent(`5000 Forbes Ave, ${CMU.city}`));
    // Mapbox must have been biased to CMU's centre, not Pitt's Schenley Quad.
    expect(calledUrls(fetchMock)[0]).toContain('proximity=-79.9426%2C40.4433');
  });

  it('discards a match past the 30km guard and falls through to Census', async () => {
    // The Lancashire village, exactly as Mapbox returned it for "Towers lobby".
    fetchMock
      .mockResolvedValueOnce(mapboxHit(-2.104676, 53.978244, 'Towers, Lancashire, England'))
      .mockResolvedValueOnce(censusHit(-79.9535, 40.4432, '3990 FIFTH AVE, PITTSBURGH, PA'));
    const res = await geocodeAddress('Towers lobby', CMU.campusCenter, {
      censusCity: CMU.city,
    });
    expect(res?.label).toBe('3990 FIFTH AVE, PITTSBURGH, PA');
    expect(distanceKm(res!, cmu)).toBeLessThan(30);
  });

  it('returns null rather than a pin an ocean away when nothing is near campus', async () => {
    fetchMock
      .mockResolvedValueOnce(mapboxHit(-2.104676, 53.978244, 'Towers, Lancashire, England'))
      .mockResolvedValueOnce(censusHit(-2.104676, 53.978244, 'Somewhere, England'));
    const res = await geocodeAddress('Towers lobby', CMU.campusCenter, {
      censusCity: CMU.city,
    });
    expect(res).toBeNull();
  });

  it('skips the Census fallback entirely when no city is given (free-text meetup copy)', async () => {
    fetchMock.mockResolvedValue(noMatch);
    const res = await geocodeAddress('Towers lobby', CMU.campusCenter);
    expect(res).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calledUrls(fetchMock)[0]).toContain('api.mapbox.com');
  });

  it('still reaches Census when there is no Mapbox token at all', async () => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', '');
    fetchMock.mockResolvedValueOnce(censusHit(-79.9564, 40.4406, '123 ATWOOD ST, PITTSBURGH, PA'));
    const res = await geocodeAddress('123 Atwood St', PITT.campusCenter, {
      censusCity: PITT.city,
    });
    expect(calledUrls(fetchMock)[0]).toContain('geocoding.geo.census.gov');
    expect(res?.lat).toBeCloseTo(40.4406, 4);
  });

  it('survives a provider throwing', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(
      geocodeAddress('123 Atwood St', PITT.campusCenter, { censusCity: PITT.city })
    ).resolves.toBeNull();
  });
});
