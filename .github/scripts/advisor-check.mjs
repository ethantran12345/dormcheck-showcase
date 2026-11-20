// Daily Supabase advisor diff. Fetches security + performance advisors from the
// Management API, subtracts the committed baseline (docs/security/advisor-baseline.json),
// and tiers anything new:
//   Tier 1 (auto)  - mechanical findings with no RLS/exposure semantics -> `advisor-autofix`
//   Tier 2 (gated) - anything touching RLS / SECURITY DEFINER / auth / grants / exposure
//                    -> `advisor-review`, fixed only on Ethan's "@claude fix this" comment.
// Baselined findings never open issues; a clean run is silent (log-only).
//
// TWO CALLERS, TWO EXIT CONTRACTS. prod-watch.yml runs it daily over BOTH advisor
// types and always exits 0 (the workflow turns the JSON into issues). scripts/migration-gate.mjs
// runs it as step 4 of the release gate with ADVISOR_TYPES=security + FAIL_ON_NEW=1, where a
// new finding must STOP the promotion — that is the step that caught six real WARNs on
// 2026-08-06, and reporting them into a file nobody reads at release time is how they got
// promoted in the first place.
//
// Env: SUPABASE_ACCESS_TOKEN (required), PROJECT_REF (default abcdefghijklmnopqrst),
//      OUT (output JSON path, default /tmp/advisor-new.json),
//      ADVISOR_TYPES (comma list, default "security,performance"),
//      FAIL_ON_NEW=1 (exit 1 when anything is outside the baseline; default exit 0).
import { readFileSync, writeFileSync } from "node:fs";

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("SUPABASE_ACCESS_TOKEN is not set");
  process.exit(1);
}
const ref = process.env.PROJECT_REF || "abcdefghijklmnopqrst";
const out = process.env.OUT || "/tmp/advisor-new.json";
const TYPES = (process.env.ADVISOR_TYPES || "security,performance")
  .split(",").map((s) => s.trim()).filter(Boolean);
const FAIL_ON_NEW = process.env.FAIL_ON_NEW === "1";

// Names safe to auto-fix: additive, mechanical changes with no access-control
// semantics. `unused_index` is deliberately absent: its remediation is DROP INDEX,
// which is destructive and needs a workload/query-plan decision.
const TIER1_NAMES = new Set([
  "function_search_path_mutable",
  "unindexed_foreign_keys",
]);
// Safety net: even an allowlisted name goes to Tier 2 if its text smells like access control.
const RISKY = /\brls\b|security definer|security_definer|\bauth\b|\bgrant/i;

async function fetchLints(type) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/advisors/${type}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    throw new Error(`advisors/${type} -> HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const body = await res.json();
  // Tolerate shape variants: {lints:[...]}, {result:{lints:[...]}}, or a bare array.
  const lints = body.lints ?? body.result?.lints ?? (Array.isArray(body) ? body : null);
  if (!Array.isArray(lints)) throw new Error(`advisors/${type}: unexpected response shape`);
  return lints;
}

// Per-finding disambiguator for issue TITLES (the dedupe marker stays `key`).
// Several lints fire once per POLICY / per FK / per INDEX on the SAME entity, so
// "<title>: <entity>" collides. Every advisor `detail` names the discriminating
// object in backtick quotes (escaped as \` in the API payload); the entity itself
// is one of those tokens, so we keep the others:
//   auth_rls_initplan            -> the policy name
//   unindexed_foreign_keys       -> the constraint name
//   unused_index                 -> the index name
//   multiple_permissive_policies -> role, action
// Boilerplate tokens (`auth.<function>()`, `(select ...)`, `{a,b}` policy lists)
// are dropped. Empty string when the detail carries nothing extra — the caller
// falls back to a slice of the key.
function discriminator(detail, entity) {
  const bare = (entity || "").replace(/^public\./, "");
  return [...(detail || "").matchAll(/\\`([^`\\]+)\\`/g)]
    .map((m) => m[1])
    .filter((t) => t !== entity && t !== bare)
    .filter((t) => !t.startsWith("{") && !t.startsWith("(") && !t.includes("<function>"))
    .join(", ");
}

const baseline = JSON.parse(readFileSync("docs/security/advisor-baseline.json", "utf8"));
const accepted = new Set(baseline.accepted.map((e) => e.key));

const tier1 = [];
const tier2 = [];
for (const type of TYPES) {
  for (const l of await fetchLints(type)) {
    const key = `${type}:${l.cache_key}`;
    if (accepted.has(key)) continue;
    const m = l.metadata || {};
    const entity = m.name ? `${m.schema || "public"}.${m.name}` : null;
    const finding = {
      key,
      type,
      name: l.name,
      level: l.level,
      title: l.title,
      entity,
      // Title disambiguator only — dedupe is by `key`, never by title.
      // May be "" here; the collision pass below fills it from the key if needed.
      discriminator: discriminator(l.detail, entity),
      detail: l.detail,
      remediation: l.remediation,
    };
    const risky = RISKY.test(`${l.name} ${l.title} ${l.detail || ""}`);
    (TIER1_NAMES.has(l.name) && !risky ? tier1 : tier2).push(finding);
  }
}

// Last-resort disambiguation: a lint whose `detail` named nothing beyond the entity
// (rls_enabled_no_policy, extension_in_public, ...) is normally one-per-entity, so its
// title is already unique and stays clean. Only if two such findings would land on the
// SAME title do we append a slice of the key — the tail, because every key starts with
// the constant "<type>:<lint_name>_" prefix and only the tail distinguishes.
{
  const byTitle = new Map();
  for (const f of [...tier1, ...tier2]) {
    const t = `${f.title}|${f.entity}|${f.discriminator}`;
    byTitle.set(t, (byTitle.get(t) || 0) + 1);
  }
  for (const f of [...tier1, ...tier2]) {
    if (!f.discriminator && byTitle.get(`${f.title}|${f.entity}|`) > 1) {
      f.discriminator = f.key.slice(-8);
    }
  }
}

writeFileSync(out, JSON.stringify({ tier1, tier2 }, null, 2));
console.log(
  `advisor-check (${TYPES.join("+")}): ${tier1.length} tier-1 (auto), ${tier2.length} tier-2 (gated), ` +
    `${accepted.size} baselined. ${tier1.length + tier2.length === 0 ? "Nothing new - silent run." : ""}`
);
for (const f of [...tier1, ...tier2]) console.log(`  NEW [${f.level}] ${f.key}`);

if (FAIL_ON_NEW && tier1.length + tier2.length > 0) {
  console.error(
    `\n${tier1.length + tier2.length} advisor finding(s) are not in docs/security/advisor-baseline.json.` +
      `\nFix them, or add each key above to the baseline WITH a reason. Never add one just to go green.`
  );
  process.exit(1);
}
