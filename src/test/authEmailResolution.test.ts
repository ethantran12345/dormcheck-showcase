import { afterEach, describe, expect, it } from 'vitest';
import {
  CMU,
  PITT,
  isActiveUniversityEmail,
  isEduEmail,
  resolveUniversityByEmail,
} from '@/config/universities';
import {
  clearPersistedUniversity,
  persistSelectedUniversity,
  readPersistedUniversitySlug,
} from '@/lib/selectedUniversity';

// Identifier-first auth: /auth resolves the school from the typed email via
// resolveUniversityByEmail(). These tests pin the resolver behavior the auth
// card's state machine depends on.
describe('identifier-first email resolution', () => {
  it('resolves pitt.edu to Pitt', () => {
    expect(resolveUniversityByEmail('student@pitt.edu')).toBe(PITT);
  });

  it('resolves both CMU domains to CMU', () => {
    expect(resolveUniversityByEmail('cmutest@andrew.cmu.edu')).toBe(CMU);
    expect(resolveUniversityByEmail('someone@cmu.edu')).toBe(CMU);
  });

  it('is case-insensitive on the domain', () => {
    expect(resolveUniversityByEmail('Student@PITT.EDU')).toBe(PITT);
  });

  it('returns undefined for an unknown .edu (waitlist path)', () => {
    expect(resolveUniversityByEmail('student@rice.edu')).toBeUndefined();
    expect(isEduEmail('student@rice.edu')).toBe(true);
    expect(isActiveUniversityEmail('student@rice.edu')).toBe(false);
  });

  it('returns undefined for a non-.edu address (use-school-email path)', () => {
    expect(resolveUniversityByEmail('student@gmail.com')).toBeUndefined();
    expect(isEduEmail('student@gmail.com')).toBe(false);
  });

  it('does not match lookalike subdomains of an active domain', () => {
    // exact-domain match only: mail.pitt.edu is not a registered domain
    expect(resolveUniversityByEmail('student@mail.pitt.edu')).toBeUndefined();
    expect(isEduEmail('student@mail.pitt.edu')).toBe(true);
  });
});

describe('clearPersistedUniversity', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('removes the persisted pre-auth school choice', () => {
    persistSelectedUniversity(CMU.slug);
    expect(readPersistedUniversitySlug()).toBe(CMU.slug);
    clearPersistedUniversity();
    expect(readPersistedUniversitySlug()).toBeNull();
  });
});
