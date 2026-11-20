#!/usr/bin/env node
// i18n key-resolution guard. Walks BOTH directions: code -> locale, and locale -> code.
//
// ── Direction 1: code -> locale (every referenced key must resolve) ──────────────
//
// Scans src/** for every static translation reference and asserts each one resolves
// to a NON-EMPTY string in the English locale (src/i18n/locales/en/<ns>.json).
// Because the runtime is configured with `returnEmptyString: false` + `fallbackLng: en`,
// a key that is missing OR maps to an empty string renders the raw key (or leaks
// English into zh), so both are treated as failures here.
//
// This catches the class of bug where a phase commits code referencing a key but
// the shared locale JSON with that key's copy is never committed (parallel-session
// reconcile hazard). Wired into CI (ci-dev-push.yml) and `npm run test`.
//
// A reference is found by EITHER of two scans, because this file learned the hard
// way that one scan is a shape, not a rule:
//
//   CALL-SHAPE scan (`REFERENCE_RE`) — `t('ns:key')`, `t('key')` (defaultNS =
//     common), `i18n.t(...)`, `<Trans i18nKey="...">`. This is the only scan that
//     can see an UNQUALIFIED default-namespace key like `t('actions.done')`, since
//     such a key has no namespace prefix to recognise it by.
//
//   VALUE-SHAPE scan (`NAMESPACED_LITERAL_RE`) — any string literal whose ENTIRE
//     content is `<known-ns>:<dotted.key>`, wherever it appears. Added 2026-08-17.
//
// WHY THE SECOND SCAN EXISTS. Nav rows do not call `t()` at their definition site.
// They declare copy as a data property — `{ id: 'messages', labelKey: 'misc:nav.messages', … }`
// — and something else calls `t(labelKey)` later. The call-shape scan cannot see that,
// so `misc:nav.messages` shipped referenced-but-undefined and rendered as the raw
// string "misc:nav.messages" in the launcher. The gate was green the whole time.
//
// The fix is deliberately NOT "also match `labelKey:`". Enumerating property names is
// the same mistake one rung up: the codebase already spells this idea at least eight
// different ways (`labelKey`, `tabLabelKey`, `titleKey`, `descKey`, `hintKey`,
// `headingKey`, `qKey`/`aKey`, and a bare `label:` in AppSidebar.tsx), and the ninth
// would be invisible again. So the second scan keys off the VALUE, not the property:
// a literal that is exactly `<ns>:<dotted.key>` for an `ns` that is a real file in
// src/i18n/locales/en is an i18n key no matter what it is assigned to, passed to, or
// stored in. The namespace set is read from the locale directory at runtime, so
// adding a namespace extends coverage with no edit here.
//
// Measured when this landed: 2,524 namespace-prefixed literals in src, 2,474 of them
// under a real namespace, and the scan produced exactly two genuine misses and zero
// false positives. Non-i18n prefixes present in the tree (`md:`, `lg:`, `sm:`, `xl:`
// Tailwind variants; `dms:`, `session:`, `node:`, `docs:`, `og:`, `twitter:`) are all
// rejected by the namespace gate without a single hand-written exception.
//
// Not covered, deliberately: keys assembled at runtime from variables
// (`` t(`misc:nav.${id}`) ``). No static scan can resolve those, and the locale-side
// check below is written to tolerate them rather than guess.
//
// ── Direction 2: locale -> code (orphan keys) ────────────────────────────────────
//
// DECISION (2026-08-17): the reverse direction IS covered, by `verifyOrphans()`.
// It was previously uncovered and undocumented, which read as coverage — the five
// dead keys removed in 968e8043 could only be found by hand-grepping, because
// nothing in this repo could answer "is any key defined but never used?"
//
// An orphan is not a user-visible bug the way a missing key is; it is dead copy that
// translators pay to translate and reviewers pay to read. So it is gated, but with a
// ratchet rather than a cliff: the orphans that existed when the check landed are
// listed in scripts/i18n-orphan-baseline.json, each with a reason checked against
// `git log -S`, and that list can only SHRINK. A new orphan fails. A baseline entry
// that stops being an orphan also fails, so the file cannot rot into a permanent excuse.
//
// A key counts as referenced if it was found by either scan above, or if it (or its
// bare dotted form) appears anywhere in src as a complete dotted token, or if any
// ANCESTOR of it appears as a truncated prefix — the residue a runtime-assembled key
// such as `` t(`misc:nav.${id}`) `` leaves in the file. That last rule is why a dynamic
// key family is never reported: verified against the six such families in the tree
// (settings:notifications.categories, marketplace:service.categories, auth:passwordRules,
// messaging:social.platform, housing:explore.map.legend, marketplace:sublease.utility) —
// 37 keys, none flagged. The accepted cost is the mirror image: a genuinely dead key
// sitting inside a live dynamic family stays invisible.
//
// The two token sets are deliberately NOT merged — see indexSourceTokens(). A static
// reference must vouch for its own key only; if it also seeded the prefix set, one
// `misc:nav.messages` in the code would vouch for every `nav.*` key in the locale and
// this direction would report nothing, forever, while looking like it worked.
//
// Usage: node scripts/i18n-verify-keys.mjs   (exit 1 + list on any miss or new orphan)
//        import { verifyKeys, verifyOrphans } from './scripts/i18n-verify-keys.mjs'

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const LOCALES_EN = path.join(SRC, "i18n", "locales", "en");
const ORPHAN_BASELINE = path.join(ROOT, "scripts", "i18n-orphan-baseline.json");
const DEFAULT_NS = "common";

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "locales") continue;
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/** Read every scanned source file once. Both directions share this. */
let sourceCache = null;
function readSources() {
  if (sourceCache) return sourceCache;
  sourceCache = walk(SRC).map((file) => ({ file, text: fs.readFileSync(file, "utf8") }));
  return sourceCache;
}

