/**
 * Self-test for the layout detectors (e2e/lib/layout.ts): one synthetic page with
 * exactly one planted instance of each defect. Runs first in the layout config so
 * a detector that silently finds nothing fails loudly instead of reporting a
 * clean app. No server, no stack.
 */
import { test, expect } from '@playwright/test';
import { detectLayoutIssues } from './lib/layout';
const HTML = `<!doctype html><html><head><meta name=viewport content="width=device-width"><style>body{margin:0;font:16px sans-serif}</style></head><body>
<div style="width:500px">wide row that overflows</div>
<div style="width:200px;overflow:hidden"><button style="margin-left:150px;width:100px">half clipped</button></div>
<p style="width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">A very long building name that gets cut</p>
<a href="/x"><span style="display:block;width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Linked long title is fine fine fine</span></a>
<div style="width:300px;overflow:hidden;cursor:grab"><div style="display:flex;width:900px"><button style="width:280px">slide one</button><button style="width:280px">slide two in a swipe carousel</button></div></div>
<div style="height:120px;margin-left:120px;overflow-x:hidden;overflow-y:auto"><div style="height:100px"></div><button style="height:40px">reachable by vertical scroll</button><div style="height:200px"></div></div>
<div style="height:1200px"></div>
<div style="display:flex;align-items:flex-end"><p style="margin:0 0 0 100px;width:90px">beside the pill</p><button style="margin-left:30px">last button</button></div>
<div style="position:fixed;bottom:0;left:0;right:0;height:64px;pointer-events:none"><nav style="pointer-events:auto;margin-left:200px;width:180px;height:64px;background:#eee">nav</nav></div>
<div role="dialog" style="position:fixed;top:40px;left:0;width:100px;height:1000px;background:#fff">tall sheet <button style="margin-top:880px">ok</button></div>
<div role="dialog" aria-label="padded sheet" style="position:fixed;top:12px;left:0;width:100px;height:844px;padding-bottom:30px;box-sizing:border-box;display:flex;flex-direction:column;background:#fff"><div style="flex:1;min-height:0;overflow-y:auto"><p style="height:900px;margin:0">long form</p></div><span>footer</span></div>
</body></html>`;
test('detector finds each kind', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(HTML);
  const issues = await detectLayoutIssues(page);
  
  const kinds = new Set(issues.map((i) => i.kind));
  for (const k of ['overflow-x', 'clipped', 'sheet-overflow', 'nav-occlusion', 'truncation']) expect(kinds, k).toContain(k);
  expect(issues.filter((i) => i.kind === 'truncation')).toHaveLength(1);
  // Negatives: swipe-carousel slides and text beside a nav pill are not defects.
  expect(issues.map((i) => i.detail).join('\n')).not.toMatch(/swipe carousel|slide one|beside the pill|reachable by vertical scroll/);
  expect(issues.find((i) => i.kind === 'nav-occlusion')?.detail).toMatch(/last button/);
  // Sheet overflow severity follows reachability (Ethan, 2026-10-11).
  const sheets = issues.filter((i) => i.kind === 'sheet-overflow');
  expect(sheets.find((i) => /tall sheet/.test(i.detail))?.severity).toBe('P1');
  expect(sheets.find((i) => /padded sheet/.test(i.detail))?.severity).toBe('P2');
});
