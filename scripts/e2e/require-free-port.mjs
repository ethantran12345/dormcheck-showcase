#!/usr/bin/env node
/**
 * Refuse to start the audit unless its dedicated port is actually free.
 *
 * Usage: node scripts/e2e/require-free-port.mjs 8123
 * Exit 0 = free. Exit 1 = occupied (message on stderr).
 *
 * WHY THIS IS THE FIRST THING run-audit.sh DOES (queue item 8c).
 * Playwright is configured with `--strictPort` and `reuseExistingServer: false`,
 * so an occupied :8123 kills the crawl. That part was always correct. What was
 * wrong is what happened next: the script continued to the report step and
 * rebuilt docs/audits/app-bug-audit-report/index.md from the PREVIOUS run's
 * records, printing stale numbers as current. During 8b that handed back pre-fix
 * numbers as post-fix and only operator suspicion caught it.
 *
 * A dead orphan process is the usual cause: a vite left behind by a closed lane
 * holds ::1 only, while 127.0.0.1 stays free. `localhost` resolves to ::1 first
 * on macOS, so the crawl's server collides — but a naive probe does not notice,
 * because macOS (unlike Linux) happily grants the dual-stack WILDCARD even while
 * a specific address on that port is held. A wildcard-only probe therefore
 * reports "free" for precisely the case that bites us.
 *
 * So we probe each address the dev server could realistically land on, and any
 * one of them being taken is a refusal.
 */
import { createServer } from 'node:net';

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
  console.error('usage: require-free-port.mjs <port>');
  process.exit(2);
}

/** Try to bind one address. Resolves to the error code, or null when free. */
function probe(host) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (err) => {
      // EADDRNOTAVAIL / EAFNOSUPPORT just mean this machine has no such stack
      // (e.g. IPv6 disabled) — not a busy port.
      resolve(err.code === 'EADDRINUSE' ? err.code : null);
    });
    server.once('listening', () => server.close(() => resolve(null)));
    server.listen(port, host);
  });
}

// All four, because macOS is permissive in EVERY direction: it will grant the
// dual-stack wildcard while ::1 is held, grant 127.0.0.1 while the wildcard is
// held, and — the case that got through on 2026-07-29 — grant all three of those
// while the IPv4 wildcard 0.0.0.0 is held. Any single probe alone therefore
// reports "free" for a port that is not.
//
// `undefined` makes Node bind the DUAL-STACK wildcard (`::` with v4-mapping), so
// it is not the same address as an explicit '0.0.0.0'. A vite started with
// `--host 0.0.0.0` (which is what `lane:verify` does) holds only the latter, and
// the three original probes all sailed past it: the audit ran to step [4/5] and
// died in `webServer` after a full `db reset`. Failing closed here is cheap; the
// whole point of 8c is that the harness must not proceed on a false green.
const HOSTS = [undefined, '0.0.0.0', '127.0.0.1', '::1'];
for (const host of HOSTS) {
  const code = await probe(host);
  if (!code) continue;
  console.error(`✗ Port ${port} is already in use on ${host ?? '0.0.0.0/::'} (${code}).`);
  console.error(`  The audit crawl needs an exclusive :${port} — it will not reuse an existing server,`);
  console.error('  because that server may point at the PROD Supabase project rather than the local stack.');
  console.error(`  Free it first:  lsof -nP -iTCP:${port} -sTCP:LISTEN   then kill the pid.`);
  console.error('  (Usually a vite orphaned by a closed lane. It can hold ::1, or 0.0.0.0 when it was');
  console.error('   started with --host, while the other addresses still look free — hence four probes.)');
  process.exit(1);
}
process.exit(0);
