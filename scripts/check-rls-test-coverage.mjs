#!/usr/bin/env node
// RLS-migration test-coverage gate (2026-08-02; definition of "covered" hardened 2026-08-16).
//
// Rule: a migration that touches row-level security (CREATE/ALTER/DROP POLICY,
// or ENABLE/DISABLE/FORCE ROW LEVEL SECURITY) must be pinned by a DB probe in
// supabase/tests/ that
//   (a) DECLARES the migration in a machine-readable header line —
//         -- covers: 20260925000000_setup_photos_owner_select_for_cleanup.sql
//   (b) is wired as a `probe` line in scripts/test-db.sh, and
//   (c) actually names at least one relation the migration's RLS DDL touches.
// A declared threshold not wired to an exit code is a statistic, not a
// threshold — this script exits 1, and it runs in `lane:ship`, `ci-dev-push.yml`
// and `migration-guard.yml`.
//
// WHY (a) REPLACED "the file mentions the version somewhere" (2026-08-16 audit):
// the old test was `t.body.includes(version)`, a substring match against the whole
// file. Any mention counted — a prose aside, a "see also", a header sentence in a
// probe about a different table. It could not distinguish a probe that pins a policy
// from a probe that merely knows the policy's name, and the 2026-08-16 classification
// of the 62 grandfathered entries measured exactly that gap: of the two entries the
// substring rule would have admitted, mutation testing showed one had a genuinely
// load-bearing probe and several of its sibling policies did not. The fix is not an
// exemption list — it is a coverage claim an author has to make deliberately, on
// subject, in a file the runner actually executes.
//
// WHAT THIS GATE STILL CANNOT DO — say it plainly rather than imply otherwise.
// It proves a probe EXISTS, is DECLARED against the migration, RUNS, and is ON SUBJECT.
// It cannot prove the probe ASSERTS anything, and it cannot prove an assertion is
// two-directional. "The owner can read their own row" passes unchanged against a policy
// that shows every student every other student's rows; only mutation proves otherwise.
// That proof is a human step, recorded in the probe header and the changelog
// (see supabase/tests/setup_photos_owner_select.test.sql for the reference shape).
//
// Deliberately narrow, so it never needs routine bypass (a guard a legitimate
// workflow cannot satisfy is a guard bug — 2026-08-02 decision):
//  - Only migrations containing actual RLS DDL are in scope; SQL comments are
//    stripped first, so prose like "Rollback: DROP POLICY …" cannot trip it.
//    (The `-- covers:` scan runs on the RAW probe text, since a declaration IS a comment.)
//  - Migrations that predate the gate are frozen in
//    scripts/rls-coverage-baseline.json (grandfathered debt — shrink it, never
//    grow it; adding a NEW migration to the baseline defeats the gate and will
//    be treated as such in review). The classification of every entry, and the
//    mutation evidence behind it, is docs/security/rls-grandfathered-audit.md.
//  - There is no env-var bypass. The legitimate path is always available:
//    write the probe, declare it with `-- covers:`, wire it.
//
// The baseline itself is checked, not trusted: an entry that no longer exists, no
// longer touches RLS, or has since earned a declared+wired probe is a FAILURE, because
// each of those is debt that has been paid and left on the books. The list can only shrink.
//
// Usage: node scripts/check-rls-test-coverage.mjs [--self-test]

