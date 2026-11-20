/**
 * agent-detection-log — an append-only forensic record of every peer-detection DECISION.
 *
 * WHY THIS EXISTS (2026-08-06). The session registry (./agent-registry.mjs) shipped the
 * same morning with a documented next step: promote the advisory banner to a real gate,
 * but ONLY "once the false-positive rate is known" (docs/handoffs/concurrent-session-
 * guard-proposal.md, point 5). The same condition gates broadening identity to non-Claude
 * agents. Both gates were unmeasurable as written: the banner printed to a terminal and
 * exited, `wip.mjs` logged its skip to a hook's stderr, and nothing survived the session.
 * So "zero false positives over three sessions" could only ever have been a recollection.
 *
 * This module is the instrument. Every time the peer question is ASKED, the answer plus
 * the evidence behind it is appended to <git-common-dir>/dc-agent-detections.jsonl.
 * Adjudication happens on READ (see summarize()), never on write — so a record written
 * today stays useful when the rules get sharper tomorrow.
 *
 * THE THREE FACTS THAT MAKE A RECORD ADJUDICABLE:
 *
 *  1. `peers[].comm` — the process name `ps` reported for the pid we claimed was a live
 *     peer, captured AT THE MOMENT OF THE CLAIM. This is the whole ballgame. The registry
 *     tests liveness with `kill(pid, 0)`, which cannot distinguish "that agent is still
 *     running" from "the OS reused that pid for something else after a reboot". A claimed
 *     peer whose comm is not an agent process is a PROVABLE false positive, and it can be
 *     counted mechanically instead of remembered.
 *
 *  2. `ancestry` — the comm chain from this process upward, the same walk identity
 *     resolution performs. When identity comes back unresolved this chain IS the
 *     diagnosis, and when a non-Claude agent runs the hook the chain records exactly what
 *     that tool's process is called. That is the observation the tool-agnostic work needs
 *     and cannot get any other way; nothing here has to guess at a name in advance.
 *
 *  3. `event: 'session-end'` — written on clean deregistration. Its ABSENCE is the signal:
 *     a session that logged activity, never logged an end, and whose pid is now gone died
 *     UNCLEANLY. That is the case that leaves a stale row behind, and the only case worth
 *     proving. summarize() reports it as `uncleanExits`.
 *
 * DESIGN RULES:
 *
 *  A. IT MUST NOT BE ABLE TO BREAK A HOOK. Imported by wip.mjs, which is the Stop hook and
 *     the auto-save safety net. Every export swallows its own errors and returns null. A
 *     lost log line is nothing; a hook that throws costs an auto-save.
 *
 *  B. IT DOES NOT TOUCH THE DETECTOR. This module is read-only with respect to
 *     agent-registry.mjs: it records what the detector decided, it never influences it.
 *     `procInfo` below is deliberately duplicated rather than exported from there —
 *     changing the detector while measuring it is how you measure nothing.
 *
 *  C. APPEND-ONLY, NEVER READ-MODIFY-WRITE. The thing being logged is concurrent sessions,
 *     so any read-modify-write on this file is a race by construction. One `appendFileSync`
 *     per record, O_APPEND, single line. The only rewrite is size rotation, which is rare
 *     and goes through temp+rename.
 *
 *  D. OBSERVATION IS NOT DETECTION. `OBSERVE_COMMS` below is broader than the detector's
 *     known set on purpose — it exists to notice agent processes the detector is currently
 *     blind to (the false-NEGATIVE half of the rate). Nothing in this file feeds a gate,
 *     so a name here can never turn a shell into a peer.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync, existsSync, statSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { commonDir, sessionIdentity, worktreeRoot, pidAlive, ageMs, human } from './agent-registry.mjs';

/** Rotate above this, keeping the newest KEEP_BYTES. A forensic log that fills a disk is a bug. */
export const MAX_BYTES = 4 * 1024 * 1024;
export const KEEP_BYTES = 2 * 1024 * 1024;

/**
 * Process names worth NOTICING in a snapshot. Observation only — see design rule D. This
 * list may be broadened freely; the detector's known set may not, and lives elsewhere.
 */
export const OBSERVE_COMMS = ['claude', 'claude.exe', 'codex', 'codex.exe'];

/** Adjudication: which comms count as a real agent when scoring a claimed peer on READ. */
export const AGENT_COMMS = OBSERVE_COMMS;

const disabled = () => ['0', 'false', 'no', 'off'].includes(String(process.env.DC_DETECTION_LOG ?? '').toLowerCase());

