import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/**
 * WCAG 2.1 AA axe scan for the audit crawl.
 *
 * Env gates:
 *  - A11Y=0        skip axe entirely (fast bug-audit-only path)
 *  - A11Y_STRICT=1 map critical/serious violations to P0 (hard fail) instead of P1
 */
export const a11yEnabled = () => process.env.A11Y !== '0';
export const a11yStrict = () => process.env.A11Y_STRICT === '1';

export interface AxeViolationRecord {
  ruleId: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor';
  help: string;
  helpUrl: string;
  wcagTags: string[];
  nodeCount: number;
  /** First few CSS selectors so the report can point at real elements. */
  sampleTargets: string[];
  /** Outer HTML snippets of the first offending nodes - pinpoints generic selectors. */
  sampleHtml: string[];
}

export async function runAxeScan(page: Page): Promise<AxeViolationRecord[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  return results.violations.map((v) => ({
    ruleId: v.id,
    impact: (v.impact ?? 'minor') as AxeViolationRecord['impact'],
    help: v.help,
    helpUrl: v.helpUrl,
    wcagTags: v.tags.filter((t) => /^wcag\d/.test(t)),
    nodeCount: v.nodes.length,
    sampleTargets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
    sampleHtml: v.nodes.slice(0, 2).map((n) => n.html.slice(0, 200)),
  }));
}