import { readFileSync, readdirSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const stripSqlComments = (sql) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

const RLS_DDL =
  /\b(?:create|alter|drop)\s+policy\b|\b(?:enable|disable|force|no\s+force)\s+row\s+level\s+security\b/i;

// `-- covers: <basename>.sql`, one migration per line, repeatable. Anchored to the start
// of a line so it cannot be satisfied by the word appearing mid-sentence.
const COVERS_LINE = /^[ \t]*--[ \t]*covers:[ \t]*(\S+\.sql)[ \t]*$/gim;

const IDENT = '(?:"[^"]+"|[A-Za-z_][\\w$]*)';
const POLICY_TARGET = new RegExp(
  `\\b(?:create|alter|drop)\\s+policy\\s+(?:if\\s+(?:not\\s+)?exists\\s+)?${IDENT}\\s+on\\s+(?:(${IDENT})\\s*\\.\\s*)?(${IDENT})`,
  'gi',
);
const RLS_TABLE = new RegExp(
  `\\balter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(?:(${IDENT})\\s*\\.\\s*)?(${IDENT})[\\s\\S]{0,80}?row\\s+level\\s+security`,
  'gi',
);

const unquote = (s) => s.replace(/^"(.*)"$/, '$1');

/** Relations whose RLS this migration changes — the "on subject" test for (c). */
function relationsTouched(sqlNoComments) {
  const out = new Set();
  for (const re of [POLICY_TARGET, RLS_TABLE]) {
    re.lastIndex = 0;
    for (const m of sqlNoComments.matchAll(re)) out.add(unquote(m[2]).toLowerCase());
  }
  return out;
}

function analyse(root) {
  const migrationsDir = join(root, 'supabase', 'migrations');
  const testsDir = join(root, 'supabase', 'tests');
  const baselinePath = join(root, 'scripts', 'rls-coverage-baseline.json');

  const baselineList = JSON.parse(readFileSync(baselinePath, 'utf8')).grandfathered;
  const baseline = new Set(baselineList);

  const migrations = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const migrationSet = new Set(migrations);
  const tests = readdirSync(testsDir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => ({ name: f, body: readFileSync(join(testsDir, f), 'utf8') }));

  // A probe only counts if test-db.sh actually runs it (uncommented probe line).
  const runnerBody = readFileSync(join(root, 'scripts', 'test-db.sh'), 'utf8');
  const wired = new Set([...runnerBody.matchAll(/^probe\s+(\S+\.sql)\b/gm)].map((m) => m[1]));

  // ── the reverse direction: does every PROBE have a runner? ─────────────────
  // Everything above asks whether a migration has a probe. Nothing asked whether a
  // probe has a runner, which is how student_reviews_restore.test.sql sat green with
  // 54 assertions that no gate ever executed — the second such file in this repo after
  // security_tier1_moderation_scope.test.sql. A finished probe nobody runs is worse
  // than no probe: it reads as coverage in every review and in the file listing.
  const quarantine = new Map();
  const qBlock = runnerBody.match(/^QUARANTINED_PROBES=\(([\s\S]*?)^\)/m);
  if (qBlock) {
    for (const line of qBlock[1].split('\n')) {
      const m = line.match(/^\s*"([^"|]+\.sql)\|([^"]*)"\s*$/);
      if (m) quarantine.set(m[1], m[2].trim());
    }
  }

  // migration basename -> [{ probe, wired, onSubject }]
  const declarations = new Map();
  const unknownTargets = [];
  for (const t of tests) {
    COVERS_LINE.lastIndex = 0;
    for (const m of t.body.matchAll(COVERS_LINE)) {
      const target = m[1];
      if (!migrationSet.has(target)) {
        unknownTargets.push(`${t.name}: "-- covers: ${target}" names no file in supabase/migrations/`);
        continue;
      }
      if (!declarations.has(target)) declarations.set(target, []);
      declarations.get(target).push({ probe: t.name, body: t.body });
    }
  }

  const rlsBody = new Map();
  for (const file of migrations) {
    const body = stripSqlComments(readFileSync(join(migrationsDir, file), 'utf8'));
    if (RLS_DDL.test(body)) rlsBody.set(file, body);
  }

  /** Does any declared probe satisfy (b) wired and (c) on subject? */
  const coveredBy = (file) => {
    const decls = declarations.get(file) ?? [];
    const rels = relationsTouched(rlsBody.get(file) ?? '');
    const runnable = decls.filter((d) => wired.has(d.probe));
    const onSubject = runnable.filter((d) =>
      [...rels].some((r) => new RegExp(`\\b${r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(d.body)),
    );
    return { decls, runnable, onSubject, rels };
  };

  const failures = [];

  for (const file of migrations) {
    if (baseline.has(file)) continue;
    if (!rlsBody.has(file)) continue;
    const { decls, runnable, onSubject } = coveredBy(file);
    if (decls.length === 0) {
      failures.push(`${file}: touches RLS but no probe in supabase/tests/ declares "-- covers: ${file}"`);
    } else if (runnable.length === 0) {
      failures.push(
        `${file}: declared by ${decls.map((d) => d.probe).join(', ')} but none is wired as a probe in scripts/test-db.sh`,
      );
    } else if (onSubject.length === 0) {
      failures.push(
        `${file}: declared by ${runnable.map((d) => d.probe).join(', ')}, but no declaring probe names any relation ` +
          `whose RLS it changes (${[...coveredBy(file).rels].join(', ') || 'none parsed'}) — the declaration is off subject`,
      );
    }
  }

  failures.push(...unknownTargets);

  // ── unwired probes ─────────────────────────────────────────────────────────
  const MIN_REASON = 30;
  for (const t of tests) {
    if (wired.has(t.name)) continue;
    if (quarantine.has(t.name)) continue;
    failures.push(
      `${t.name}: exists in supabase/tests/ but NO gate runs it — wire it as a \`probe\` line in ` +
        `scripts/test-db.sh, or quarantine it in QUARANTINED_PROBES with a reason`,
    );
  }
  for (const [file, reason] of quarantine) {
    if (!tests.some((t) => t.name === file)) {
      failures.push(`quarantine: "${file}" is quarantined but no such file exists in supabase/tests/ — delete the entry`);
    } else if (wired.has(file)) {
      failures.push(`quarantine: "${file}" is quarantined AND wired as a probe — delete the quarantine entry`);
    } else if (reason.length < MIN_REASON) {
      failures.push(
        `quarantine: "${file}" has no usable reason (${reason.length} chars). Say what is broken and what has ` +
          `to be true to wire it back; a probe that is quarantined and forgotten protects nothing`,
      );
    }
  }
  // A probe line naming a file that is not there is silently a no-op today: the runner
  // would die on it, but only if the suite is actually run, and the count pin would still
  // read as healthy.
  for (const file of wired) {
    if (!tests.some((t) => t.name === file)) {
      failures.push(`test-db.sh: \`probe ${file}\` names no file in supabase/tests/`);
    }
  }

  // ── the baseline is audited, not trusted ────────────────────────────────────
  for (const file of baselineList) {
    if (!migrationSet.has(file)) {
      failures.push(`baseline: "${file}" is grandfathered but no longer exists — delete the entry`);
      continue;
    }
    if (!rlsBody.has(file)) {
      failures.push(`baseline: "${file}" is grandfathered but no longer contains RLS DDL — delete the entry`);
      continue;
    }
    const { onSubject } = coveredBy(file);
    if (onSubject.length > 0) {
      failures.push(
        `baseline: "${file}" is grandfathered AND covered by ${onSubject.map((d) => d.probe).join(', ')} — ` +
          `delete the entry in the same commit as the probe. The list only shrinks.`,
      );
    }
  }

  const sorted = [...baselineList].sort();
  if (baselineList.some((f, i) => f !== sorted[i])) {
    failures.push('baseline: .grandfathered must be sorted (an out-of-order insert hides a re-add)');
  }
  if (new Set(baselineList).size !== baselineList.length) {
    failures.push('baseline: .grandfathered contains duplicates');
  }

  return { failures, migrations, baseline, declarations, wired };
}

// ── self-test ────────────────────────────────────────────────────────────────
// Each case builds a throwaway repo and asserts the rule FIRES, because a gate whose
// rejection path is never executed is a gate nobody has tested.
function selfTest() {
  const cases = [];
  const scratch = mkdtempSync(join(tmpdir(), 'rls-gate-selftest-'));

  const build = ({ migrations = {}, tests = {}, probes = [], grandfathered = [], quarantined = [] }) => {
    const root = mkdtempSync(join(scratch, 'repo-'));
    mkdirSync(join(root, 'supabase', 'migrations'), { recursive: true });
    mkdirSync(join(root, 'supabase', 'tests'), { recursive: true });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    for (const [n, b] of Object.entries(migrations)) writeFileSync(join(root, 'supabase/migrations', n), b);
    for (const [n, b] of Object.entries(tests)) writeFileSync(join(root, 'supabase/tests', n), b);
    writeFileSync(
      join(root, 'scripts/test-db.sh'),
      [
        '#!/usr/bin/env bash',
        ...probes.map((p) => `probe ${p} "label" 1`),
        'QUARANTINED_PROBES=(',
        ...quarantined.map(([f, why]) => `  "${f}|${why}"`),
        ')',
      ].join('\n') + '\n',
    );
    writeFileSync(
      join(root, 'scripts/rls-coverage-baseline.json'),
      JSON.stringify({ comment: 'self-test', grandfathered }, null, 2),
    );
    return root;
  };

  const MIG = '20261001000000_widget_rls.sql';
  const RLS_SQL = 'CREATE POLICY widget_select ON public.widgets FOR SELECT USING (owner_id = auth.uid());\n';
  const GOOD_PROBE = `-- covers: ${MIG}\nSELECT 1 FROM public.widgets;\n`;

  const check = (label, root, expectFailSubstring) => {
    const { failures } = analyse(root);
    const hit = expectFailSubstring === null
      ? failures.length === 0
      : failures.some((f) => f.includes(expectFailSubstring));
    cases.push({ label, ok: hit, failures });
  };

  check('a covered migration passes',
    build({ migrations: { [MIG]: RLS_SQL }, tests: { 'w.test.sql': GOOD_PROBE }, probes: ['w.test.sql'] }),
    null);

  check('no declaration at all fails',
    build({ migrations: { [MIG]: RLS_SQL }, tests: { 'w.test.sql': 'SELECT 1 FROM public.widgets;\n' }, probes: ['w.test.sql'] }),
    'no probe in supabase/tests/ declares');

  check('a bare version mention no longer counts as coverage',
    build({
      migrations: { [MIG]: RLS_SQL },
      tests: { 'w.test.sql': `-- see also ${MIG} for context\nSELECT 1 FROM public.widgets;\n` },
      probes: ['w.test.sql'],
    }),
    'no probe in supabase/tests/ declares');

  check('a declared but UNWIRED probe fails',
    build({ migrations: { [MIG]: RLS_SQL }, tests: { 'w.test.sql': GOOD_PROBE }, probes: [] }),
    'none is wired as a probe');

  check('a declared, wired, OFF-SUBJECT probe fails',
    build({
      migrations: { [MIG]: RLS_SQL },
      tests: { 'w.test.sql': `-- covers: ${MIG}\nSELECT 1 FROM public.gadgets;\n` },
      probes: ['w.test.sql'],
    }),
    'off subject');

  check('a covers: line naming no migration fails',
    build({
      migrations: { [MIG]: RLS_SQL },
      tests: { 'w.test.sql': `${GOOD_PROBE}-- covers: 20261231000000_typo.sql\n` },
      probes: ['w.test.sql'],
    }),
    'names no file in supabase/migrations/');

  check('a migration with no RLS DDL needs nothing',
    build({ migrations: { '20261001000000_plain.sql': 'CREATE TABLE t (id int);\n' }, tests: {}, probes: [] }),
    null);

  check('RLS DDL that appears only in a comment does not trip the gate',
    build({ migrations: { '20261001000000_prose.sql': '-- Rollback: DROP POLICY x ON t;\nCREATE TABLE t (id int);\n' } }),
    null);

  check('a grandfathered migration is skipped',
    build({ migrations: { [MIG]: RLS_SQL }, grandfathered: [MIG] }),
    null);

  check('a grandfathered migration that no longer exists fails',
    build({ migrations: {}, grandfathered: ['20260101000000_gone.sql'] }),
    'no longer exists');

  check('a grandfathered migration with no RLS DDL fails',
    build({ migrations: { '20260101000000_plain.sql': 'CREATE TABLE t (id int);\n' }, grandfathered: ['20260101000000_plain.sql'] }),
    'no longer contains RLS DDL');

  check('a grandfathered migration that HAS earned coverage fails',
    build({
      migrations: { [MIG]: RLS_SQL },
      tests: { 'w.test.sql': GOOD_PROBE },
      probes: ['w.test.sql'],
      grandfathered: [MIG],
    }),
    'delete the entry in the same commit as the probe');

  check('an unsorted baseline fails',
    build({
      migrations: { 'a.sql': RLS_SQL, 'b.sql': RLS_SQL },
      grandfathered: ['b.sql', 'a.sql'],
    }),
    'must be sorted');

  check('a duplicated baseline entry fails',
    build({ migrations: { 'a.sql': RLS_SQL }, grandfathered: ['a.sql', 'a.sql'] }),
    'contains duplicates');

  // ── the reverse direction: a probe nobody runs ────────────────────────────
  const REASON = 'blocked on a real schema defect, see the header';   // 40 chars

  check('a probe that no gate runs fails',
    build({
      migrations: { [MIG]: RLS_SQL },
      tests: { 'w.test.sql': GOOD_PROBE, 'orphan.test.sql': 'SELECT 1;\n' },
      probes: ['w.test.sql'],
    }),
    'exists in supabase/tests/ but NO gate runs it');

  check('an unrun probe that is quarantined with a reason passes',
    build({
      migrations: { [MIG]: RLS_SQL },
      tests: { 'w.test.sql': GOOD_PROBE, 'orphan.test.sql': 'SELECT 1;\n' },
      probes: ['w.test.sql'],
      quarantined: [['orphan.test.sql', REASON]],
    }),
    null);

  check('a quarantine entry with a token reason fails',
    build({
      migrations: { [MIG]: RLS_SQL },
      tests: { 'w.test.sql': GOOD_PROBE, 'orphan.test.sql': 'SELECT 1;\n' },
      probes: ['w.test.sql'],
      quarantined: [['orphan.test.sql', 'TODO']],
    }),
    'no usable reason');

  check('a quarantine entry for a file that does not exist fails',
    build({
      migrations: { [MIG]: RLS_SQL },
      tests: { 'w.test.sql': GOOD_PROBE },
      probes: ['w.test.sql'],
      quarantined: [['ghost.test.sql', REASON]],
    }),
    'no such file exists in supabase/tests/');

  check('a probe that is quarantined AND wired fails',
    build({
      migrations: { [MIG]: RLS_SQL },
      tests: { 'w.test.sql': GOOD_PROBE },
      probes: ['w.test.sql'],
      quarantined: [['w.test.sql', REASON]],
    }),
    'quarantined AND wired');

  check('a probe line naming a missing file fails',
    build({
      migrations: { [MIG]: RLS_SQL },
      tests: { 'w.test.sql': GOOD_PROBE },
      probes: ['w.test.sql', 'typo.test.sql'],
    }),
    'names no file in supabase/tests/');

  rmSync(scratch, { recursive: true, force: true });

  const bad = cases.filter((c) => !c.ok);
  for (const c of cases) console.log(`${c.ok ? '✓' : '✗'} ${c.label}`);
  if (bad.length > 0) {
    for (const c of bad) console.error(`\n  case "${c.label}" saw:\n    ${c.failures.join('\n    ') || '(no failures)'}`);
    console.error(`\n✗ RLS coverage gate self-test: ${bad.length}/${cases.length} case(s) failed`);
    process.exit(1);
  }
  console.log(`\n✓ RLS coverage gate self-test: ${cases.length} cases passed`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const { failures, migrations, baseline, declarations } = analyse(root);

  if (failures.length > 0) {
    console.error('✗ RLS test-coverage gate: uncovered RLS migration(s) / stale baseline\n');
    for (const f of failures) console.error(`  · ${f}`);
    console.error(
      '\n  Every migration that touches row-level security needs a probe in supabase/tests/' +
        '\n  that (a) declares it with a `-- covers: <migration>.sql` header line, (b) proves the' +
        '\n  guard fires AND passes (attack denied + legitimate path allowed), and (c) is wired as' +
        '\n  a `probe` line in scripts/test-db.sh. See setup_photos_owner_select.test.sql for the' +
        '\n  reference shape and docs/security/rls-grandfathered-audit.md for the debt that remains.' +
        '\n  Do not add new migrations to rls-coverage-baseline.json.',
    );
    process.exit(1);
  }

  console.log(
    `✓ RLS test-coverage gate: ${migrations.length} migrations scanned, ` +
      `${baseline.size} grandfathered, ${declarations.size} declared-covered, ` +
      `all newer RLS migrations are probe-covered`,
  );
}
