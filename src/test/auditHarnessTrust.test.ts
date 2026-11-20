/**
 * Trustworthiness regression suite for the app-audit harness (queue item 8c).
 *
 * THE POINT OF THIS FILE: the audit harness is the instrument that turns "the app
 * feels janky" into a number you can diff between runs. An instrument that can
 * report a false green is worse than no instrument, because it is believed. Two
 * defects let it do exactly that, and both are replayed here rather than asserted.
 *
 * DEFECT 1 — silent stale-report fallback (higher severity).
 * `npm run audit:app` with :8123 occupied errored, CONTINUED, and rebuilt
 * docs/audits/app-bug-audit-report/index.md from the PREVIOUS run's records. In
 * 8b that handed back pre-fix numbers as post-fix numbers and was caught only by
 * operator suspicion. The bias was toward "we're done" — the dangerous direction.
 *
 * DEFECT 2 — wrong CLS offset attribution.
 * e2e/lib/cls.ts took `entry.sources[0]` and paired that ONE node's rects with the
 * WHOLE entry value, discarding every other source. Symptom: the identical score
 * 0.16986083984375 was reported as `dy -80` on some routes and `dy -32` on others,
 * decided purely by which source the browser listed first. The score was
 * trustworthy; the dx/dy column was not — and dx/dy is the entire investigative
 * signal. "0.1699" is inert; "main moved -80px" is what identified 8b as
 * shell-level and made the root cause fall out arithmetically.
 *
 * WHY THESE TESTS HAVE TEETH (the bar set by check-glyphs.mjs and
 * lanePorcelain.test.ts — each was checked by restoring the old behavior and
 * confirming the test goes red):
 *   · The CLS fixture is a SINGLE entry with TWO sources whose offsets differ
 *     (-80 vs -32) and whose value is the exact observed 0.16986083984375. Under
 *     `sources[0]` it yields one row reporting -80 and silently loses -32; the
 *     length assertion and the "both offsets present" assertion both fail.
 *   · The report tests drive the real scripts/e2e/build-report.mjs as a
 *     subprocess and assert on the FILE SYSTEM (no index.md written), not on a
 *     message. Restore the old unconditional build and the "writes nothing" case
 *     fails.
 *   · The port test occupies :8123 for real and runs the real run-audit.sh.
 *     Remove the preflight and the script proceeds past step 0, so the
 *     "refuses before touching anything" assertion fails.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { attributeEntries, describeSource, type RawShiftEntry } from '../../e2e/lib/cls';
import { stayedOnRequestedRoute } from '../../e2e/lib/audit';

const ROOT = process.cwd();
const HEAD = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();

// ---------------------------------------------------------------------------
// DEFECT 2 — CLS attribution
// ---------------------------------------------------------------------------

/**
 * The observed case, verbatim: one frame, one score, two nodes that moved by
 * different amounts. This is the shape `sources[0]` could not represent.
 */
const OBSERVED_VALUE = 0.16986083984375;
const multiSourceEntry: RawShiftEntry = {
  value: OBSERVED_VALUE,
  sources: [
    { node: 'main.flex-1', dx: 0, dy: -80 },
    { node: 'div.pt-\\[84px\\]', dx: 0, dy: -32 },
  ],
};

describe('route-surface attribution', () => {
  it('does not attribute a redirect destination settling to the requested route', () => {
    expect(stayedOnRequestedRoute('/auth', '/my-home')).toBe(false);
    expect(stayedOnRequestedRoute('/admin', '/my-home')).toBe(false);
  });

  it('keeps surface checks for the requested route and ignores only a trailing slash', () => {
    expect(stayedOnRequestedRoute('/my-home', '/my-home')).toBe(true);
    expect(stayedOnRequestedRoute('/my-home/', '/my-home')).toBe(true);
  });
});

