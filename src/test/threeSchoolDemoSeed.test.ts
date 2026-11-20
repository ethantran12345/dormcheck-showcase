import { describe, expect, it } from 'vitest';
import { DEMO_SCHOOLS, assertLocalUrl, demoEmail, fixtureIds } from '../../scripts/e2e/seed-three-school-demo.mjs';

describe('three-school local demo harness', () => {
  it('refuses every non-local Supabase target', () => {
    expect(() => assertLocalUrl('https://abcdefghijklmnopqrst.supabase.co')).toThrow(/not localhost/);
    expect(() => assertLocalUrl('')).toThrow(/not localhost/);
    expect(() => assertLocalUrl('https://localhost.evil.example')).toThrow(/not localhost/);
    expect(() => assertLocalUrl('http://127.0.0.1:54321')).not.toThrow();
  });

  it('covers Pitt, CMU, and Carlow with visibly labelled demo identities', () => {
    expect(DEMO_SCHOOLS.map((school) => school.slug)).toEqual(['pitt', 'cmu', 'carlow']);
    for (const school of DEMO_SCHOOLS) {
      expect(demoEmail(school, 'viewer')).toContain(`local-demo+${school.slug}-viewer@`);
    }
  });

  it('uses unique deterministic ids for safe reseeding and cleanup', () => {
    const ids = [...fixtureIds.item, ...fixtureIds.sublease, ...fixtureIds.roommatePost, ...fixtureIds.setup.map(String)];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
