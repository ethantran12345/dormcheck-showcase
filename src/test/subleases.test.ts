import { describe, expect, it } from 'vitest';
import {
  firstUnmetSubleaseTerm,
  formatSubleaseRange,
  subleaseTermsValid,
  subleaseTitle,
  subleaseTrustFields,
} from '@/lib/subleases';
import { resolveFeatureFlags } from '@/hooks/useFeatureFlags';

const t = (key: string) => key;

// A typed address with an autocomplete suggestion accepted behind it. The
// ADDRESS is what the terms require; `building_id` is enrichment that rides along
// and is never the thing being tested for.
const ADDRESSED = {
  building_id: '11111111-1111-4111-8111-111111111111',
  building_name: '3400 Forbes Ave',
};

describe('sublease terms', () => {
  it('requires an address and a forward-running date range', () => {
    expect(
      subleaseTermsValid({
        ...ADDRESSED,
        sublease_start: '2026-09-01',
        sublease_end: '2026-12-20',
      }),
    ).toBe(true);
    expect(firstUnmetSubleaseTerm({})).toBe('building');
    expect(firstUnmetSubleaseTerm(ADDRESSED)).toBe('dates');
    expect(
      firstUnmetSubleaseTerm({
        ...ADDRESSED,
        sublease_start: '2026-12-20',
        sublease_end: '2026-09-01',
      }),
    ).toBe('range');
    // Equal dates are a zero-length lease, not a one-day one.
    expect(
      firstUnmetSubleaseTerm({
        ...ADDRESSED,
        sublease_start: '2026-09-01',
        sublease_end: '2026-09-01',
      }),
    ).toBe('range');
  });

  it('accepts an address the registry has never heard of', () => {
    // The 2026-08-18 model, and the assertion that stops the picker coming back:
    // an address alone is a COMPLETE answer to "where". It geocodes at submit and
    // it pins, exactly like one taken from autocomplete.
    const typedOnly = {
      building_name: '428 Semple St',
      sublease_start: '2026-09-01',
      sublease_end: '2026-12-20',
    };
    expect(subleaseTermsValid(typedOnly)).toBe(true);
    expect(firstUnmetSubleaseTerm(typedOnly)).toBe(null);
    // A blank id alongside the address changes nothing: the address satisfied it.
    expect(firstUnmetSubleaseTerm({ ...typedOnly, building_id: '   ' })).toBe(null);
  });

  it('does NOT accept a registry id as a substitute for the address', () => {
    // `building_id` is enrichment, and an id with no address is not a state the
    // composer can produce — a suggestion always fills the address too. If this
    // ever passes, "where" can be satisfied by a value the geocoder never sees
    // and the card cannot print, and the listing posts with an empty title.
    const idOnly = {
      building_id: '11111111-1111-4111-8111-111111111111',
      sublease_start: '2026-09-01',
      sublease_end: '2026-12-20',
    };
    expect(subleaseTermsValid(idOnly)).toBe(false);
    expect(firstUnmetSubleaseTerm(idOnly)).toBe('building');
  });

  it('still requires an address, and whitespace is not one', () => {
    // Any address posts; no address does not. The discriminant stays 'building'
    // across all three eras of this field so no caller's copy had to change.
    const dates = { sublease_start: '2026-09-01', sublease_end: '2026-12-20' };
    expect(subleaseTermsValid(dates)).toBe(false);
    expect(firstUnmetSubleaseTerm(dates)).toBe('building');
    expect(firstUnmetSubleaseTerm({ ...dates, building_name: '   ' })).toBe('building');
    expect(firstUnmetSubleaseTerm({ ...dates, building_id: '  ', building_name: '  ' })).toBe(
      'building',
    );
  });

  it('titles a listing from its address, with or without a registry id', () => {
    // subleaseTitle() reads building_name and nothing else, so the "a sublease's
    // headline is a structured value" contract holds however the address got
    // there. Without this a typed address would post with an empty title and be
    // rejected by useMyListings.
    expect(subleaseTitle({ building_name: '  428 Semple St  ' })).toBe('428 Semple St');
    expect(subleaseTitle({ building_id: null, building_name: 'Oakwood Flats' })).toBe(
      'Oakwood Flats',
    );
  });

  it('titles a sublease with its address, never with prose', () => {
    expect(
      subleaseTitle({
        building_name: '  Sutherland Hall ',
        house_rules: 'MUST SEE!!! CHEAPEST ON CAMPUS',
      }),
    ).toBe('Sutherland Hall');
  });

  it('renders the date range in local time, not UTC', () => {
    // `new Date('2026-09-01')` is UTC midnight, which formats as Aug 31 for every
    // student west of Greenwich. This is the regression that check exists for.
    expect(formatSubleaseRange('2026-09-01', '2026-12-20')).toBe('Sep 1 – Dec 20');
    expect(formatSubleaseRange('2026-09-01', null)).toBe('Sep 1');
    expect(formatSubleaseRange(null, null)).toBe('');
  });
});

describe('subleaseTrustFields', () => {
  it('never surfaces free text, at any position', () => {
    const fields = subleaseTrustFields(
      {
        sublease_start: '2026-09-01',
        sublease_end: '2026-12-20',
        included_utilities: ['water', 'internet'],
        is_furnished: true,
        has_parking: true,
        gender_preference: 'female',
        house_rules: 'no guests after 10',
        additional_rules: 'call me',
      },
      t,
    );
    const rendered = JSON.stringify(fields);
    expect(rendered).not.toContain('no guests after 10');
    expect(rendered).not.toContain('call me');
    expect(fields).toHaveLength(5);
  });

  it('omits defaults so a card is facts, not a filled-in form', () => {
    const fields = subleaseTrustFields(
      {
        sublease_start: '2026-09-01',
        sublease_end: '2026-12-20',
        is_furnished: false,
        has_parking: false,
        gender_preference: 'any',
      },
      t,
    );
    expect(fields.map((f) => f.label)).toEqual(['marketplace:sublease.datesShort']);
  });

  it('drops a utility value the app does not define', () => {
    const fields = subleaseTrustFields({ included_utilities: ['water', 'gold-plated bidet'] }, t);
    expect(fields[0]?.value).toBe('marketplace:sublease.utility.water');
  });
});

describe('sublease shipping gate', () => {
  const auth = { userId: 'u1', isAdmin: false, profileLoaded: true };

  it('lets a university turn subleases on for the web', () => {
    const flags = resolveFeatureFlags(auth, true, { showPostSublease: true }, false);
    expect(flags.showPostSublease).toBe(true);
  });

  it('allows subleases on native when the university enabled them', () => {
    // Ethan overrode the remaining native composer clamp on 2026-08-18 because
    // the browse surface already carries the rental exposure.
    const flags = resolveFeatureFlags(auth, true, { showPostSublease: true }, true);
    expect(flags.showPostSublease).toBe(true);
    expect(flags.showPostItem).toBe(true);
  });
});