describe('CLS attribution: one entry, many sources', () => {
  it('reports EVERY source of a multi-source entry, not just the first', () => {
    const out = attributeEntries([multiSourceEntry]);

    // Under the old `entry.sources?.[0]` this array had length 1 and the second
    // node — with its genuinely different -32px offset — did not exist anywhere
    // in the report. That is how the same score showed two different dy values
    // across routes: it was a coin flip over which source the browser listed first.
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.node)).toEqual(['main.flex-1', 'div.pt-\\[84px\\]']);
    expect(out.map((s) => s.dy)).toEqual([-80, -32]);
  });

  it('never pairs one source rect with a multi-source total unlabelled', () => {
    const out = attributeEntries([multiSourceEntry]);

    for (const s of out) {
      // The score is the FRAME's, and it says so in its own name plus the count
      // it is shared across. There is deliberately no field called `value` on a
      // ClsSource: the old name invited "this node contributed 0.1699", which is
      // the misread that made the offset column untrustworthy.
      expect(s.entryValue).toBe(OBSERVED_VALUE);
      expect(s.sourceCount).toBe(2);
      expect(s).not.toHaveProperty('value');
    }
    expect(out[0].sourceIndex).toBe(0);
    expect(out[1].sourceIndex).toBe(1);
  });

  it('says "shared" out loud in the human-readable form', () => {
    const [first] = attributeEntries([multiSourceEntry]);
    const text = describeSource(first);

    expect(text).toContain('main.flex-1');
    expect(text).toContain('entry 0.1699');
    expect(text).toContain('shared by 2 sources');
    expect(text).toContain('moved 0,-80px');
  });

  it('does not say "shared" when the entry really had one source', () => {
    const [only] = attributeEntries([{ value: 0.02, sources: [{ node: 'img', dx: 0, dy: 12 }] }]);

    expect(only.sourceCount).toBe(1);
    expect(describeSource(only)).not.toContain('shared');
  });

  it('orders by worst entry first, so the top rows are where to look', () => {
    const out = attributeEntries([
      { value: 0.01, sources: [{ node: 'small' }] },
      multiSourceEntry,
      { value: 0.05, sources: [{ node: 'medium' }] },
    ]);

    expect(out.map((s) => s.node)).toEqual(['main.flex-1', 'div.pt-\\[84px\\]', 'medium', 'small']);
  });

  it('still reports a score the browser attributed to nothing', () => {
    // An unattributed shift is the hardest kind to chase; dropping it because it
    // has no sources would hide the score entirely.
    const out = attributeEntries([{ value: 0.3, sources: [] }]);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ node: '(anonymous)', entryValue: 0.3, sourceCount: 0 });
  });

  it('honours the cap without losing the worst entry', () => {
    const many: RawShiftEntry[] = Array.from({ length: 20 }, (_, i) => ({
      value: i / 1000,
      sources: [{ node: `n${i}`, dy: i }],
    }));
    const out = attributeEntries([...many, multiSourceEntry], 3);

    expect(out).toHaveLength(3);
    expect(out[0].node).toBe('main.flex-1');
  });
});

// ---------------------------------------------------------------------------
// DEFECT 1a — build-report.mjs must refuse a record set that is not this commit's
// ---------------------------------------------------------------------------

const tmpDirs: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  for (const s of servers.splice(0)) await new Promise((r) => s.close(() => r(null)));
});

/** A minimally valid record, stamped with whatever provenance the test wants. */
function writeFixture(records: Array<Record<string, unknown>>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-audit-fixture-'));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, 'records'), { recursive: true });
  records.forEach((r, i) => {
    const record = {
      runSha: HEAD,
      runStartedAt: '2026-07-29T00:00:00Z',
      persona: 'user',
      routeId: `r${i}`,
      label: `Route ${i}`,
      path: `/r${i}`,
      finalUrl: `/r${i}`,
      expected: 'renders',
      outcome: 'renders',
      screenshot: `screens/r${i}.png`,
      findings: [],
      ignored: [],
      ...r,
    };
    fs.writeFileSync(path.join(dir, 'records', `user-r${i}.json`), JSON.stringify(record));
  });
  return dir;
}

function runBuildReport(reportDir: string) {
  const res = spawnSync('node', ['scripts/e2e/build-report.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, AUDIT_REPORT_DIR: reportDir },
  });
  return {
    status: res.status,
    stderr: res.stderr ?? '',
    wroteReport: fs.existsSync(path.join(reportDir, 'index.md')),
  };
}

