import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { DormCard } from '@/components/DormCard';
import type { Dorm } from '@/types';
import { withCarlowHousingFallback } from '@/hooks/useDorms';
import { CARLOW_UNIVERSITY_ID } from '@/config/universities';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const dormWithoutPublishedRate = {
  id: 'carlow-dougherty',
  name: 'Dougherty Hall',
  image: '/placeholder.svg',
  badges: ['available'],
  semesterRate: 0,
  minRate: 0,
  rentPeriod: null,
  laundryPrice: 'Free',
  mealPlanRequired: true,
  acType: 'Window Unit',
  description: 'On-campus housing.',
  audienceType: 'Freshman',
} satisfies Dorm;

describe('DormCard missing-rate accuracy', () => {
  it('does not turn an unpublished official rate into a $0 price', () => {
    render(
      <MemoryRouter>
        <DormCard dorm={dormWithoutPublishedRate} onClick={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Rate not published')).toBeInTheDocument();
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
    expect(screen.queryByText('housing:card.perSemester')).not.toBeInTheDocument();
  });

  it('fills only missing official Carlow housing fields for the live demo', () => {
    const enriched = withCarlowHousingFallback({
      university_id: CARLOW_UNIVERSITY_ID,
      residence_hall: 'Dougherty Hall',
      image_url: null,
      accomodation: null,
      details: null,
      inroom_amenities: null,
      building_amenities: null,
      laundry: null,
      heat_and_air_conditioning: null,
      wifi_and_cable: null,
    } as never);

    expect(enriched.image_url).toContain('carlow.edu');
    expect(enriched.details).toContain('12 by 16 feet');
    expect(enriched.laundry).toContain('Free washers and dryers');
  });

  it('does not overwrite database-backed Carlow facts', () => {
    const enriched = withCarlowHousingFallback({
      university_id: CARLOW_UNIVERSITY_ID,
      residence_hall: 'Frances Warde Hall',
      image_url: 'https://example.edu/current.jpg',
      details: 'Current database description',
    } as never);

    expect(enriched.image_url).toBe('https://example.edu/current.jpg');
    expect(enriched.details).toBe('Current database description');
  });
});
