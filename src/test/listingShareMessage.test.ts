import { describe, expect, it } from 'vitest';
import { buildListingShareContent, parseMessageContext } from '@/lib/messageContext';

const ID = '3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607';

describe('buildListingShareContent', () => {
  it('round-trips through parseMessageContext as a listing marker', () => {
    const parsed = parseMessageContext(buildListingShareContent(ID, 'Sharing my listing: Mini fridge'));
    expect(parsed.marker).toEqual({ type: 'listing', id: ID });
  });

  it('keeps the intro as the only text, so the card is not duplicated', () => {
    const parsed = parseMessageContext(buildListingShareContent(ID, 'Sharing my listing: Mini fridge'));
    expect(parsed.introText).toBe('Sharing my listing: Mini fridge');
    expect(parsed.introText).not.toContain('Dormcheck:listing');
    expect(parsed.introText).not.toMatch(/\$\d/);
  });

  it('never emits a bare marker with leading whitespace as intro', () => {
    const parsed = parseMessageContext(buildListingShareContent(ID, '   '));
    expect(parsed.introText).toBe('');
  });
});
