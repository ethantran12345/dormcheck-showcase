import { describe, it, expect } from 'vitest';
import {
  scoreRoommateMatch,
  getViewerPersona,
  type MatchInput,
} from '@/lib/roommateMatch';
import { getFreshmanGraduationYear } from '@/lib/academicYear';

const fullProfile = (overrides: Partial<MatchInput> = {}): MatchInput => ({
  cleanliness: 'Organized',
  social_level: 'Balanced',
  study_style: 'Library',
  conflict_style: 'Direct/Open',
  guests: 'Occasionally',
  sleep: 'Early',
  smoking: 'Non-smoker',
  temp: 'Cold',
  dealbreakers: [],
  tags: [],
  graduation_year: 2029,
  grade_level: 'Freshman',
  preferred_areas: [],
  current_dorm: null,
  housing_type: null,
  ...overrides,
});

describe('scoreRoommateMatch', () => {
  it('scores identical full profiles high with high confidence and reasons', () => {
    const a = fullProfile({ tags: ['gaming', 'gym'] });
    const b = fullProfile({ tags: ['gaming', 'gym'] });
    const r = scoreRoommateMatch(a, b);
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.confidence).toBe('high');
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.conflicts).toHaveLength(0);
  });

  it('scores opposite lifestyles low', () => {
    const a = fullProfile({
      cleanliness: 'Very Clean',
      social_level: 'Quiet',
      guests: 'Rarely',
      sleep: 'Early',
      temp: 'Cold',
      study_style: 'Library',
      conflict_style: 'Direct/Open',
      smoking: 'Non-smoker',
    });
    const b = fullProfile({
      cleanliness: 'Messy',
      social_level: 'Social',
      guests: 'Often',
      sleep: 'Late',
      temp: 'Warm',
      study_style: 'In-Room',
      conflict_style: 'Text Only',
      smoking: 'Smoker',
    });
    const r = scoreRoommateMatch(a, b);
    expect(r.score).toBeLessThan(20);
  });

  it('gives half credit for adjacent ordinal values', () => {
    const base = fullProfile();
    const exact = scoreRoommateMatch(base, fullProfile());
    const adjacent = scoreRoommateMatch(
      fullProfile({ cleanliness: 'Very Clean' }),
      fullProfile({ cleanliness: 'Organized' }),
    );
    const opposite = scoreRoommateMatch(
      fullProfile({ cleanliness: 'Very Clean' }),
      fullProfile({ cleanliness: 'Messy' }),
    );
    expect(adjacent.score).toBeLessThan(exact.score);
    expect(adjacent.score).toBeGreaterThan(opposite.score);
  });

  it('treats missing data as neutral and flags low confidence under 3 joint dims', () => {
    const sparse: MatchInput = { cleanliness: 'Organized', sleep: 'Early' };
    const r = scoreRoommateMatch(sparse, fullProfile());
    expect(r.confidence).toBe('low');
    // Both answered dims match exactly, so the score is high, not dragged to 0.
    expect(r.score).toBeGreaterThanOrEqual(90);
  });

  it('penalizes a violated dealbreaker and surfaces a conflict without excluding', () => {
    const viewer = fullProfile({ dealbreakers: ['No Smoking'] });
    const candidate = fullProfile({ smoking: 'Smoker' });
    const control = scoreRoommateMatch(fullProfile(), fullProfile({ smoking: 'Smoker' }));
    const r = scoreRoommateMatch(viewer, candidate);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toContain('No Smoking');
    expect(r.score).toBeLessThan(control.score);
    expect(r.score).toBeGreaterThan(0);
  });

  it('checks dealbreakers in both directions', () => {
    const viewer = fullProfile({ guests: 'Often' });
    const candidate = fullProfile({ dealbreakers: ['No Overnight Guests'] });
    const r = scoreRoommateMatch(viewer, candidate);
    expect(r.conflicts.some((c) => c.includes('Their boundary'))).toBe(true);
  });

  it('ignores custom/unmapped dealbreakers', () => {
    const viewer = fullProfile({ dealbreakers: ['No loud typing at 3am'] });
    const r = scoreRoommateMatch(viewer, fullProfile());
    const control = scoreRoommateMatch(fullProfile(), fullProfile());
    expect(r.conflicts).toHaveLength(0);
    expect(r.score).toBe(control.score);
  });

  it('coalesces legacy columns (guest_preference, sleep_habit, temp_preference)', () => {
    const legacy = fullProfile({
      guests: null,
      guest_preference: 'Occasionally',
      sleep: null,
      sleep_habit: 'Early',
      temp: null,
      temp_preference: 'Cold',
    });
    const r = scoreRoommateMatch(fullProfile(), legacy);
    expect(r.score).toBeGreaterThanOrEqual(90);
  });

  it('excludes onboarding_interest tags and rewards overlap', () => {
    const noOverlap = scoreRoommateMatch(
      fullProfile({ tags: ['gaming'] }),
      fullProfile({ tags: ['knitting'] }),
    );
    const overlap = scoreRoommateMatch(
      fullProfile({ tags: ['gaming'] }),
      fullProfile({ tags: ['gaming'] }),
    );
    expect(overlap.score).toBeGreaterThan(noOverlap.score);
    expect(overlap.reasons).toContain('Shared: gaming');

    const onboardingOnly = scoreRoommateMatch(
      fullProfile({ tags: ['onboarding_interest:gaming'] }),
      fullProfile({ tags: ['onboarding_interest:gaming'] }),
    );
    expect(onboardingOnly.reasons.some((x) => x.includes('onboarding_interest'))).toBe(false);
  });

  it('rewards context: same graduation year and same dorm', () => {
    const withContext = scoreRoommateMatch(
      fullProfile({ graduation_year: 2029, current_dorm: 'Tower A' }),
      fullProfile({ graduation_year: 2029, current_dorm: 'Tower A' }),
    );
    const withoutContext = scoreRoommateMatch(
      fullProfile({ graduation_year: 2029, current_dorm: 'Tower A' }),
      fullProfile({ graduation_year: 2027, current_dorm: 'Tower B' }),
    );
    expect(withContext.score).toBeGreaterThan(withoutContext.score);
    expect(withContext.reasons).toContain('Same dorm');
  });

  it('always returns an integer between 0 and 100', () => {
    const cases: Array<[MatchInput, MatchInput]> = [
      [{}, {}],
      [fullProfile(), fullProfile()],
      [fullProfile({ dealbreakers: ['No Smoking'] }), fullProfile({ smoking: 'Vape' })],
      [{ cleanliness: 'Very Clean' }, { cleanliness: 'Messy' }],
    ];
    for (const [a, b] of cases) {
      const r = scoreRoommateMatch(a, b);
      expect(Number.isInteger(r.score)).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });
});

describe('getViewerPersona', () => {
  it('classifies by grade_level when present', () => {
    expect(getViewerPersona({ grade_level: 'Freshman' })).toBe('underclassman');
    expect(getViewerPersona({ grade_level: 'Sophomore' })).toBe('underclassman');
    expect(getViewerPersona({ grade_level: 'Junior' })).toBe('upperclassman');
    expect(getViewerPersona({ grade_level: 'Senior' })).toBe('upperclassman');
    expect(getViewerPersona({ grade_level: 'Graduate' })).toBe('upperclassman');
  });

  it('falls back to graduation_year, then defaults to underclassman', () => {
    const baseYear = getFreshmanGraduationYear();
    expect(getViewerPersona({ graduation_year: baseYear })).toBe('underclassman');
    expect(getViewerPersona({ graduation_year: baseYear - 1 })).toBe('underclassman');
    expect(getViewerPersona({ graduation_year: baseYear - 2 })).toBe('upperclassman');
    expect(getViewerPersona({})).toBe('underclassman');
  });
});
