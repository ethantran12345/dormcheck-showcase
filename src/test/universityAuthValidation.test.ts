import { describe, it, expect } from 'vitest';
import {
  CMU,
  PITT,
  isUniversityEmail,
  isActiveUniversityEmail,
  isEduEmail,
  resolveUniversityByEmail,
} from '@/config/universities';
import { isAllowedEmail } from '@/lib/universityAuth';

describe('isAllowedEmail', () => {
  describe('Pitt validation', () => {
    it('accepts @pitt.edu addresses', () => {
      expect(isAllowedEmail('student@pitt.edu', PITT)).toBe(true);
    });

    it('rejects other .edu domains for Pitt', () => {
      expect(isAllowedEmail('student@rice.edu', PITT)).toBe(false);
      expect(isAllowedEmail('student@cmu.edu', PITT)).toBe(false);
      expect(isAllowedEmail('student@andrew.cmu.edu', PITT)).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(isAllowedEmail('Student@PITT.EDU', PITT)).toBe(true);
      expect(isAllowedEmail('STUDENT@pitt.edu', PITT)).toBe(true);
    });

    it('rejects lookalike subdomains', () => {
      // Exact-domain match only; mail.pitt.edu is not a registered domain
      expect(isAllowedEmail('student@mail.pitt.edu', PITT)).toBe(false);
    });

    it('rejects domain-suffix attacks', () => {
      // pitt.edu.attacker.com is not pitt.edu
      expect(isAllowedEmail('student@pitt.edu.attacker.com', PITT)).toBe(false);
    });

    it('rejects null/undefined', () => {
      expect(isAllowedEmail(null, PITT)).toBe(false);
      expect(isAllowedEmail(undefined, PITT)).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isAllowedEmail('', PITT)).toBe(false);
    });

    it('rejects non-university emails', () => {
      expect(isAllowedEmail('student@gmail.com', PITT)).toBe(false);
    });
  });

  describe('CMU validation', () => {
    it('accepts @andrew.cmu.edu', () => {
      expect(isAllowedEmail('cmutest@andrew.cmu.edu', CMU)).toBe(true);
    });

    it('accepts @cmu.edu', () => {
      expect(isAllowedEmail('student@cmu.edu', CMU)).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(isAllowedEmail('Student@ANDREW.CMU.EDU', CMU)).toBe(true);
      expect(isAllowedEmail('Student@CMU.EDU', CMU)).toBe(true);
    });

    it('rejects @pitt.edu for CMU', () => {
      expect(isAllowedEmail('student@pitt.edu', CMU)).toBe(false);
    });

    it('rejects subdomain variants', () => {
      expect(isAllowedEmail('student@mail.cmu.edu', CMU)).toBe(false);
    });
  });
});

describe('isUniversityEmail (underlying logic)', () => {
  it('uses exact-domain matching', () => {
    expect(isUniversityEmail(PITT, 'student@pitt.edu')).toBe(true);
    expect(isUniversityEmail(PITT, 'student@mail.pitt.edu')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isUniversityEmail(PITT, 'Student@PITT.EDU')).toBe(true);
  });

  it('trims whitespace', () => {
    expect(isUniversityEmail(PITT, '  student@pitt.edu  ')).toBe(true);
  });
});

describe('isActiveUniversityEmail', () => {
  it('returns true for active Pitt emails', () => {
    expect(isActiveUniversityEmail('student@pitt.edu')).toBe(true);
  });

  it('returns true for active CMU emails', () => {
    expect(isActiveUniversityEmail('student@andrew.cmu.edu')).toBe(true);
    expect(isActiveUniversityEmail('student@cmu.edu')).toBe(true);
  });

  it('returns false for unknown .edu domains', () => {
    expect(isActiveUniversityEmail('student@rice.edu')).toBe(false);
  });

  it('returns false for non-.edu addresses', () => {
    expect(isActiveUniversityEmail('student@gmail.com')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isActiveUniversityEmail(null)).toBe(false);
    expect(isActiveUniversityEmail(undefined)).toBe(false);
  });
});

describe('resolveUniversityByEmail', () => {
  it('resolves pitt.edu to Pitt', () => {
    expect(resolveUniversityByEmail('student@pitt.edu')).toBe(PITT);
  });

  it('resolves andrew.cmu.edu to CMU', () => {
    expect(resolveUniversityByEmail('cmutest@andrew.cmu.edu')).toBe(CMU);
  });

  it('resolves cmu.edu to CMU', () => {
    expect(resolveUniversityByEmail('student@cmu.edu')).toBe(CMU);
  });

  it('is case-insensitive', () => {
    expect(resolveUniversityByEmail('Student@PITT.EDU')).toBe(PITT);
    expect(resolveUniversityByEmail('Student@ANDREW.CMU.EDU')).toBe(CMU);
  });

  it('returns undefined for unknown .edu domain (waitlist path)', () => {
    expect(resolveUniversityByEmail('student@rice.edu')).toBeUndefined();
  });

  it('returns undefined for non-.edu address', () => {
    expect(resolveUniversityByEmail('student@gmail.com')).toBeUndefined();
  });

  it('returns undefined for null/undefined', () => {
    expect(resolveUniversityByEmail(null)).toBeUndefined();
    expect(resolveUniversityByEmail(undefined)).toBeUndefined();
  });

  it('does not match lookalike subdomains', () => {
    // Exact-domain match only
    expect(resolveUniversityByEmail('student@mail.pitt.edu')).toBeUndefined();
  });
});

describe('isEduEmail', () => {
  it('returns true for valid .edu domains', () => {
    expect(isEduEmail('student@pitt.edu')).toBe(true);
    expect(isEduEmail('student@rice.edu')).toBe(true);
    expect(isEduEmail('student@andrew.cmu.edu')).toBe(true);
  });

  it('returns true for .edu subdomains', () => {
    expect(isEduEmail('student@mail.pitt.edu')).toBe(true);
  });

  it('returns false for non-.edu addresses', () => {
    expect(isEduEmail('student@gmail.com')).toBe(false);
    expect(isEduEmail('student@example.org')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isEduEmail(null)).toBe(false);
    expect(isEduEmail(undefined)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isEduEmail('Student@PITT.EDU')).toBe(true);
  });
});

describe('default-university landmine (2026-07-09)', () => {
  it('documents that isAllowedEmail requires explicit university parameter', () => {
    // NOTE: isAllowedEmail REQUIRES the university parameter.
    // There is no DEFAULT_UNIVERSITY fallback. This was a breaking bug on
    // 2026-07-10 when CMU sign-in silently defaulted to Pitt validation.
    // Callers must resolve the school (from typed email, ?school= param, or
    // session email) before checking isAllowedEmail.
    const cmuEmail = 'student@andrew.cmu.edu';
    const pittEmail = 'student@pitt.edu';

    // When explicitly passed the correct university, both work
    expect(isAllowedEmail(cmuEmail, CMU)).toBe(true);
    expect(isAllowedEmail(pittEmail, PITT)).toBe(true);

    // But cross-university validation fails (as expected)
    expect(isAllowedEmail(cmuEmail, PITT)).toBe(false);
    expect(isAllowedEmail(pittEmail, CMU)).toBe(false);
  });
});
