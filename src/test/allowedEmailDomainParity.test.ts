import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { activeUniversities } from '@/config/universities';

// api/_lib/auth.ts is built as a separate Vercel bundle and cannot import from
// src/, so it hand-duplicates the emailDomains of every ACTIVE university in
// src/config/universities.ts (the source of truth). Nothing but this test keeps
// the two in agreement, and a drift here is exactly the 2026-07-10 prod
// incident: every university-domain check silently defaulted to Pitt and CMU
// sign-in was blocked outright. Parsed as text, not imported, so the test stays
// free of the handler's Supabase/@vercel/node side effects.
const AUTH_TS = join(__dirname, '../../api/_lib/auth.ts');

function allowedEmailDomainsFromApi(): string[] {
  const src = readFileSync(AUTH_TS, 'utf8');
  const match = /const ALLOWED_EMAIL_DOMAINS = \[([^\]]*)\]/.exec(src);
  if (!match) {
    throw new Error(
      `ALLOWED_EMAIL_DOMAINS array literal not found in ${AUTH_TS} - if it was ` +
        'renamed or reshaped, update this test rather than deleting it.',
    );
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('api/_lib/auth.ts ALLOWED_EMAIL_DOMAINS parity', () => {
  const apiDomains = allowedEmailDomainsFromApi();
  const configDomains = activeUniversities().flatMap((u) => u.emailDomains);

  it('parses a non-empty list out of the API bundle', () => {
    expect(apiDomains.length).toBeGreaterThan(0);
  });

  it('matches the active universities in src/config/universities.ts exactly', () => {
    expect(new Set(apiDomains)).toEqual(new Set(configDomains));
  });

  it('carries no duplicates and no stray casing/@ prefixes', () => {
    expect(apiDomains).toEqual([...new Set(apiDomains)]);
    for (const domain of apiDomains) {
      expect(domain).toBe(domain.trim().toLowerCase());
      expect(domain.startsWith('@')).toBe(false);
    }
  });
});