export function detectionLogPath() {
  return join(commonDir(), 'dc-agent-detections.jsonl');
}

const basename = (comm = '') => (String(comm).trim().split('/').filter(Boolean).pop() || '').trim();

// Duplicated from agent-registry on purpose (design rule B) — the measuring instrument does
// not get to reach into the thing it measures.
function procInfo(pid) {
  try {
    const out = execFileSync('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000,
    }).trim();
    const m = /^(\d+)\s+(.*)$/.exec(out);
    return m ? { ppid: Number(m[1]) || 0, comm: m[2] } : null;
  } catch { return null; }
}

/** The comm chain from this process upward — the same walk identity resolution makes. */
function ancestry(limit = 24) {
  const chain = [];
  let pid = process.pid;
  for (let i = 0; i < limit && pid > 1; i++) {
    const info = procInfo(pid);
    if (!info) break;
    chain.push({ pid, comm: info.comm });
    pid = info.ppid;
  }
  return chain;
}

/** One `ps` for the whole machine, indexed by pid. Returns null if `ps` is unavailable. */
function psTable() {
  try {
    const out = execFileSync('ps', ['-eo', 'pid=,ppid=,comm='], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000,
    });
    const table = new Map();
    for (const line of out.split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
      if (m) table.set(Number(m[1]), { ppid: Number(m[2]), comm: m[3].trim() });
    }
    return table;
  } catch { return null; }
}

/**
 * Append one decision record. Returns the record, or null if anything at all went wrong —
 * callers must treat a null exactly like a success (design rule A).
 *
 * @param {object} o
 * @param {string} o.event      'session-begin' | 'wip-skip' | 'wip-alone' | 'session-end' | string
 * @param {Array}  [o.peers]    the rows the detector claimed as live peers HERE
 * @param {string} [o.worktree] the tree the decision was made about
 * @param {boolean}[o.inMain]   whether that tree is the main checkout
 * @param {string} [o.note]     free text for the human reading the log later
 */
export function logDetection({ event, peers = [], worktree = null, inMain = null, note = null } = {}) {
  if (disabled()) return null;
  try {
    const me = sessionIdentity();
    const table = psTable();
    const commOf = (pid) => (table ? (table.get(Number(pid))?.comm ?? null) : undefined);

    const record = {
      iso: new Date().toISOString(),
      event,
      // `resolved:false` is the fail-open path: nothing registered, nobody counted. Logging
      // it is the point — it is the denominator for "how often does identity not resolve".
      me: { id: me.id, pid: me.pid, source: me.source, resolved: me.resolved },
      hookPid: process.pid,
      worktree: worktree || worktreeRoot() || null,
      inMain,
      // Fact 1: what `ps` called each claimed peer, at the instant it was claimed.
      peers: (peers || []).map((s) => ({
        id: s.id,
        pid: s.pid || null,
        label: s.label || null,
        worktree: s.worktree || null,
        startedAt: s.startedAt || null,
        lastSeen: s.lastSeen || null,
        alive: pidAlive(s.pid),
        comm: commOf(s.pid) ?? null,
      })),
      // Fact 2: how this process would have been identified, whatever tool it belongs to.
      ancestry: ancestry(),
      // The false-NEGATIVE half: agent processes running that nobody counted.
      agentProcs: table
        ? [...table.entries()]
            .filter(([, v]) => OBSERVE_COMMS.includes(basename(v.comm)))
            .map(([pid, v]) => ({ pid, ppid: v.ppid, comm: v.comm }))
        : null,
      psAvailable: !!table,
    };
    if (note) record.note = note;

    const file = detectionLogPath();
    rotateIfHuge(file);
    appendFileSync(file, JSON.stringify(record) + '\n');
    return record;
  } catch { return null; }
}

// Rare, and racy-but-harmless: the worst case is losing old records from a log that is
// already over its cap. temp+rename so a concurrent reader never sees a partial file.
function rotateIfHuge(file) {
  try {
    if (!existsSync(file) || statSync(file).size <= MAX_BYTES) return;
    const kept = readFileSync(file, 'utf8').slice(-KEEP_BYTES);
    const body = kept.slice(kept.indexOf('\n') + 1);   // drop the half line the slice cut
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, body);
    try { renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
  } catch { /* a log that cannot rotate still logs */ }
}

