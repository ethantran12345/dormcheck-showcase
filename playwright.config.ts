import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Playwright config for the automated app bug-audit (Phase 1 of docs/app-bug-audit.md).
 *
 * Runs the Vite dev server on a DEDICATED port (8123, not the usual 8080) with the
 * LOCAL Supabase test stack injected via .env.e2e. The dedicated port guarantees we
 * never accidentally reuse a `npm run dev` server that points at the prod project.
 *
 * Personas (Playwright projects):
 *   setup - logs in the seeded user + admin, saves storageState
 *   anon - no session: asserts public routes load, protected routes redirect, gated → ComingSoon
 *   user - Phase-1 student session: crawls Phase-1 surface + runs write flows
 *   admin - admin + full-app-preview: crawls the un-gated full app
 */
loadEnv({ path: path.resolve(__dirname, '.env.e2e') });

// 8123 by default, overridable with AUDIT_PORT. The dedicated port is the
// safety property (never reuse a `npm run dev` that points at prod); 8123
// specifically is not. Several lanes can be live at once in this repo and each
// may want its own crawl or `lane:verify`, and a single hard-coded port makes
// them serialise on whichever one got there first — `run-audit.sh` refuses
// outright when :8123 is busy, which is correct but meant the second lane
// simply could not run. run-audit.sh exports the same variable, so the script,
// the dev server and BASE_URL cannot drift apart.
const PORT = Number(process.env.AUDIT_PORT ?? 8123);
const BASE_URL = `http://localhost:${PORT}`;
const STATE_DIR = path.resolve(__dirname, '.audit-app/state');

// Pass the test Supabase config through to the dev-server process. Vite exposes
// process.env.VITE_* on import.meta.env, and shell env wins over .env/.env.local,
// so this overrides the committed prod-pointing env for the audit run only.
const webServerEnv = {
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? '',
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? '',
  VITE_MAPBOX_TOKEN: process.env.VITE_MAPBOX_TOKEN ?? 'pk.e2e.dummy',
  VITE_SITE_URL: BASE_URL,
  // The audit drives its own logins (auth.setup.ts) and asserts logged-out
  // behavior in the anon crawl; the Simulator-only autologin must stay off
  // even though dotenv loads .env.e2e (which enables it) into process.env.
  VITE_E2E_AUTOLOGIN: '0',
  // Disable Cloudflare Turnstile for the crawl. The sign-in button gates on
  // `turnstile.ready` at the password step, and a real (domain-bound) sitekey
  // from .env/.env.local can never issue a token in this headless, localhost
  // browser, so the button stays disabled forever and every authenticated test
  // fails at auth.setup.ts. Empty string → getTurnstileSiteKey() returns
  // undefined → isTurnstileConfigured() false → `ready` is always true, i.e.
  // the app's own keyless-dev bypass (src/lib/turnstile.ts). Shell env wins over
  // .env/.env.local, same override mechanism as the Supabase vars above.
  VITE_TURNSTILE_SITE_KEY: '',
  // The dev-only Tweaks trigger floats bottom-right at z-[60] and swallows
  // clicks meant for the message Send / composer Post buttons under it. No
  // e2e run wants the panel; see the TweaksPanel gate in src/App.tsx.
  VITE_DISABLE_TWEAKS: '1',
};

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      // Server-refusal + behavior suites: direct Supabase clients, no browser.
      // They own their fixtures (e2e/lib/api.ts ensureUser) so they need no
      // storageState and no setup dependency.
      name: 'api',
      testMatch: /(marketplace\.security|rankings\.behavior)\.spec\.ts/,
    },
    {
      name: 'anon',
      testMatch: /crawl\.anon\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Auth journeys drive the real /auth UI from a signed-out context, so no
      // storageState; each test gets a fresh browser context by default.
      name: 'authflows',
      testMatch: /auth\.flows\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'user',
      // Anchored so `flows` can't also swallow auth.flows.spec.ts (which must
      // run signed-out under the authflows project).
      testMatch: /e2e\/(crawl\.user|flows|regression\.checklist|marketplace\.lifecycle|messaging)\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: path.join(STATE_DIR, 'user.json') },
    },
    {
      name: 'admin',
      testMatch: /crawl\.admin\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: path.join(STATE_DIR, 'admin.json') },
    },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: webServerEnv,
  },
});
