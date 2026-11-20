import { test } from '@playwright/test';
import { ROUTES } from './lib/routes';
import { auditRoute, assertNoFindings } from './lib/audit';

// Unauthenticated crawl: public routes render, protected routes redirect to /auth,
// gated routes show ComingSoon. No session loaded for this project.
test.describe('anon crawl', () => {
  for (const route of ROUTES) {
    test(`${route.label} (${route.path})`, async ({ page }, testInfo) => {
      const findings = await auditRoute(page, testInfo, 'anon', route);
      assertNoFindings(findings);
    });
  }
});
