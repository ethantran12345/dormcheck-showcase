import { describe, it, expect } from 'vitest';
import { termForDate, nextTermAfter, type AcademicTerm } from '@/lib/academicTerms';

const terms: AcademicTerm[] = [
  {
    id: 't-spring',
    university_id: 'u',
    name: 'Spring 2027',
    code: 'spring-2027',
    starts_at: '2027-01-06',
    ends_at: '2027-05-01',
  },
  {
    id: 't-fall',
    university_id: 'u',
    name: 'Fall 2026',
    code: 'fall-2026',
    starts_at: '2026-08-24',
    ends_at: '2026-12-19',
  },
];

describe('academic term helpers (mirror current_term / next_term)', () => {
  it('termForDate finds the containing term, inclusive of boundaries', () => {
    expect(termForDate(terms, new Date('2026-10-01'))?.code).toBe('fall-2026');
    expect(termForDate(terms, new Date('2026-08-24'))?.code).toBe('fall-2026');
    expect(termForDate(terms, new Date('2026-12-19'))?.code).toBe('fall-2026');
  });

  it('termForDate is undefined between terms', () => {
    expect(termForDate(terms, new Date('2026-12-25'))).toBeUndefined();
  });

  it('nextTermAfter returns the soonest future term', () => {
    expect(nextTermAfter(terms, new Date('2026-07-12'))?.code).toBe('fall-2026');
    expect(nextTermAfter(terms, new Date('2026-12-25'))?.code).toBe('spring-2027');
    expect(nextTermAfter(terms, new Date('2027-06-01'))).toBeUndefined();
  });
});
