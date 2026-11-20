import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditRoute, partitionFindings } from './lib/audit';
import { LAYOUT_ROUTES, type LayoutState, type Persona } from './lib/routes';

/**
 * Layout crawl: the same audit as crawl.{anon,user,admin}.spec.ts, run once per
 * viewport × theme (× locale) pass with the cut-off detectors on
 * (e2e/lib/layout.ts). Which pass this is comes from the project's metadata in
 * e2e/playwright.layout.config.ts; run it with `AUDIT_LAYOUT=1 npm run audit:app`.
 */

export interface LayoutMeta {
  persona: Persona;
  variant: string;
  theme: 'light' | 'dark';
  lang: 'en' | 'zh';
  a11y: boolean;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LONG = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/long-content.json'), 'utf8')) as {
  listingTitle: string;
};

const OPEN: Record<LayoutState, (page: Page) => Promise<void>> = {
  palette: async (page) => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 5_000 });
  },
  shortcuts: async (page) => {
    await page.locator('body').click({ position: { x: 2, y: 2 } }).catch(() => {});
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 5_000 });
  },
  'listing-detail': async (page) => {
    await page.getByText(LONG.listingTitle.slice(0, 40)).first().click();
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);
  },
};

test.describe('layout crawl', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const meta = testInfo.project.metadata as LayoutMeta;
    await page.addInitScript(
      ({ theme, lang }) => {
        try {
          localStorage.setItem('dormcheck-theme', theme);
          localStorage.setItem('dc_lang', lang);
        } catch {
          /* storage blocked: the colorScheme / locale emulation still applies */
        }
      },
      { theme: meta.theme, lang: meta.lang },
    );
  });

  for (const route of LAYOUT_ROUTES) {
    test(`${route.label} (${route.path})`, async ({ page }, testInfo) => {
      const meta = testInfo.project.metadata as LayoutMeta;
      const width = page.viewportSize()?.width ?? 0;
      test.skip(!!route.desktopOnly && width < 1024, 'desktop-pointer-only state');
      test.skip(!!route.state && meta.persona === 'anon', 'open states need a signed-in persona');
      const findings = await auditRoute(page, testInfo, meta.persona, route, {
        variant: meta.variant,
        layout: true,
        a11y: meta.a11y,
        afterLoad: route.state ? OPEN[route.state] : undefined,
      });
      // Fail on P0/P1 only. P2 (cosmetic truncation, mild CLS, moderate axe) is
      // recorded in the report and tracked on the P2 list, so the scheduled job
      // goes red on a regression, not on accepted debt.
      const { hard, soft } = partitionFindings(findings);
      expect(hard, hard.map((f) => `[${f.severity}] ${f.kind}: ${f.detail}`).join('\n')).toEqual([]);
      const p1 = soft.filter((f) => f.severity === 'P1');
      expect.soft(p1, p1.map((f) => `[P1] ${f.kind}: ${f.detail}`).join('\n')).toEqual([]);
    });
  }
});