/**
 * The real namespaces, read from the locale directory rather than hard-coded, so a
 * new `src/i18n/locales/en/<ns>.json` is covered by the value-shape scan the moment
 * it exists. This set is also what makes that scan safe: it is the whole reason
 * `md:flex` and `node:fs` are not mistaken for translation keys.
 */
function knownNamespaces() {
  return new Set(
    fs
      .readdirSync(LOCALES_EN)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5))
  );
}

function loadNs(ns) {
  const file = path.join(LOCALES_EN, `${ns}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function resolve(obj, dottedKey) {
  let cur = obj;
  for (const part of dottedKey.split(".")) {
    if (cur && typeof cur === "object" && part in cur) cur = cur[part];
    else return undefined;
  }
  return cur;
}

// i18next plural keys are stored with a CLDR-category suffix (`key_one`,
// `key_other`, …) and referenced by their base name plus `{ count }`. A static
// scan can't see the count arg, so treat a base key as resolved when any plural
// variant carries non-empty copy.
const PLURAL_SUFFIXES = ["_other", "_one", "_zero", "_two", "_few", "_many"];
const PLURAL_SUFFIX_RE = /_(other|one|zero|two|few|many)$/;

function resolveWithPlural(nsData, key) {
  const direct = resolve(nsData, key);
  if (direct !== undefined) return direct;
  for (const suffix of PLURAL_SUFFIXES) {
    const v = resolve(nsData, `${key}${suffix}`);
    if (v !== undefined) return v;
  }
  return undefined;
}

// CALL-SHAPE: t('x') / t("x") / i18n.t('x') / i18nKey='x' / i18nKey="x".
// First string literal only; dynamic keys (backtick / interpolation) are skipped.
const REFERENCE_RE =
  /(?:\bi18n\.t|\bt|\bi18nKey\s*=)\s*(?:\(\s*)?(['"])([^'"]+)\1/g;

// VALUE-SHAPE: a quoted literal that is ENTIRELY `<ns>:<dotted.key>`, in any position.
// The namespace is validated against knownNamespaces() by the caller, not by this regex.
const NAMESPACED_LITERAL_RE =
  /(['"])([A-Za-z][A-Za-z0-9_]*:[A-Za-z][A-Za-z0-9_.]*)\1/g;

/** Split `ns:key` / bare `key` into [ns, key], applying the default namespace. */
function splitKey(raw) {
  const i = raw.indexOf(":");
  return i === -1 ? [DEFAULT_NS, raw] : [raw.slice(0, i), raw.slice(i + 1)];
}

/**
 * Every static key reference in src, as a Map of `ns:key` -> the file to blame.
 * Shared by verifyKeys() (which resolves them) and verifyOrphans() (which subtracts
 * them), so the two directions can never disagree about what "referenced" means.
 *
 * "The file to blame" prefers a non-test file: `misc:nav.messages` is referenced by
 * both NavSectionSwitcher.tsx and its .test.tsx, and pointing the failure at the test
 * sends the reader to the wrong place — the test is a witness, the component is the
 * caller. First non-test file wins; a test file is only kept if nothing else matches.
 */
const TEST_FILE_RE = /\.(test|spec)\.tsx?$|[/\\]test[/\\]/;

export function collectReferences() {
  const namespaces = knownNamespaces();
  const refs = new Map();

  const note = (ns, key, file) => {
    const id = `${ns}:${key}`;
    const prev = refs.get(id);
    if (prev === undefined) refs.set(id, file);
    else if (TEST_FILE_RE.test(prev) && !TEST_FILE_RE.test(file)) refs.set(id, file);
  };

  for (const { file, text } of readSources()) {
    REFERENCE_RE.lastIndex = 0;
    let m;
    while ((m = REFERENCE_RE.exec(text)) !== null) {
      const raw = m[2];
      // Skip anything that is clearly not a plain i18n key.
      if (raw.includes("${") || raw.includes("{{")) continue; // interpolated
      if (!/^[A-Za-z0-9_.:-]+$/.test(raw)) continue; // paths, urls, class names, etc.
      if (!raw.includes(":") && !raw.includes(".")) continue; // bare word — likely not a key
      const [ns, key] = splitKey(raw);
      note(ns, key, file);
    }

    NAMESPACED_LITERAL_RE.lastIndex = 0;
    while ((m = NAMESPACED_LITERAL_RE.exec(text)) !== null) {
      const raw = m[2];
      const [ns, key] = splitKey(raw);
      // The namespace gate is what makes a bare value-shape scan safe. A literal
      // whose prefix is not a locale file is not ours (`md:`, `node:`, `dms:` …).
      if (!namespaces.has(ns)) continue;
      note(ns, key, file);
    }
  }
  return refs;
}

export function verifyKeys() {
  const nsCache = new Map();
  const getNs = (ns) => {
    if (!nsCache.has(ns)) nsCache.set(ns, loadNs(ns));
    return nsCache.get(ns);
  };

  const misses = [];
  for (const [id, file] of collectReferences()) {
    const [ns, key] = splitKey(id);
    const nsData = getNs(ns);
    if (nsData === null) continue; // unknown ns — not one of ours (e.g. a route path)

    const value = resolveWithPlural(nsData, key);
    if (value === undefined) {
      misses.push({ ns, key, reason: "missing", file });
    } else if (typeof value === "string" && value.trim() === "") {
      misses.push({ ns, key, reason: "empty", file });
    }
  }
  return misses;
}

/** Flatten a locale namespace to dotted leaf keys. Arrays are leaves (returnObjects). */
function flattenKeys(obj, prefix = "", acc = []) {
  for (const [k, v] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flattenKeys(v, next, acc);
    else acc.push(next);
  }
  return acc;
}

/**
 * Every dotted identifier path in src, indexed once, so the orphan scan is a set
 * lookup per key instead of a substring search over a multi-megabyte haystack.
 * (The haystack version was correct and far too slow — it timed out the vitest
 * wrapper at 5s, because ~3k keys x ~3 prefixes x a ~5MB scan is tens of GB of
 * character comparison.)
 *
 * Two sets, because they license different conclusions:
 *
 *   exact         — the token as it actually appears (`misc:nav.messages`,
 *                   `entry.labelKey`). Spares ONLY that key.
 *   dynamicPrefix — a token immediately followed by a dot that does NOT begin
 *                   another identifier, i.e. the residue of an interpolated key
 *                   (`misc:nav.` from `` t(`misc:nav.${id}`) ``). Spares the whole
 *                   subtree beneath it.
 *
 * Keeping them apart is the point. If a plain static reference also seeded the
 * prefix set, one `misc:nav.messages` in the code would vouch for every `nav.*`
 * key in the locale and the orphan check would report nothing, forever.
 */
function indexSourceTokens() {
  const TOKEN_RE =
    /[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)?(?:\.[A-Za-z0-9_]+)*/g;
  const IDENT_CHAR = /[A-Za-z0-9_]/;
  const exact = new Set();
  const dynamicPrefix = new Set();

  for (const { text } of readSources()) {
    TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = TOKEN_RE.exec(text)) !== null) {
      const tok = m[0];
      exact.add(tok);
      const end = m.index + tok.length;
      if (text[end] === "." && !IDENT_CHAR.test(text[end + 1] ?? "")) {
        dynamicPrefix.add(tok);
      }
    }
  }
  return { exact, dynamicPrefix };
}

function loadOrphanBaseline() {
  if (!fs.existsSync(ORPHAN_BASELINE)) return new Set();
  const parsed = JSON.parse(fs.readFileSync(ORPHAN_BASELINE, "utf8"));
  return new Set(Object.keys(parsed.orphans ?? {}));
}

/**
 * Direction 2. Returns { orphans, stale }:
 *   orphans — defined in en/**.json, never referenced, NOT in the baseline (a failure)
 *   stale   — listed in the baseline but now referenced (also a failure; ratchet only shrinks)
 */
export function verifyOrphans() {
  const namespaces = [...knownNamespaces()];
  const refs = collectReferences();
  const { exact, dynamicPrefix } = indexSourceTokens();
  const baseline = loadOrphanBaseline();
  const orphans = [];
  const seenOrphan = new Set();

  for (const ns of namespaces) {
    const data = loadNs(ns);
    if (!data) continue;
    for (const leaf of flattenKeys(data)) {
      const key = leaf.replace(PLURAL_SUFFIX_RE, "");
      const id = `${ns}:${key}`;
      if (seenOrphan.has(id)) continue;

      if (refs.has(id)) continue; // statically referenced — done
      // Mentioned somewhere as a complete dotted token, qualified or bare.
      if (exact.has(id) || exact.has(key)) continue;

      // Conservative tolerance for runtime-assembled keys: if any ANCESTOR of this
      // key appears in source as a truncated prefix (`misc:nav.` left behind by
      // `` t(`misc:nav.${id}`) ``), the whole family is spared. This is the rule that
      // keeps dynamic key families out of the report, at the documented cost of
      // hiding a dead key that happens to sit inside a live family.
      const parts = key.split(".");
      let referenced = false;
      for (let i = parts.length - 1; i >= 1 && !referenced; i--) {
        const prefix = parts.slice(0, i).join(".");
        if (dynamicPrefix.has(`${ns}:${prefix}`) || dynamicPrefix.has(prefix)) referenced = true;
      }
      if (referenced) continue;

      seenOrphan.add(id);
      if (!baseline.has(id)) orphans.push({ ns, key, id });
    }
  }

  const stale = [...baseline].filter((id) => !seenOrphan.has(id));
  return { orphans, stale };
}

// Run as CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  let failed = false;

  const misses = verifyKeys();
  if (misses.length) {
    failed = true;
    console.error(`\n✗ ${misses.length} unresolved i18n key(s):\n`);
    for (const { ns, key, reason, file } of misses) {
      console.error(`  ${ns}:${key}  [${reason}]  (${path.relative(ROOT, file)})`);
    }
    console.error(
      `\nAdd each key's copy to src/i18n/locales/en/<ns>.json (and the zh mirror).\n`
    );
  }

  const { orphans, stale } = verifyOrphans();
  if (orphans.length) {
    failed = true;
    console.error(`\n✗ ${orphans.length} orphaned i18n key(s) — defined but never referenced:\n`);
    for (const { id } of orphans) console.error(`  ${id}`);
    console.error(
      `\nDelete the copy from en/ and zh/, or — if it is staged for a landing feature —` +
        `\nadd it to scripts/i18n-orphan-baseline.json with a reason.\n`
    );
  }
  if (stale.length) {
    failed = true;
    console.error(
      `\n✗ ${stale.length} stale entr(y/ies) in scripts/i18n-orphan-baseline.json —` +
        ` now referenced, so the waiver is obsolete:\n`
    );
    for (const id of stale) console.error(`  ${id}`);
    console.error(`\nRemove them from the baseline. The list may only shrink.\n`);
  }

  if (failed) process.exit(1);
  console.log(
    "✓ i18n: all referenced keys resolve to non-empty English copy; no new orphaned keys."
  );
}
