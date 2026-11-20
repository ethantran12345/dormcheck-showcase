import { defineConfig, devices, type Project } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import base from '../playwright.config';
import type { LayoutMeta } from './crawl.layout.spec';

/**
 * Layout-mode projects for `npm run audit:app` (AUDIT_LAYOUT=1 makes
 * scripts/e2e/run-audit.sh pass `--config` here). It EXTENDS the base config:
 * same dev server, same port, same env, same auth setup. Only the projects
 * differ: one per viewport × theme pass, all running e2e/crawl.layout.spec.ts.
 *
 * Passes:
 *   user   390 / 360 / 1440 × light / dark            (6)
 *   anon   390 / 360 / 1440 light, 390 dark           (4) pre-auth pages are always
 *          light by design (src/lib/theme.ts isAlwaysLightPath), so a dark pass at
 *          every width would re-measure the same pixels.
 *   admin  390 light / 390 dark / 1440 light          (3) the gated full app
 *   user   360 light, zh                              (1) longest labels, smallest phone
 *
 * Axe runs on the dark passes and on 390 light: dark-mode contrast and the phone
 * layout are what the 1280 crawl never measured. The light 360/1440 passes skip
 * it to keep the run near an hour.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = path.join(ROOT, '.audit-app/state');

const VIEWPORTS = {
  '390': { width: 390, height: 844, phone: true },
  '360': { width: 360, height: 780, phone: true },
  '1440': { width: 1440, height: 900, phone: false },
} as const;
type Vp = keyof typeof VIEWPORTS;

function pass(
  persona: LayoutMeta['persona'],
  vp: Vp,
  theme: LayoutMeta['theme'],
  extra: { lang?: LayoutMeta['lang']; a11y?: boolean } = {},
): Project {
  const lang = extra.lang ?? 'en';
  const variant = [vp, theme, lang !== 'en' ? lang : ''].filter(Boolean).join('-');
  const v = VIEWPORTS[vp];
  const meta: LayoutMeta = {
    persona,
    variant,
    theme,
    lang,
    a11y: extra.a11y ?? (theme === 'dark' || vp === '390'),
  };
  return {
    name: `layout-${persona}-${variant}`,
    testMatch: /crawl\.layout\.spec\.ts/,
    // A broken detector skips every pass, so run-audit.sh reports "no records"
    // instead of a clean-looking zero.
    dependencies: persona === 'anon' ? ['layout-selftest'] : ['setup', 'layout-selftest'],
    metadata: meta,
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: v.width, height: v.height },
      isMobile: v.phone,
      hasTouch: v.phone,
      colorScheme: theme,
      locale: lang === 'zh' ? 'zh-CN' : 'en-US',
      // Settle framer-motion entrances instantly so a half-animated card is not
      // measured as clipped. The app honours prefers-reduced-motion.
      reducedMotion: 'reduce',
      ...(persona === 'anon' ? {} : { storageState: path.join(STATE_DIR, `${persona}.json`) }),
    },
  };
}

const setup = (base.projects ?? []).find((p) => p.name === 'setup')!;

/**
 * AUDIT_LAYOUT_MATRIX=weekly: the scheduled CI job (the `stack-checks` job of .github/workflows/weekly-sweep.yml,
 * 25-minute budget). The student surfaces at the primary phone width in both
 * themes plus desktop. Anything else (unset / "full") runs every pass below,
 * on demand.
 */
const WEEKLY = process.env.AUDIT_LAYOUT_MATRIX === 'weekly';
const FULL: Project[] = [
  pass('user', '390', 'light'),
  pass('user', '390', 'dark'),
  pass('user', '360', 'light'),
  pass('user', '360', 'dark'),
  pass('user', '1440', 'light'),
  pass('user', '1440', 'dark'),
  pass('anon', '390', 'light'),
  pass('anon', '390', 'dark'),
  pass('anon', '360', 'light'),
  pass('anon', '1440', 'light'),
  pass('admin', '390', 'light'),
  pass('admin', '390', 'dark'),
  pass('admin', '1440', 'light'),
  pass('user', '360', 'light', { lang: 'zh' }),
];
const WEEKLY_PASSES: Project[] = [pass('user', '390', 'light'), pass('user', '390', 'dark'), pass('user', '1440', 'light')];

export default defineConfig({
  ...base,
  testDir: path.join(ROOT, 'e2e'),
  outputDir: path.join(ROOT, 'test-results'),
  reporter: [['list'], ['html', { outputFolder: path.join(ROOT, 'playwright-report'), open: 'never' }]],
  projects: [
    setup,
    // Detector self-test: fails the run up front if a detector stops seeing defects.
    { name: 'layout-selftest', testMatch: /layout\.detector\.spec\.ts/ },
    ...(WEEKLY ? WEEKLY_PASSES : FULL),
  ],
  webServer: { ...(base.webServer as object), cwd: ROOT } as typeof base.webServer,
});
