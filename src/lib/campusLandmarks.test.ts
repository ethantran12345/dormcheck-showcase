import { describe, it, expect } from 'vitest';
import { resolveCampusLandmark, campusCenterLatLng, neutralMeetupSpots } from './campusLandmarks';
import { PITT, CMU } from '@/config/universities';

describe('resolveCampusLandmark', () => {
  it('matches Pitt landmarks for the Pitt tenant', () => {
    expect(resolveCampusLandmark('Cathy fountain', 'pitt')).toEqual({
      lat: 40.4443,
      lng: -79.9531,
    });
    expect(resolveCampusLandmark('Towers lobby', 'pitt')).toEqual({
      lat: 40.4426,
      lng: -79.9573,
    });
  });

  it('never hands Pitt coordinates to another tenant', () => {
    // The whole point of the registry: "Towers" is a Pitt building name, and a
    // CMU student typing it must not be pinned at Litchfield Towers.
    expect(resolveCampusLandmark('Towers lobby', 'cmu')).toBeNull();
    expect(resolveCampusLandmark('Cathedral of Learning', 'cmu')).toBeNull();
  });

  it('matches CMU landmarks for the CMU tenant', () => {
    expect(resolveCampusLandmark('meet me on the cut', 'cmu')).toEqual({
      lat: 40.4439,
      lng: -79.9428,
    });
    expect(resolveCampusLandmark('Cohon University Center', 'cmu')).toEqual({
      lat: 40.4435,
      lng: -79.942,
    });
  });

  it('matches Carlow landmarks for the Carlow tenant', () => {
    expect(resolveCampusLandmark('Grace Library', 'carlow')).toEqual({
      lat: 40.4392,
      lng: -79.9636,
    });
  });

  it('never hands one school a neighbour school landmark', () => {
    // The registries are seeded for three co-located schools now, so the
    // isolation rule matters MORE than when CMU's set was empty.
    expect(resolveCampusLandmark('the cut', 'pitt')).toBeNull();
    expect(resolveCampusLandmark('Grace Library', 'cmu')).toBeNull();
    expect(resolveCampusLandmark('Cohon', 'carlow')).toBeNull();
  });

  it('does not match a bare "cut" inside an unrelated word', () => {
    // 'the cut' is the keyword precisely so "haircut clippers, $5" is not a pin.
    expect(resolveCampusLandmark('haircut clippers', 'cmu')).toBeNull();
  });

  it('returns null for an unknown slug rather than falling back to Pitt', () => {
    expect(resolveCampusLandmark('cathedral', 'rice')).toBeNull();
  });

  it('returns null for blank input', () => {
    expect(resolveCampusLandmark('   ', 'pitt')).toBeNull();
  });
});

describe('neutralMeetupSpots', () => {
  it('suggests shared ground for two different Pittsburgh schools', () => {
    const spots = neutralMeetupSpots('pitt', 'cmu');
    expect(spots.length).toBeGreaterThan(0);
    expect(spots.map((s) => s.id)).toContain('schenley-plaza');
    expect(neutralMeetupSpots('carlow', 'cmu')).toEqual(spots);
  });

  it('suggests nothing when both sides are the same school', () => {
    // Same-school meetups already have the seller's own landmark copy; a
    // "neutral ground" prompt there is noise that trains people to ignore it.
    expect(neutralMeetupSpots('pitt', 'pitt')).toEqual([]);
  });

  it('fails CLOSED for a school it has no suggestions for', () => {
    // A wrong suggestion sends two strangers somewhere one of them cannot get
    // to, so an unknown pair must produce silence, never a nearest guess.
    expect(neutralMeetupSpots('pitt', 'rice')).toEqual([]);
    expect(neutralMeetupSpots('', 'cmu')).toEqual([]);
  });
});

describe('campusCenterLatLng', () => {
  it('transposes Mapbox [lng, lat] into { lat, lng } per tenant', () => {
    expect(campusCenterLatLng(PITT)).toEqual({ lat: 40.443, lng: -79.956 });
    expect(campusCenterLatLng(CMU)).toEqual({ lat: 40.4433, lng: -79.9426 });
  });

  it('gives CMU a centre that is not Pitt', () => {
    expect(campusCenterLatLng(CMU)).not.toEqual(campusCenterLatLng(PITT));
  });
});
