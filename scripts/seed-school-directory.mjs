#!/usr/bin/env node
/**
 * Seed public.schools + public.school_domains from College Scorecard + Hipolabs.
 *
 *   node scripts/seed-school-directory.mjs [--env .env] [--dry-run]
 *
 * - Scorecard API (https://api.data.gov/ed/collegescorecard/v1/schools) is the
 *   identity spine: IPEDS unitid, name, city, state, ownership, enrollment, and
 *   the school's website URL (parsed to a registrable domain). Needs a free key
 *   in SCORECARD_API_KEY (sign up at https://api.data.gov/signup).
 * - Hipolabs university-domains-list (US only) enriches extra email domains the
 *   single Scorecard URL misses, joined on normalized name or shared domain.
 * - Marks matched_university_id for schools whose domain is already an active
 *   tenant domain (Pitt, CMU) so the auth page's active-tenant branch works.
 *   Never writes to public.universities.
 * - Upserts on ipeds_unitid / domain with the service-role key. Idempotent.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY_RUN = args.includes("--dry-run");
const ENV_FILE = flag("--env") ?? ".env";

loadEnv(join(REPO_ROOT, ENV_FILE));

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SCORECARD_KEY = process.env.SCORECARD_API_KEY;
if (!SCORECARD_KEY) {
  console.error(`Missing SCORECARD_API_KEY (free key: https://api.data.gov/signup; env file: ${ENV_FILE})`);
  process.exit(1);
}
if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error(`Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (env file: ${ENV_FILE})`);
  process.exit(1);
}

const SCORECARD_URL = "https://api.data.gov/ed/collegescorecard/v1/schools";
const SCORECARD_FIELDS = [
  "id",
  "school.name",
  "school.school_url",
  "school.city",
  "school.state",
  "school.ownership",
  "latest.student.size",
].join(",");
const HIPOLABS_URL =
  "https://raw.githubusercontent.com/Hipo/university-domains-list/master/world_universities_and_domains.json";
const OWNERSHIP = { 1: "public", 2: "private_nonprofit", 3: "private_forprofit" };

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

/** "https://WWW.Example.edu/home" -> "example.edu"; null when unparseable. */
function registrableDomain(url) {
  if (!url) return null;
  let host = String(url).trim().toLowerCase();
  host = host.replace(/^[a-z]+:\/\//, "").split(/[/?#]/, 1)[0].split(":")[0];
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  if (!/^[a-z0-9.-]{1,255}\.[a-z]{2,}$/.test(host)) return null;
  // Keep the last two labels: the registrable domain for .edu and typical US TLDs.
  const labels = host.split(".");
  return labels.slice(-2).join(".");
}

/** Loose name key for the Scorecard <-> Hipolabs join. */
function nameKey(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|of|at|a)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchScorecard() {
  const out = [];
  let page = 0;
  for (;;) {
    const url =
      `${SCORECARD_URL}?api_key=${SCORECARD_KEY}&fields=${SCORECARD_FIELDS}` +
      `&per_page=100&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Scorecard fetch failed (page ${page}): ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    const json = await res.json();
    const results = json?.results ?? [];
    for (const r of results) {
      const unitid = r["id"];
      const name = r["school.name"];
      if (!unitid || !name) continue;
      out.push({
        ipeds_unitid: unitid,
        name,
        city: r["school.city"] || null,
        state: r["school.state"] || null,
        ownership: OWNERSHIP[r["school.ownership"]] ?? null,
        enrollment: r["latest.student.size"] ?? null,
        domain: registrableDomain(r["school.school_url"]),
      });
    }
    const total = json?.metadata?.total ?? 0;
    page++;
    if (page * 100 >= total || results.length === 0) break;
    if (page % 10 === 0) console.log(`  Scorecard: ${out.length}/${total} ...`);
  }
  return out;
}

async function fetchHipolabs() {
  const res = await fetch(HIPOLABS_URL);
  if (!res.ok) {
    console.warn(`Hipolabs fetch failed (${res.status}); continuing with Scorecard domains only.`);
    return [];
  }
  const all = await res.json();
  return all
    .filter((u) => u.country === "United States")
    .map((u) => ({
      name: u.name,
      domains: (u.domains ?? []).map((d) => registrableDomain(d)).filter(Boolean),
    }));
}

async function main() {
  console.log("Fetching College Scorecard institutions ...");
  const schools = await fetchScorecard();
  console.log(`Scorecard: ${schools.length} institutions.`);
  if (schools.length < 3000) {
    console.error("Suspiciously few Scorecard rows; API shape may have changed. Aborting.");
    process.exit(1);
  }

  console.log("Fetching Hipolabs US domain list ...");
  const hipolabs = await fetchHipolabs();
  console.log(`Hipolabs: ${hipolabs.length} US entries.`);

  // Domain map: domain -> unitid. Scorecard (the spine) claims domains first;
  // Hipolabs only adds domains for schools it can be joined to, and never
  // overwrites a Scorecard-claimed domain.
  const byName = new Map(schools.map((s) => [nameKey(s.name), s]));
  const byDomain = new Map(schools.filter((s) => s.domain).map((s) => [s.domain, s]));
  // Branch campuses often share the main campus's domain (e.g. OSU ATI on
  // osu.edu) - on conflict the largest-enrollment school (the main campus)
  // claims the domain.
  const byUnitid = new Map(schools.map((s) => [s.ipeds_unitid, s]));
  const domainToSchool = new Map(); // domain -> ipeds_unitid
  for (const s of schools) {
    if (!s.domain) continue;
    const held = byUnitid.get(domainToSchool.get(s.domain));
    if (!held || (s.enrollment ?? 0) > (held.enrollment ?? 0)) {
      domainToSchool.set(s.domain, s.ipeds_unitid);
    }
  }

  let hipoJoined = 0;
  let hipoDomainsAdded = 0;
  let hipoUnmatched = 0;
  for (const h of hipolabs) {
    const spine = byName.get(nameKey(h.name)) ?? h.domains.map((d) => byDomain.get(d)).find(Boolean);
    if (!spine) {
      hipoUnmatched++;
      continue;
    }
    hipoJoined++;
    for (const d of h.domains) {
      if (!domainToSchool.has(d)) {
        domainToSchool.set(d, spine.ipeds_unitid);
        hipoDomainsAdded++;
      }
    }
  }
  console.log(
    `Join: ${hipoJoined} Hipolabs entries matched (${hipoUnmatched} unmatched, skipped); ` +
      `${hipoDomainsAdded} extra domains added.`,
  );
  console.log(`Totals: ${schools.length} schools, ${domainToSchool.size} domains.`);

  if (DRY_RUN) {
    console.log(JSON.stringify(schools.slice(0, 5), null, 2));
    console.log(`[dry-run] would upsert ${schools.length} schools + ${domainToSchool.size} domains`);
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1. Schools (spine).
  const schoolRows = schools.map(({ domain: _d, ...row }) => row);
  for (let i = 0; i < schoolRows.length; i += 500) {
    const { error } = await supabase
      .from("schools")
      .upsert(schoolRows.slice(i, i + 500), { onConflict: "ipeds_unitid" });
    if (error) {
      console.error(`schools upsert failed at chunk ${i}: ${error.message}`);
      process.exit(1);
    }
  }
  console.log(`Upserted ${schoolRows.length} schools.`);

  // 2. Domains need schools.id, so read back the unitid -> id map.
  const unitidToId = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("schools")
      .select("id,ipeds_unitid")
      .range(from, from + 999);
    if (error) {
      console.error(`schools read-back failed: ${error.message}`);
      process.exit(1);
    }
    for (const r of data) unitidToId.set(r.ipeds_unitid, r.id);
    if (data.length < 1000) break;
  }

  const domainRows = [...domainToSchool.entries()]
    .map(([domain, unitid]) => ({ domain, school_id: unitidToId.get(unitid) }))
    .filter((r) => r.school_id);
  for (let i = 0; i < domainRows.length; i += 500) {
    const { error } = await supabase
      .from("school_domains")
      .upsert(domainRows.slice(i, i + 500), { onConflict: "domain" });
    if (error) {
      console.error(`school_domains upsert failed at chunk ${i}: ${error.message}`);
      process.exit(1);
    }
  }
  console.log(`Upserted ${domainRows.length} school domains.`);

  // 3. Bridge active tenants: mark matched_university_id where a directory
  //    domain is already an active universities.email_domains entry. Reads the
  //    tenant registry; never writes to it.
  const { data: unis, error: uniErr } = await supabase
    .from("universities")
    .select("id,email_domains")
    .eq("is_active", true);
  if (uniErr) {
    console.error(`universities read failed: ${uniErr.message}`);
    process.exit(1);
  }
  let bridged = 0;
  for (const u of unis ?? []) {
    for (const d of u.email_domains ?? []) {
      const unitid = domainToSchool.get(d.toLowerCase());
      if (!unitid) continue;
      const { error } = await supabase
        .from("schools")
        .update({ matched_university_id: u.id })
        .eq("ipeds_unitid", unitid);
      if (error) console.warn(`  bridge failed for ${d}: ${error.message}`);
      else bridged++;
    }
  }
  console.log(`Bridged ${bridged} active-tenant domains to matched_university_id.`);

  // Fixture check.
  const { data: fixture } = await supabase
    .from("school_domains")
    .select("domain,school_id,schools(name)")
    .eq("domain", "osu.edu")
    .maybeSingle();
  console.log("Fixture check (osu.edu):", JSON.stringify(fixture));
}

main();
