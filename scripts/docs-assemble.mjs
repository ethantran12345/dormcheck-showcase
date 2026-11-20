#!/usr/bin/env node
/**
 * docs-assemble — fold per-lane CHANGELOG/DECISIONS fragments into the real logs.
 *
 *   node scripts/docs-assemble.mjs          # assemble, delete the fragments
 *   node scripts/docs-assemble.mjs --check   # report only, exit 1 if anything is pending
 *   node scripts/docs-assemble.mjs --dry-run # print what WOULD move, change nothing
 *
 * WHY THIS EXISTS
 * docs/CHANGELOG.md and docs/DECISIONS.md are single files that every lane wants to
 * append to, which makes them the most reliable collision in the repo: whichever lane
 * declares `docs/CHANGELOG.md` in --owns locks out every other lane's journal entry
 * until it ships. Both live lanes on 2026-08-16 had claimed CHANGELOG.md, and one had
 * also taken DECISIONS.md, so no other session could record anything at all.
 *
 * The fix is the SAME SHAPE as the per-lane handoff, which has never collided since it
 * stopped being a shared file: give every lane its own path. A lane appends to
 * docs/changelog.d/<lane>.md, and those fragments are concatenated into the real log at
 * release. Append-only content in a per-writer file cannot conflict — there is no
 * shared line for two writers to reach for.
 *
 * ORDERING is by fragment mtime, newest first, matching how both logs already read
 * (most recent entry at the top). Two lanes shipping the same day interleave by when
 * they were written rather than by lane name, which is the order a reader expects.
 *
 * NON-DESTRUCTIVE BY CONSTRUCTION: a fragment is deleted only after its content is
 * present in the target file and that file has been written back successfully. If the
 * write throws, the fragments are still on disk and the command can be re-run.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const DRY = args.includes('--dry-run');

// Each log declares where its fragments live and how to find the top of its entry list.
// `firstEntry` is deliberately a per-file regex rather than a shared guess: the two files
// genuinely differ (CHANGELOG bullets its entries, DECISIONS does not), and a wrong
// insertion point would bury new entries under the header prose instead of above the
// most recent one.
const LOGS = [
  { name: 'CHANGELOG', target: 'docs/CHANGELOG.md', dir: 'docs/changelog.d', firstEntry: /^- \d{4}-\d{2}-\d{2}:/m },
  { name: 'DECISIONS', target: 'docs/DECISIONS.md', dir: 'docs/decisions.d', firstEntry: /^\d{4}-\d{2}-\d{2}: \[/m },
];

// A fragment is any .md in the dir except the README that documents the dir itself.
function fragments(dir) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
    .map((f) => ({ file: f, path: join(abs, f), mtime: statSync(join(abs, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

let pending = 0;
const summary = [];

for (const log of LOGS) {
  const frags = fragments(log.dir);
  if (!frags.length) { summary.push(`  ${log.name.padEnd(10)} no fragments`); continue; }
  pending += frags.length;

  const bodies = frags.map((f) => readFileSync(f.path, 'utf8').trim()).filter(Boolean);
  summary.push(`  ${log.name.padEnd(10)} ${frags.length} fragment(s): ${frags.map((f) => f.file).join(', ')}`);
  if (CHECK || DRY) continue;

  const targetPath = join(ROOT, log.target);
  const original = readFileSync(targetPath, 'utf8');
  const block = bodies.join('\n\n');
  const at = original.search(log.firstEntry);
  // No existing entry (an emptied log) is not an error — append after the header rather
  // than refusing, so the first lane to use the mechanism is not a special case.
  const next = at === -1
    ? `${original.replace(/\s*$/, '')}\n\n${block}\n`
    : `${original.slice(0, at)}${block}\n\n${original.slice(at)}`;

  writeFileSync(targetPath, next);
  // Only now, with the target safely on disk, are the fragments retired.
  for (const f of frags) unlinkSync(f.path);
}

const header = CHECK ? 'PENDING DOC FRAGMENTS' : DRY ? 'WOULD ASSEMBLE' : 'ASSEMBLED';
console.log(`\n${header}`);
for (const line of summary) console.log(line);

if (CHECK && pending) {
  console.log(`\n✗ ${pending} unassembled fragment(s). Fold them in before releasing:  node scripts/docs-assemble.mjs`);
  process.exit(1);
}
if (!CHECK && !DRY && pending) console.log(`\n✓ ${pending} fragment(s) folded in and removed. Commit the updated log(s).`);
console.log('');
