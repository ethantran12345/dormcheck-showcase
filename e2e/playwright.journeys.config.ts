import { defineConfig, devices, type Project } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import base from '../playwright.config';

/**
 * Journey mode for `npm run audit:app` (AUDIT_JOURNEYS=1 makes
 * scripts/e2e/run-audit.sh pass `--config` here): the no-dead-end sweep from
 * docs/audits/feature-journey-inventory.md §4/§5. EXTENDS the base config (same
 * server, port, env, auth setup) and keeps its existing flow projects (api,
 * authflows, user: auth, marketplace lifecycle + security, messaging, checklist
 * regression) as evidence, then adds the journey specs at the primary phone
 * width and at desktop. The classic crawl projects (anon/admin crawl) are left
 * out; the crawl and layout modes own those.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = path.join(ROOT, '.audit-app/state');

const keep = (base.projects ?? []).filter((p) => ['setup', 'api', 'authflows', 'user'].includes(p.name ?? ''));

const journeys = (name: string, width: number, height: number, phone: boolean): Project => ({
  name,
  testMatch: /journeys\.[a-z]+\.spec\.ts/,
  dependencies: ['setup'],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width, height },
    isMobile: phone,
    hasTouch: phone,
    storageState: path.join(STATE_DIR, 'user.json'),
  },
});

export default defineConfig({
  ...base,
  testDir: path.join(ROOT, 'e2e'),
  outputDir: path.join(ROOT, 'test-results'),
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(ROOT, 'playwright-report'), open: 'never' }],
    // The flow specs don't write journey records; their pass/fail comes from here.
    ['json', { outputFile: path.join(ROOT, 'docs/audits/app-bug-audit-report/journeys/playwright.json') }],
  ],
  projects: [
    ...keep,
    journeys('journeys-390', 390, 844, true),
    journeys('journeys-1440', 1440, 900, false),
    // Phase 3 regression tests: one file per fix lane, each red before its fix.
    { ...journeys('regress-390', 390, 844, true), testMatch: /regressions\/.*\.spec\.ts/ },
    { ...journeys('regress-1440', 1440, 900, false), testMatch: /regressions\/.*\.spec\.ts/ },
  ],
  webServer: { ...(base.webServer as object), cwd: ROOT } as typeof base.webServer,
});
