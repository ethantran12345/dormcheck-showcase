import { test } from '@playwright/test';
import { ROUTES } from './lib/routes';
import { auditRoute, assertNoFindings } from './lib/audit';

// Admin + full-app-preview: the gated full app un-gates (housing, map, roommates,
// rankings, gallery). This crawls the surface only admins see today.
test.describe('admin crawl', () => {
  for (const route of ROUTES) {
    test(`${route.label} (${route.path})`, async ({ page }, testInfo) => {
      const findings = await auditRoute(page, testInfo, 'admin', route);
      assertNoFindings(findings);
    });
  }
});
