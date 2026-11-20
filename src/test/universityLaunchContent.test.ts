import { describe, expect, it } from 'vitest';
import { activeUniversities, resolveUniversityByEmail } from '@/config/universities';
import { getMoveInContent, hasMoveInContent } from '@/data/moveInSteps';
import { getMoveInJourney } from '@/data/moveInJourney';
import { getMoveOutTiers, hasMoveOutContent } from '@/data/moveOut';

describe('CMU and Carlow launch content', () => {
  it('activates all three configured tenants and resolves Carlow student mail', () => {
    expect(activeUniversities().map((university) => university.slug)).toEqual([
      'pitt',
      'cmu',
      'carlow',
    ]);
    expect(resolveUniversityByEmail('student@live.carlow.edu')?.slug).toBe('carlow');
  });

  it.each(['cmu', 'carlow'])('%s has move-in, journey, and move-out content', (slug) => {
    expect(hasMoveInContent(slug)).toBe(true);
    expect(getMoveInContent(slug).defaultPlan.length).toBeGreaterThan(0);
    expect(getMoveInContent(slug).campusReadySteps.length).toBeGreaterThan(0);
    expect(getMoveInJourney(slug).welcomeWeekDays.length).toBeGreaterThan(0);
    expect(hasMoveOutContent(slug)).toBe(true);
    expect(getMoveOutTiers(slug).length).toBeGreaterThan(0);
  });

  it('never falls back to Pitt-branded launch content for CMU or Carlow', () => {
    for (const slug of ['cmu', 'carlow']) {
      const serialized = JSON.stringify({
        moveIn: getMoveInContent(slug),
        journey: getMoveInJourney(slug),
        moveOut: getMoveOutTiers(slug),
      }).toLowerCase();

      expect(serialized).not.toContain('panther');
      expect(serialized).not.toContain('litchfield');
      expect(serialized).not.toContain('ship2pitt');
    }
  });
});
