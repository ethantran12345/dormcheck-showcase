import { test } from '@playwright/test';
import { ROUTES } from './lib/routes';
import { auditRoute, assertNoFindings } from './lib/audit';

// Phase-1 student session: protected routes render; gated routes still ComingSoon
// (no admin preview). This is the surface a real student sees today.
test.describe('user crawl', () => {
  for (const route of ROUTES) {
    test(`${route.label} (${route.path})`, async ({ page }, testInfo) => {
      const findings = await auditRoute(page, testInfo, 'user', route);
      assertNoFindings(findings);
    });
  }
});
