import { describe, it, expect } from 'vitest';
import {
  SHOW_STUDENT_BUSINESSES,
  LIMITED_SURFACES,
  SHOW_HOUSING,
  SHOW_ROOMMATES,
  SHOW_CONFIRMED_ROOMMATES,
  SHOW_BUILDING_CHATS,
} from '@/lib/featureFlags';

describe('featureFlags', () => {
  describe('SHOW_STUDENT_BUSINESSES', () => {
    it('is currently false', () => {
      expect(SHOW_STUDENT_BUSINESSES).toBe(false);
    });
  });

  describe('LIMITED_SURFACES', () => {
    it('is currently true (reduced surface set active)', () => {
      expect(LIMITED_SURFACES).toBe(true);
    });
  });

  describe('derived flags depend on LIMITED_SURFACES', () => {
    it('SHOW_HOUSING is derived from !LIMITED_SURFACES', () => {
      // When LIMITED_SURFACES is true, SHOW_HOUSING should be false.
      // Note: housing is restored per-tenant via `features: { showHousing: true }`
      // (src/config/universities.ts), not by flipping this global constant.
      expect(SHOW_HOUSING).toBe(!LIMITED_SURFACES);
      expect(SHOW_HOUSING).toBe(false);
    });

    it('SHOW_ROOMMATES is derived from !LIMITED_SURFACES', () => {
      // Roommate browsing stays outside the reduced surface set.
      expect(SHOW_ROOMMATES).toBe(!LIMITED_SURFACES);
      expect(SHOW_ROOMMATES).toBe(false);
    });
  });

  describe('SHOW_CONFIRMED_ROOMMATES', () => {
    it('is currently true (inside the always-on surface set)', () => {
      // Confirmed roommate groups (invite/accept + checklist integration) are on.
      expect(SHOW_CONFIRMED_ROOMMATES).toBe(true);
    });

    it('is independent of LIMITED_SURFACES', () => {
      // Even when LIMITED_SURFACES is true, SHOW_CONFIRMED_ROOMMATES is true.
      expect(SHOW_CONFIRMED_ROOMMATES).toBe(true);
    });
  });

  describe('SHOW_BUILDING_CHATS', () => {
    it('is currently true (inside the always-on surface set)', () => {
      expect(SHOW_BUILDING_CHATS).toBe(true);
    });

    it('is independent of LIMITED_SURFACES', () => {
      expect(SHOW_BUILDING_CHATS).toBe(true);
    });
  });

  describe('surface gate summary', () => {
    it('documents the current surface set', () => {
      // When LIMITED_SURFACES is true:
      // - The always-on surfaces (checklist, marketplace, messages) are visible
      // - The engagement surfaces (roommate browsing, map, rankings, saved dorms)
      //   are hidden, because they need a userbase that does not exist yet
      // - Confirmed roommates (invite/accept) and building chats stay visible

      if (LIMITED_SURFACES) {
        expect(SHOW_HOUSING).toBe(false);
        expect(SHOW_ROOMMATES).toBe(false);
        expect(SHOW_CONFIRMED_ROOMMATES).toBe(true);
        expect(SHOW_BUILDING_CHATS).toBe(true);
      } else {
        expect(SHOW_HOUSING).toBe(true);
        expect(SHOW_ROOMMATES).toBe(true);
        expect(SHOW_CONFIRMED_ROOMMATES).toBe(true);
        expect(SHOW_BUILDING_CHATS).toBe(true);
      }
    });
  });
});