/** Read the log back. Corrupt lines are skipped, never thrown on. */
export function readDetections({ limit = 0 } = {}) {
  try {
    const file = detectionLogPath();
    if (!existsSync(file)) return [];
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const slice = limit > 0 ? lines.slice(-limit) : lines;
    const out = [];
    for (const l of slice) { try { out.push(JSON.parse(l)); } catch { /* skip */ } }
    return out;
  } catch { return []; }
}

/**
 * Adjudicate. Everything here is derived from the records — the rules can be sharpened
 * later without invalidating anything already written.
 *
 * SUSPECT is the load-bearing verdict: a peer we claimed was live, whose pid `ps` either
 * did not know about or reported under a non-agent name. That is a false positive with
 * evidence attached, and it is the number the two open gates are actually waiting on.
 */
export function summarize(records = readDetections()) {
  const detections = [];
  const suspects = [];
  const sessions = new Map();   // id → { firstSeen, lastSeen, lastPid, ended }
  let alone = 0;
  let unresolved = 0;

  for (const r of records) {
    const id = r?.me?.id;
    if (id) {
      const s = sessions.get(id) || { id, firstSeen: r.iso, lastSeen: r.iso, lastPid: r.me.pid, ended: false, events: 0 };
      s.lastSeen = r.iso;
      s.lastPid = r.me.pid || s.lastPid;
      s.events += 1;
      if (r.event === 'session-end') s.ended = true;
      sessions.set(id, s);
    }
    if (r?.me?.resolved === false) unresolved += 1;

    const peers = Array.isArray(r.peers) ? r.peers : [];
    if (!peers.length) { if (r.event !== 'session-end') alone += 1; continue; }
    detections.push(r);
    for (const p of peers) {
      // psAvailable === false means we simply could not look — that is unknown, not wrong.
      if (r.psAvailable === false) continue;
      const comm = basename(p.comm || '');
      if (!p.comm || !AGENT_COMMS.includes(comm)) {
        suspects.push({ iso: r.iso, event: r.event, claimedBy: r.me?.id, peer: p });
      }
    }
  }

  // Fact 3: activity with no clean end and a pid that is gone = an unclean death.
  const uncleanExits = [...sessions.values()].filter((s) => !s.ended && s.lastPid && !pidAlive(s.lastPid));

  return {
    records: records.length,
    first: records[0]?.iso || null,
    last: records[records.length - 1]?.iso || null,
    sessions: [...sessions.values()],
    detections: detections.length,
    alone,
    unresolved,
    suspects,
    uncleanExits,
    byEvent: records.reduce((acc, r) => ({ ...acc, [r.event]: (acc[r.event] || 0) + 1 }), {}),
  };
}

/** The human report behind `npm run agent:detections`. */
export function formatSummary(sum) {
  const L = [];
  const span = sum.first && sum.last ? `  (${sum.first} → ${sum.last})` : '';
  L.push(`DETECTION LOG  ${detectionLogPath()}`);
  L.push('');
  L.push(`  records            ${sum.records}${span}`);
  L.push(`  by event           ${Object.entries(sum.byEvent).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}`);
  L.push(`  sessions seen      ${sum.sessions.length}${sum.sessions.length ? `   ${sum.sessions.map((s) => s.id).join(', ')}` : ''}`);
  L.push('');
  L.push(`  peer detections    ${sum.detections}      ← the denominator for the false-positive rate`);
  L.push(`  no peer            ${sum.alone}`);
  L.push(`  identity unresolved ${sum.unresolved}     ← fail-open: registered nothing, counted nobody`);
  L.push('');
  if (sum.suspects.length) {
    L.push(`  ⛔ SUSPECT          ${sum.suspects.length}      ← a claimed peer that was NOT an agent process`);
    for (const s of sum.suspects.slice(-10)) {
      L.push(`      ${s.iso}  ${s.event}: ${s.claimedBy} claimed ${s.peer.id} (pid ${s.peer.pid}) — ps said ${s.peer.comm ? `"${s.peer.comm}"` : 'no such process'}`);
    }
  } else {
    L.push('  ✓ SUSPECT          0      ← every claimed peer was corroborated as a live agent process');
  }
  L.push('');
  if (sum.uncleanExits.length) {
    L.push(`  unclean exits      ${sum.uncleanExits.length}      ← activity, no session-end, pid now gone (the stale-row case)`);
    for (const s of sum.uncleanExits.slice(-10)) {
      L.push(`      ${s.id} (pid ${s.lastPid}) last seen ${human(ageMs(s.lastSeen))} ago after ${s.events} record(s)`);
    }
  } else {
    L.push('  unclean exits      0      ← no session has yet died without deregistering');
  }
  return L.join('\n');
}
