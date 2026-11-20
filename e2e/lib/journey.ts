import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { REPORT_DIR, RUN_SHA, RUN_STARTED_AT } from './audit';

/**
 * Journey recorder for the no-dead-end sweep (docs/audits/feature-journey-inventory.md
 * §4 contract, §5 P0 plan). A journey is a list of checks, each tagged with the
 * contract point it proves, asserted on TERMINAL STATE (a row exists, a URL
 * changed, a dialog is open, the value survives a reload), never on a screenshot.
 *
 * A check that throws is recorded as `fail` with the first line of the error and
 * the journey keeps going; checks that declare `needs` on a failed check are
 * recorded as `blocked`, so one broken first step reads as one defect, not five.
 * Records land next to the crawl's, in docs/audits/app-bug-audit-report/journeys/.
 */

export type ContractPoint =
  | 'entry' // 1. the CTA / deep link reaches the surface
  | 'progress' // 3. loading/sending state, no duplicate submit
  | 'result' // 4a. visible success
  | 'readback' // 4b. survives a reload
  | 'next' // 5. offers a next action / useful state
  | 'empty' // 6. empty state explains + offers a step
  | 'errors' // 7. distinct, recoverable failure states (incl. offline / retry)
  | 'cancel' // 8. close/back is safe
  | 'a11y' // 10. focus / keyboard
  | 'responsive' // 11. phone + desktop
  | 'trust'; // 12. tenant / permission

export interface JourneyCheck {
  point: ContractPoint;
  name: string;
  status: 'pass' | 'fail' | 'blocked';
  detail?: string;
  screenshot?: string;
}

const DIR = path.join(REPORT_DIR, 'journeys');
fs.mkdirSync(DIR, { recursive: true });

export class Journey {
  readonly checks: JourneyCheck[] = [];
  constructor(
    readonly id: string,
    readonly label: string,
    readonly area: string,
    readonly priority: 'P0' | 'P1' = 'P0',
    /** When given, every failed check saves a viewport screenshot as evidence. */
    readonly page?: Page,
  ) {}

  async check(point: ContractPoint, name: string, fn: () => Promise<void>, opts: { needs?: string[] } = {}) {
    const blockedBy = (opts.needs ?? []).filter((n) => this.checks.find((c) => c.name === n)?.status !== 'pass');
    if (blockedBy.length) {
      this.checks.push({ point, name, status: 'blocked', detail: `blocked by: ${blockedBy.join(', ')}` });
      return false;
    }
    try {
      await fn();
      this.checks.push({ point, name, status: 'pass' });
      return true;
    } catch (e) {
      const msg = (e as Error).message.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '').split('\n').filter(Boolean).slice(0, 3).join(' ');
      let shot: string | undefined;
      if (this.page && !this.page.isClosed()) {
        shot = `${this.id}@${test.info().project.name}-${this.checks.length}.png`;
        await this.page.screenshot({ path: path.join(DIR, shot) }).catch(() => (shot = undefined));
      }
      this.checks.push({ point, name, status: 'fail', detail: msg.slice(0, 400), ...(shot ? { screenshot: `journeys/${shot}` } : {}) });
      return false;
    }
  }

  /** Record a known gap without running anything (e.g. needs a device). */
  notVerified(point: ContractPoint, name: string, why: string) {
    this.checks.push({ point, name, status: 'blocked', detail: `not verified: ${why}` });
  }

  save() {
    // Project name (journeys-390 / journeys-1440) keeps the phone and desktop
    // runs of one journey from overwriting each other.
    const project = test.info().project.name;
    fs.writeFileSync(
      path.join(DIR, `${this.id}@${project}.json`),
      JSON.stringify(
        { runSha: RUN_SHA, runStartedAt: RUN_STARTED_AT, project, id: this.id, label: this.label, area: this.area, priority: this.priority, checks: this.checks },
        null,
        2,
      ),
    );
  }

  /** Persist, then fail the test (softly) if any check failed. */
  finish() {
    this.save();
    const failed = this.checks.filter((c) => c.status === 'fail');
    expect.soft(failed, failed.map((c) => `[${c.point}] ${c.name}: ${c.detail}`).join('\n')).toEqual([]);
  }
}

/** Visible text somewhere in the app's main surface (not the hidden sr-only copy). */
export async function expectVisibleText(page: Page, text: string | RegExp, timeout = 10_000) {
  await expect(page.getByText(text).filter({ visible: true }).first()).toBeVisible({ timeout });
}

/** The app is not sitting on a blank root or an unresolved spinner. */
export async function expectSettled(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const root = document.getElementById('root');
          const text = (root?.innerText ?? '').trim();
          // A determinate progressbar (aria-valuenow) is content, e.g. "7% ready".
          const busy = document.querySelectorAll('[aria-busy="true"],[role="progressbar"]:not([aria-valuenow]),.animate-spin').length;
          return text.length > 20 && busy === 0;
        }),
      { timeout: 15_000, message: 'page never settled (blank, or a spinner that never resolved)' },
    )
    .toBe(true);
}
