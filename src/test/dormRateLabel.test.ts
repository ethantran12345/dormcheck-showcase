import { describe, it, expect } from 'vitest';
import { dormRateLine } from '@/components/my-home/SavedHomeBand';
import type { Dorm } from '@/types';

// Regression guard from the 2026-07-10 dorm-data audit: six affiliated apartments store
// MONTHLY rent in rate_per_term (rent_period='month'). Every price surface must label the
// period; a $1,405/mo apartment must never read as a bare per-term price.

function makeDorm(overrides: Partial<Dorm>): Dorm {
  return {
    id: '1',
    name: 'Test Hall',
    image: '',
    badges: [],
    semesterRate: 5805,
    laundryPrice: '',
    mealPlanRequired: false,
    acType: 'Central',
    description: '',
    audienceType: 'Upperclassman',
    ...overrides,
  } as Dorm;
}

describe('dormRateLine', () => {
  it('labels monthly-billed halls as /mo', () => {
    const darragh = makeDorm({ name: 'Darragh Street Apartments', semesterRate: 1405, rent_period: 'month', rentPeriod: 'month' });
    expect(dormRateLine(darragh)).toBe('$1,405/mo');
  });

  it('labels per-term halls as /sem', () => {
    const bouquet = makeDorm({ name: 'Bouquet Gardens', semesterRate: 5805, rent_period: 'semester', rentPeriod: 'semester' });
    expect(dormRateLine(bouquet)).toBe('$5,805/sem');
  });

  it('tolerates casing/whitespace in the raw rent_period column', () => {
    const messy = makeDorm({ semesterRate: 1405, rent_period: ' Month ' });
    expect(dormRateLine(messy)).toBe('$1,405/mo');
  });

  it('defaults to /sem when rent_period is missing', () => {
    const missing = makeDorm({ semesterRate: 5000, rent_period: undefined, rentPeriod: undefined });
    expect(dormRateLine(missing)).toBe('$5,000/sem');
  });
});
