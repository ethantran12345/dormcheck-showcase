import { describe, expect, it } from 'vitest';
import { getMarketplaceSellerDisplayName } from '@/lib/marketplaceSellerDisplay';
import { STUDENT_DISPLAY_FALLBACK, studentDisplayName } from '@/lib/studentDisplayName';

describe('studentDisplayName', () => {
  it('names no university, so it stays true for every tenant', () => {
    // The regression this file exists for: the fallback was 'Pitt student' on
    // four surfaces CMU students use daily (DM list, DM unread notification,
    // marketplace seller line, seller ratings).
    expect(STUDENT_DISPLAY_FALLBACK).not.toMatch(/pitt|cmu|carnegie|panther/i);
  });

  it('prefers the first non-empty name and trims it', () => {
    expect(studentDisplayName('  Ada Lovelace  ')).toBe('Ada Lovelace');
    expect(studentDisplayName(null, '', '   ', 'Grace Hopper')).toBe('Grace Hopper');
  });

  it('falls back when every candidate is missing or blank', () => {
    expect(studentDisplayName()).toBe(STUDENT_DISPLAY_FALLBACK);
    expect(studentDisplayName(null, undefined, '   ')).toBe(STUDENT_DISPLAY_FALLBACK);
  });
});

describe('getMarketplaceSellerDisplayName', () => {
  it('uses the seller full_name when present', () => {
    expect(getMarketplaceSellerDisplayName({ full_name: ' Ada ', email: 'a@pitt.edu' })).toBe('Ada');
  });

  it('falls back neutrally for a null profile or an unnamed seller', () => {
    expect(getMarketplaceSellerDisplayName(null)).toBe(STUDENT_DISPLAY_FALLBACK);
    expect(getMarketplaceSellerDisplayName({ full_name: null, email: null })).toBe(
      STUDENT_DISPLAY_FALLBACK,
    );
  });
});