describe('build-report.mjs refuses a record set that is not HEAD', () => {
  it('renders a record set stamped with the current commit', () => {
    // The control. Without this passing, every refusal below could be a refusal
    // for the wrong reason and the suite would prove nothing.
    const dir = writeFixture([{}, {}]);
    const res = runBuildReport(dir);

    expect(res.status).toBe(0);
    expect(res.wroteReport).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'index.md'), 'utf8')).toContain(HEAD);
  });

  it('refuses — and writes nothing — when a record carries a foreign SHA', () => {
    const dir = writeFixture([{}, { runSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }]);
    const res = runBuildReport(dir);

    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/REFUSING/);
    expect(res.stderr).toMatch(/different commits/);
    // The load-bearing assertion: no half-truth left on disk for someone to read
    // as current. A refusal that still wrote index.md would reproduce the defect.
    expect(res.wroteReport).toBe(false);
  });

  it('refuses when every record agrees but the commit is a stale one', () => {
    const stale = 'a'.repeat(40);
    const dir = writeFixture([{ runSha: stale }, { runSha: stale }]);
    const res = runBuildReport(dir);

    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/describe a different commit/);
    expect(res.wroteReport).toBe(false);
  });

  it('refuses an unstamped record rather than trusting it', () => {
    // Fails closed: a record from before this gate existed has unknown
    // provenance, and "unknown" must not read as "current".
    const dir = writeFixture([{}, { runSha: undefined }]);
    const res = runBuildReport(dir);

    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/no runSha/);
    expect(res.wroteReport).toBe(false);
  });

  it('refuses an empty record set — a crawl that never ran reports nothing', () => {
    const dir = writeFixture([]);
    const res = runBuildReport(dir);

    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/did not execute/);
    expect(res.wroteReport).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DEFECT 1b — run-audit.sh must refuse outright when its port is occupied
// ---------------------------------------------------------------------------

const AUDIT_PORT = 8123;

function occupy(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.once('listening', () => resolve(s));
    s.listen(port);
  });
}

describe('run-audit.sh refuses when :8123 is occupied', () => {
  it('exits non-zero and reaches no further than the port check', async () => {
    let held: Server;
    try {
      held = await occupy(AUDIT_PORT);
    } catch {
      // Something else already holds the port. That IS the condition under test,
      // but we cannot then guarantee we control it, so skip rather than report a
      // green we did not earn.
      return;
    }
    servers.push(held);

    const res = spawnSync('bash', ['scripts/e2e/run-audit.sh'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
    });

    expect(res.status).not.toBe(0);
    expect(`${res.stdout}${res.stderr}`).toMatch(/Port 8123 is already in use/);
    // It must bail BEFORE the expensive, side-effecting steps. `db reset` in
    // particular drops the local database; a refusal that got that far would be
    // destructive as well as useless.
    expect(res.stdout).not.toMatch(/Ensuring local Supabase stack/);
    expect(res.stdout).not.toMatch(/db reset/);
    // And it must not announce a report it did not produce.
    expect(res.stdout).not.toMatch(/^Report:/m);
  }, 90_000);

  it('the port preflight passes on a port nobody holds', async () => {
    // Guards against the preflight becoming a permanent refusal — a gate that
    // never lets a real audit run is its own kind of false signal.
    const probe = await occupy(0);
    const free = (probe.address() as { port: number }).port;
    await new Promise((r) => probe.close(() => r(null)));

    const res = spawnSync('node', ['scripts/e2e/require-free-port.mjs', String(free)], {
      cwd: ROOT,
      encoding: 'utf8',
    });

    expect(res.status).toBe(0);
  });

  it('the port preflight detects a holder on ::1 that 127.0.0.1 would miss', async () => {
    // The real-world cause: a vite orphaned by a closed lane binds ::1 only, so a
    // v4-only probe reports the port free and the crawl dies later with a
    // confusing error instead of this one.
    const probe = await occupy(0);
    const port = (probe.address() as { port: number }).port;
    await new Promise((r) => probe.close(() => r(null)));

    const v6 = createServer();
    const bound = await new Promise<boolean>((resolve) => {
      v6.once('error', () => resolve(false));
      v6.once('listening', () => resolve(true));
      v6.listen(port, '::1');
    });
    if (!bound) return; // no IPv6 on this machine; nothing to prove
    servers.push(v6);

    const res = spawnSync('node', ['scripts/e2e/require-free-port.mjs', String(port)], {
      cwd: ROOT,
      encoding: 'utf8',
    });

    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/already in use/);
  });
});
