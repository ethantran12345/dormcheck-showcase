import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectLayoutIssues } from '../lib/layout';

/**
 * Regression (layout P1s from the 2026-10-11 layout crawl): each case reopens the
 * exact state the crawl flagged and runs the same shared detector, so "fixed"
 * means the detector no longer sees it, not that a hand-picked rect looks fine.
 * Long-content fixture: e2e/fixtures/long-content.json (AUDIT_LONG_CONTENT=1 seed).
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LONG = JSON.parse(fs.readFileSync(path.join(HERE, '../fixtures/long-content.json'), 'utf8'));
const width = (p: Page) => p.viewportSize()?.width ?? 0;

async function issues(page: Page, kind: string, match: RegExp) {
  await page.waitForTimeout(800);
  return (await detectLayoutIssues(page)).filter((i) => i.kind === kind && match.test(i.detail)).map((i) => i.detail);
}

test.describe('phone', () => {
  test.use({ viewport: { width: 360, height: 780 } });
  test.skip(({ isMobile }) => !isMobile, 'phone cases run in the regress-390 project only');

  test('(a) listing detail: Save / Share / More are fully reachable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/marketplace');
    await page.getByText(LONG.listingTitle.slice(0, 40)).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await issues(page, 'clipped', /aria-label="(Save|Share|More options)"/)).toEqual([]);
  });

  test('(b) onboarding: Continue is fully visible at 360', async ({ page }) => {
    await page.goto('/onboarding/intro');
    await page.getByTestId('onboarding-continue-button').waitFor();
    expect(await issues(page, 'clipped', /onboarding-continue-button/)).toEqual([]);
  });

  test('(c) logistics: the Ship2Pitt button is fully visible at 360', async ({ page }) => {
    await page.goto('/logistics');
    await page.getByRole('button', { name: /Ship2Pitt/ }).first().waitFor();
    expect(await issues(page, 'clipped', /Ship2Pitt/)).toEqual([]);
  });

  test('(e) /checklist?add=1: suggestion labels are not cut', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/checklist?add=1');
    await page.getByRole('textbox', { name: 'Add an item…' }).waitFor();
    expect(await issues(page, 'truncation', /.*/)).toEqual([]);
  });
});

test('(d) dorm detail at 1440: "Save this hall" is not under the top-right account cluster', async ({ page }) => {
  test.skip(width(page) < 1024, 'desktop-only overlap');
  await page.goto('/campus/layout-fixture-residence-hall-north-wing');
  await page.getByRole('button', { name: 'Save this hall' }).first().waitFor();
  expect(await issues(page, 'clipped', /Save this hall/)).toEqual([]);
});
