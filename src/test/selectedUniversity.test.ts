import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CMU,
  CMU_UNIVERSITY_ID,
  PITT,
  UNIVERSITIES,
  University,
  activeUniversities,
  isActiveUniversityEmail,
} from '@/config/universities';
import {
  persistSelectedUniversity,
  resolveSelectedUniversity,
} from '@/lib/selectedUniversity';

const RICE: University = {
  id: 'rice-test-id',
  slug: 'rice',
  name: 'Rice University',
  shortName: 'Rice',
  emailDomains: ['rice.edu'],
  city: 'Houston, TX',
  isActive: true,
  authMethods: ['microsoft', 'email'],
  campusCenter: [-95.4018, 29.7174],
};

const INACTIVE: University = {
  id: 'inactive-test-id',
  slug: 'inactive',
  name: 'Not Live University',
  shortName: 'NLU',
  emailDomains: ['inactive.edu'],
  city: 'Nowhere, NA',
  isActive: false,
  authMethods: ['google', 'email'],
  campusCenter: [0, 0],
};

function addUniversity(u: University) {
  UNIVERSITIES[u.slug] = u;
}
function removeUniversity(slug: string) {
  delete UNIVERSITIES[slug];
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('config: Pitt defaults (school-aware login)', () => {
  it('exposes Google + email, not Microsoft, and is active', () => {
    expect(PITT.authMethods).toEqual(['google', 'email']);
    expect(PITT.authMethods).not.toContain('microsoft');
    expect(PITT.isActive).toBe(true);
  });

  it('is active alongside CMU and Carlow', () => {
    expect(activeUniversities().map((u) => u.slug).sort()).toEqual(['carlow', 'cmu', 'pitt']);
  });

  it('isActiveUniversityEmail matches every active-school domain', () => {
    expect(isActiveUniversityEmail('student@pitt.edu')).toBe(true);
    expect(isActiveUniversityEmail('student@andrew.cmu.edu')).toBe(true);
    expect(isActiveUniversityEmail('student@live.carlow.edu')).toBe(true);
    expect(isActiveUniversityEmail('student@rice.edu')).toBe(false);
  });
});

describe('resolveSelectedUniversity - two active schools (Pitt + CMU baseline)', () => {
  it('needs a picker: no param resolves to null with more than one active school', () => {
    expect(resolveSelectedUniversity(null)).toBeNull();
    expect(resolveSelectedUniversity('anything')).toBeNull();
  });

  it('resolves a valid active ?school= param by slug', () => {
    expect(resolveSelectedUniversity('cmu')?.slug).toBe('cmu');
    expect(resolveSelectedUniversity('pitt')?.slug).toBe('pitt');
  });
});

describe('resolveSelectedUniversity - two active schools', () => {
  beforeEach(() => addUniversity(RICE));
  afterEach(() => removeUniversity('rice'));

  it('returns null when nothing is chosen yet (picker needed)', () => {
    expect(resolveSelectedUniversity(null)).toBeNull();
  });

  it('resolves ?school= by slug and persists it', () => {
    expect(resolveSelectedUniversity('rice')?.slug).toBe('rice');
    // persisted -> next resolve with no param still returns Rice
    expect(resolveSelectedUniversity(null)?.slug).toBe('rice');
  });

  it('resolves ?school= leniently by email domain', () => {
    expect(resolveSelectedUniversity('rice.edu')?.slug).toBe('rice');
  });

  it('honors a persisted choice', () => {
    persistSelectedUniversity('pitt');
    expect(resolveSelectedUniversity(null)?.slug).toBe('pitt');
  });

  it('ignores a stale/invalid persisted slug', () => {
    persistSelectedUniversity('does-not-exist');
    expect(resolveSelectedUniversity(null)).toBeNull();
  });

  it('now counts Rice email as an active university', () => {
    expect(isActiveUniversityEmail('student@rice.edu')).toBe(true);
  });
});

describe('isActive gating', () => {
  beforeEach(() => addUniversity(INACTIVE));
  afterEach(() => removeUniversity('inactive'));

  it('excludes inactive schools from the picker list and email gate', () => {
    expect(activeUniversities().map((u) => u.slug)).not.toContain('inactive');
    expect(isActiveUniversityEmail('student@inactive.edu')).toBe(false);
  });

  it('does not resolve an inactive ?school= param', () => {
    // Pitt + CMU are both active, so an inactive param falls through to the
    // picker (null) rather than any sole-active school.
    expect(resolveSelectedUniversity('inactive')).toBeNull();
  });
});

describe('config: CMU live (flipped 2026-07-10)', () => {
  it('is registered with the fixed seed UUID, email-only, active', () => {
    expect(CMU.id).toBe(CMU_UNIVERSITY_ID);
    expect(CMU.id).toBe('00000000-0000-4000-8000-000000000002');
    expect(CMU.emailDomains).toEqual(['andrew.cmu.edu', 'cmu.edu']);
    expect(CMU.authMethods).toEqual(['email']);
    expect(CMU.isActive).toBe(true);
  });

  it('is in the picker, the param resolver, and the email gate', () => {
    expect(activeUniversities().map((u) => u.slug).sort()).toEqual(['carlow', 'cmu', 'pitt']);
    expect(resolveSelectedUniversity('cmu')?.slug).toBe('cmu');
    expect(resolveSelectedUniversity('andrew.cmu.edu')?.slug).toBe('cmu');
    expect(isActiveUniversityEmail('student@andrew.cmu.edu')).toBe(true);
    expect(isActiveUniversityEmail('student@cmu.edu')).toBe(true);
  });
});
