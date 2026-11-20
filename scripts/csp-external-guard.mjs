#!/usr/bin/env node
/**
 * CSP / external-resource regression guard.
 *
 * FAILS if the app references an external origin that vercel.json's Content-Security-
 * Policy would BLOCK at runtime — the class of bug that silently broke the brand fonts
 * on 2026-07-22 (a `@import url(fonts.googleapis.com/...)` in src/index.css that
 * `style-src 'self' 'unsafe-inline'` blocked with zero console signal, so every visitor
 * got fallback fonts). Self-hosting fixed that incident; THIS makes the fix permanent —
 * a re-introduced font @import, an un-allowlisted CDN <script>/<link>, an external font
 * `url()`, or a hardcoded third-party `fetch()` can't come back unnoticed.
 *
 * It is NOT a linter of taste — it only flags references the CSP genuinely doesn't cover,
 * by PARSING the live CSP from vercel.json and matching each reference against the exact
 * directive that governs it (scheme-sources like `img-src https:` and host wildcards like
 * `*.supabase.co` are honored). So the CSP is the single source of truth: widen the CSP
 * (deliberately, in the same commit) and the guard follows; leave it and the guard holds.
 *
 * SCOPE — deliberately high-signal, zero-baseline (the surfaces below are CLEAN today):
 *   1. Built HTML (dist/**.html): external <script src>, <link href> (stylesheet/preload/
 *      preconnect/icon/manifest), <img src>/<source>/srcset, and inline <style> url()s.
 *      These are browser-AUTO-LOADED sub-resources, so CSP truly applies.
 *   2. Built CSS (dist/**.css): `@import` (-> style-src) and external `url()` (fonts ->
 *      font-src, images -> img-src). `@import` to an external origin is exactly the font
 *      regression. `data:`/`blob:` url()s and their inlined SVG xmlns are ignored (not
 *      fetches).
 *   3. Source (src/**): literal external `fetch()` / `new WebSocket()` / `EventSource` /
 *      `sendBeacon` targets -> connect-src. (The minified JS bundle is NOT blanket-scanned:
 *      it's full of <a href> navigations, doc URLs, and library homepage strings that CSP
 *      never governs — scanning it would be a false-positive machine.)
 *
 * Requires a build: run `npm run build` first (CI runs this step right after Build).
 * Usage: node scripts/csp-external-guard.mjs   (exit 0 = clean, 1 = a blocked reference)
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

// Dirs are env-overridable so the guard is testable against fixtures; defaults are the
// real build + source.
const DIST = process.env.CSP_GUARD_DIST || "dist";
const SRC = process.env.CSP_GUARD_SRC || "src";
const VERCEL = process.env.CSP_GUARD_VERCEL || "vercel.json";

// The production origin(s) — absolute self-URLs (canonical/OG/self assets) are 'self',
// never an external fetch, so they must not trip the guard.
const SELF_HOSTS = new Set(["dormcheck.com", "www.dormcheck.com"]);
// XML/SVG namespace hosts that appear as `xmlns="http://www.w3.org/..."` inside inlined
// SVG — declarations, never fetched.
const NAMESPACE_HOSTS = new Set(["www.w3.org"]);

// ── Parse the CSP from vercel.json ────────────────────────────────────────────
function loadCsp() {
  const json = JSON.parse(readFileSync(VERCEL, "utf8"));
  let csp = null;
  for (const h of json.headers ?? []) {
    for (const kv of h.headers ?? []) {
      if (kv.key.toLowerCase() === "content-security-policy") csp = kv.value;
    }
  }
  if (!csp) throw new Error("No Content-Security-Policy header found in vercel.json");
  const directives = {};
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    directives[tokens[0].toLowerCase()] = tokens.slice(1);
  }
  return directives;
}

// Fetch-directive fallback chain to default-src (per the CSP spec) when a specific
// directive is absent.
function sourcesFor(directives, directive) {
  return directives[directive] ?? directives["default-src"] ?? [];
}

// Does `origin` (a {scheme, host} of an external reference) satisfy any source in
// `sources`? Honors scheme-sources (https:, wss:) and host wildcards (*.domain).
function allowedBy(sources, scheme, host) {
  if (SELF_HOSTS.has(host)) return true; // absolute self-URL
  for (const raw of sources) {
    const s = raw.trim();
    if (s === "'self'" || s === "'none'" || s === "'unsafe-inline'" || s.startsWith("'nonce-") || s.startsWith("'sha")) {
      continue; // keywords never match a cross-origin host
    }
    // scheme-source, e.g. `https:` `wss:` `data:` `blob:`
    if (/^[a-z]+:$/i.test(s)) {
      if (s.toLowerCase() === `${scheme}:`) return true;
      continue;
    }
    // host-source: [scheme://]host[:port][/path], host may lead with *.
    let src = s;
    let srcScheme = null;
    const schemeMatch = src.match(/^([a-z]+):\/\//i);
    if (schemeMatch) {
      srcScheme = schemeMatch[1].toLowerCase();
      src = src.slice(schemeMatch[0].length);
    }
    const srcHost = src.split(/[/:]/)[0].toLowerCase();
    if (srcScheme && srcScheme !== scheme) continue;
    if (srcHost.startsWith("*.")) {
      const suffix = srcHost.slice(1); // ".domain.tld"
      if (host === srcHost.slice(2) || host.endsWith(suffix)) return true;
    } else if (srcHost === host) {
      return true;
    }
  }
  return false;
}

// ── Extract external references from the build + source ───────────────────────
function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, exts, out);
    else if (exts.includes(extname(p))) out.push(p);
  }
  return out;
}

// Pull scheme+host out of a URL string; return null for relative / data / blob / self-relative.
function parseExternal(url) {
  const u = url.trim().replace(/^["'(]+|["')]+$/g, "");
  const m = u.match(/^(https?|wss?):\/\/([a-z0-9.-]+)/i);
  if (m) return { scheme: m[1].toLowerCase(), host: m[2].toLowerCase(), raw: u };
  const proto = u.match(/^\/\/([a-z0-9.-]+\.[a-z]{2,})/i); // protocol-relative
  if (proto) return { scheme: "https", host: proto[1].toLowerCase(), raw: u };
  return null;
}

const FONT_EXT = /\.(woff2?|ttf|otf|eot)(\?|#|$)/i;

const violations = [];
const directives = loadCsp();

function check(ref, directive, where) {
  const ext = parseExternal(ref);
  if (!ext) return;
  if (NAMESPACE_HOSTS.has(ext.host)) return; // XML/SVG namespace, not fetched
  if (allowedBy(sourcesFor(directives, directive), ext.scheme, ext.host)) return;
  violations.push({ host: ext.host, url: ext.raw.slice(0, 100), directive, where });
}

// 1) Built HTML
for (const f of walk(DIST, [".html"])) {
  const html = readFileSync(f, "utf8");
  // <script src=...>
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) check(m[1], "script-src", `${f} <script src>`);
  // <link href=...> — map rel -> directive
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const rel = (tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1] || "").toLowerCase();
    let dir = "style-src";
    if (rel.includes("preconnect") || rel.includes("dns-prefetch")) dir = "connect-src";
    else if (rel.includes("icon") || rel.includes("apple-touch")) dir = "img-src";
    else if (rel.includes("manifest")) dir = "manifest-src";
    else if (rel.includes("stylesheet") || rel.includes("preload") || rel.includes("prefetch") || rel.includes("modulepreload")) dir = "style-src";
    else continue; // canonical / alternate / author etc. are metadata, not fetched
    check(href, dir, `${f} <link rel=${rel || "?"}>`);
  }
  // <img src>, <source src/srcset>
  for (const m of html.matchAll(/<(?:img|source)\b[^>]*\b(?:src|srcset)\s*=\s*["']([^"']+)["']/gi)) {
    for (const part of m[1].split(",")) check(part.trim().split(/\s+/)[0], "img-src", `${f} <img/source>`);
  }
}

// helper: scan CSS text (from a .css file or an inline <style>) for @import + url()
function scanCss(text, label) {
  // @import "url"  /  @import url("url")
  for (const m of text.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi)) {
    check(m[1], "style-src", `${label} @import`);
  }
  // url(...) — skip data:/blob:/# and anchor fragments
  for (const m of text.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)) {
    const target = m[2].trim();
    if (/^(data:|blob:|#)/i.test(target)) continue;
    const ext = parseExternal(target);
    if (!ext) continue;
    // A url() is a font, image, cursor, or mask. Fonts are governed by font-src, the
    // rest by img-src. Route by extension so a re-introduced EXTERNAL FONT is caught by
    // font-src (self/data only) while legitimate external images pass img-src (https:).
    check(target, FONT_EXT.test(target) ? "font-src" : "img-src", `${label} url()`);
  }
}

// 2) Built CSS
for (const f of walk(DIST, [".css"])) scanCss(readFileSync(f, "utf8"), f);
// inline <style> blocks in built HTML
for (const f of walk(DIST, [".html"])) {
  for (const m of readFileSync(f, "utf8").matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) scanCss(m[1], `${f} <style>`);
}

// 3) Source: literal external fetch/WebSocket/EventSource/sendBeacon targets -> connect-src
for (const f of walk(SRC, [".ts", ".tsx", ".js", ".jsx"])) {
  const code = readFileSync(f, "utf8");
  for (const m of code.matchAll(/(?:fetch|new WebSocket|new EventSource|sendBeacon)\(\s*["'`]((?:https?|wss?):\/\/[a-z0-9.-]+[^"'`]*)["'`]/gi)) {
    check(m[1], "connect-src", `${f} fetch/ws literal`);
  }
}

// ── Report ────────────────────────────────────────────────────────────────────
if (violations.length) {
  console.error(`❌ CSP external-resource guard FAILED: ${violations.length} reference(s) the CSP would block:\n`);
  for (const v of violations) {
    console.error(`  ${v.host}`);
    console.error(`    ↳ ${v.where}`);
    console.error(`    ↳ blocked by \`${v.directive}\` (allows: ${sourcesFor(directives, v.directive).join(" ") || "(default-src)"})`);
    console.error(`    ↳ ${v.url}\n`);
  }
  console.error("Either SELF-HOST the resource (the 2026-07-22 fonts fix — preferred for");
  console.error("fonts/styles), or, if the third party is genuinely required, add its exact");
  console.error("origin to the matching directive in vercel.json's CSP IN THE SAME COMMIT.");
  console.error("Do not loosen a directive to a broad scheme-source (e.g. `style-src https:`)");
  console.error("to silence this — name the specific origin.");
  process.exit(1);
}

console.log("✅ CSP external-resource guard passed: no build reference is blocked by vercel.json's CSP.");
process.exit(0);
