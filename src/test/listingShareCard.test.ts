import { describe, expect, it } from 'vitest';
import { buildListingShareCaption } from '@/lib/listingShareCard';

describe('listing share card', () => {
  it('builds a concise caption with the canonical deep link', () => {
    expect(
      buildListingShareCaption({
        title: 'Mini fridge',
        price: '$35',
        url: 'https://dormcheck.com/marketplace?listing=listing-1',
      }),
    ).toBe(
      'Mini fridge · $35\nStudent Market on Dormcheck\nhttps://dormcheck.com/marketplace?listing=listing-1',
    );
  });
});
