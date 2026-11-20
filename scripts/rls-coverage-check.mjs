// RLS-coverage ratchet. Fails if any PostgREST-exposed table has Row-Level
// Security DISABLED while carrying a grant to anon / authenticated / PUBLIC — i.e.
// a table any signed-in (or anonymous) client can read or write with no per-row
// gate. This is the systematic coverage check the per-feature RLS tests
// (tenant_isolation, message_reactions_rls, …) do NOT give: those prove a specific
// table's policies are correct; this proves NO exposed table slipped through with
// RLS off at all.
//
// Same ratchet contract as scripts/typecheck-ratchet.sh and npm-audit-ratchet.sh:
// the offending set is diffed against a committed known-good baseline
// (docs/security/rls-coverage-baseline.json, seeded EMPTY from live prod on
// 2026-07-22), so coverage can only improve. Anything offending that is NOT in the
// baseline's `accepted` list is a regression → exit 1.
//
// Reaches the live schema through the Supabase Management API
// (POST /v1/projects/{ref}/database/query) with SUPABASE_ACCESS_TOKEN — the exact
// auth model advisor-check.mjs uses. No direct DB connection / psql needed, so it
// runs anywhere a token is present. RLS coverage is a property of the DEPLOYED
// schema, which is why this runs daily (prod-watch.yml), not on the fast trunk
// push gate.
//
// Env: SUPABASE_ACCESS_TOKEN (required), PROJECT_REF (default abcdefghijklmnopqrst).
import { readFileSync } from "node:fs";

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token && !process.env.RLS_FIXTURE_ROWS) {
  console.error("SUPABASE_ACCESS_TOKEN is not set");
  process.exit(1);
}
const ref = process.env.PROJECT_REF || "abcdefghijklmnopqrst";

// Ordinary tables (relkind 'r' — RLS does not apply to views) in the exposed
// `public` schema, RLS off, with a table-level grant reachable by an untrusted
// client. The PUBLIC pseudo-role is included because a grant to PUBLIC implicitly
// reaches anon and authenticated.
const OFFENDING_SQL = `
  SELECT c.relname AS table_name,
         array_agg(DISTINCT g.grantee ORDER BY g.grantee)         AS granted_to,
         array_agg(DISTINCT g.privilege_type ORDER BY g.privilege_type) AS privileges
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN information_schema.role_table_grants g
    ON g.table_schema = n.nspname AND g.table_name = c.relname
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relrowsecurity = false
    AND g.grantee IN ('anon', 'authenticated', 'PUBLIC')
  GROUP BY c.relname
  ORDER BY c.relname;
`;

async function runSql(query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );
  if (!res.ok) {
    throw new Error(`database/query -> HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  return res.json();
}

const baseline = JSON.parse(readFileSync("docs/security/rls-coverage-baseline.json", "utf8"));
const accepted = new Set((baseline.accepted || []).map((e) => e.table));

// Fixture-injection hook (testability — same pattern as CSP_GUARD_DIST / WIP_PATHS):
// RLS_FIXTURE_ROWS holds a JSON array of {table_name,granted_to,privileges} to stand in
// for the live query, so the ratchet's fail-on-regression contract can be proven offline
// without a Management API token. Never set in CI — production runs hit the real schema.
let rows;
if (process.env.RLS_FIXTURE_ROWS) {
  rows = JSON.parse(process.env.RLS_FIXTURE_ROWS);
} else {
  rows = await runSql(OFFENDING_SQL);
}
const offending = Array.isArray(rows) ? rows : rows.result ?? [];

const regressions = offending.filter((r) => !accepted.has(r.table_name));

if (regressions.length > 0) {
  console.error(
    `❌ RLS-coverage ratchet FAILED: ${regressions.length} exposed table(s) with RLS OFF and an anon/authenticated/PUBLIC grant, not in the baseline:`
  );
  for (const r of regressions) {
    console.error(
      `  - public.${r.table_name}  (granted to: ${(r.granted_to || []).join(", ")}; privileges: ${(r.privileges || []).join(", ")})`
    );
  }
  console.error("");
  console.error("Enable RLS on the table and add policies (ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;),");
  console.error("or, if it is a genuinely public reference table that is safe RLS-free, add it to");
  console.error("docs/security/rls-coverage-baseline.json `accepted` with a reason IN THE SAME COMMIT.");
  process.exit(1);
}

// Machine-readable line the workflow greps to build the issue body on regression.
console.log(
  `RLS-COVERAGE: ok — 0 regressions, ${offending.length} offending total, ${accepted.size} baselined.`
);
process.exit(0);
