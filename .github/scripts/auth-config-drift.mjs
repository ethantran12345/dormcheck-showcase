// Auth-config drift watchdog. READ-ONLY: fetches the live hosted Supabase auth
// config from the Management API and diffs a chosen set of login-critical fields
// against the committed snapshot (docs/security/auth-config-expected.json).
// It NEVER writes config - hosted auth is set in the Supabase Dashboard only.
// This exists because on 2026-07-17 a `supabase config push` silently overwrote
// PROD auth settings (site URL -> localhost, wiped redirect allowlist, rate limit
// -> 2/hr). Nothing was watching. Now something is.
//
// Modes:
//   Report/seed - when the snapshot is unseeded (`_status` !== "seeded") or REPORT=1:
//     print the full live config + a ready-to-paste `watch` block and exit 0 without
//     diffing or opening issues. Use this to seed the snapshot from live values.
//   Diff - normal run: compare each key in the snapshot's `watch` map to live; emit
//     the drift list. A clean run is silent; the workflow opens ONE deduped issue.
//
// Env: SUPABASE_ACCESS_TOKEN (required unless CONFIG_FILE is set - a Supabase personal
//        access token, same secret the advisor step of prod-watch.yml uses),
//      PROJECT_REF (default abcdefghijklmnopqrst),
//      EXPECTED (snapshot path, default docs/security/auth-config-expected.json),
//      OUT (result JSON path, default /tmp/auth-config-drift.json),
//      REPORT=1 (force report/seed mode),
//      CONFIG_FILE (read live config from a local JSON file instead of the network -
//        offline testing only; no token needed).
import { readFileSync, writeFileSync } from "node:fs";

const ref = process.env.PROJECT_REF || "abcdefghijklmnopqrst";
const expectedPath =
  process.env.EXPECTED || "docs/security/auth-config-expected.json";
const out = process.env.OUT || "/tmp/auth-config-drift.json";
const configFile = process.env.CONFIG_FILE;
const forceReport = process.env.REPORT === "1";

// Fields the handoff calls out as login-critical, used only to build the suggested
// `watch` block in report mode. The actual watched set is whatever the snapshot lists.
const SUGGESTED = [
  ["site_url", "Site URL"],
  ["uri_allow_list", "Redirect URL allowlist"],
  ["disable_signup", "Signups disabled"],
  ["mailer_autoconfirm", "Email auto-confirm (skips verification)"],
  ["mailer_otp_exp", "Email OTP / magic-link expiry (s)"],
  ["mailer_otp_length", "Email OTP length"],
  ["sms_otp_exp", "SMS OTP expiry (s)"],
  ["jwt_exp", "Access-token (JWT) expiry (s)"],
  ["refresh_token_rotation_enabled", "Refresh-token rotation"],
  ["security_refresh_token_reuse_interval", "Refresh-token reuse interval (s)"],
  ["sessions_inactivity_timeout", "Session inactivity timeout (s)"],
  ["sessions_timebox", "Session absolute timeout (s)"],
  ["security_captcha_enabled", "CAPTCHA on auth endpoints"],
  ["mailer_secure_email_change_enabled", "Secure email change (confirm both addresses)"],
  ["rate_limit_email_sent", "Emails sent / hour"],
  ["rate_limit_verify", "Verification (login) attempts / 5min"],
  ["rate_limit_token_refresh", "Token refreshes / 5min"],
  ["rate_limit_otp", "OTPs / 5min"],
  ["rate_limit_sms_sent", "SMS sent / hour"],
  ["rate_limit_anonymous_users", "Anonymous sign-ins / hour"],
  ["external_email_enabled", "Provider: email"],
  ["external_phone_enabled", "Provider: phone"],
  ["external_anonymous_users_enabled", "Provider: anonymous"],
  ["external_google_enabled", "Provider: Google"],
  ["external_apple_enabled", "Provider: Apple"],
  ["external_azure_enabled", "Provider: Azure"],
  ["external_github_enabled", "Provider: GitHub"],
];

async function fetchConfig() {
  if (configFile) return JSON.parse(readFileSync(configFile, "utf8"));
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.error("SUPABASE_ACCESS_TOKEN is not set (and no CONFIG_FILE given)");
    process.exit(1);
  }
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/config/auth`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    throw new Error(
      `config/auth -> HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`
    );
  }
  return res.json();
}

// Redirect allowlist arrives as a comma-separated string; compare membership, not
// order/formatting, so a reorder isn't false drift but an add/remove is caught.
function normalizeList(v) {
  if (v === undefined || v === null) return v;
  const arr = Array.isArray(v) ? v : String(v).split(",");
  return arr.map((s) => s.trim()).filter(Boolean).sort();
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const live = await fetchConfig();
const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
const watch = expected.watch || {};
const seeded = expected._status === "seeded" && Object.keys(watch).length > 0;

if (forceReport || !seeded) {
  // Report/seed mode: surface everything, decide nothing.
  const suggested = {};
  for (const [key, label] of SUGGESTED) {
    if (key in live) {
      const val = key === "uri_allow_list" ? normalizeList(live[key]) : live[key];
      suggested[key] = { value: val, label };
    }
  }
  console.log(
    `auth-config-drift: ${forceReport ? "REPORT mode" : "snapshot unseeded"} - ` +
      "no diff, no issues. Live login-critical fields below; paste into " +
      `${expectedPath} -> "watch" and set "_status":"seeded" once confirmed.\n`
  );
  console.log("--- suggested watch block ---");
  console.log(JSON.stringify(suggested, null, 2));
  // Never print provider/SMTP secrets into the Actions log.
  const SECRET_KEY = /secret|password|smtp_pass|private_key/i;
  const redacted = {};
  for (const [k, v] of Object.entries(live)) {
    redacted[k] = SECRET_KEY.test(k) && v ? "***REDACTED***" : v;
  }
  console.log("\n--- full live auth config (secrets redacted) ---");
  console.log(JSON.stringify(redacted, null, 2));
  writeFileSync(out, JSON.stringify({ seeded: false, drift: [], live }, null, 2));
  process.exit(0);
}

// Diff mode.
const drift = [];
for (const [field, spec] of Object.entries(watch)) {
  const present = field in live;
  let e = spec.value;
  let a = present ? live[field] : undefined;
  if (field === "uri_allow_list") {
    e = normalizeList(e);
    a = present ? normalizeList(a) : undefined;
  }
  if (!eq(e, a)) {
    drift.push({
      field,
      label: spec.label || field,
      expected: e,
      actual: present ? a : "(missing from live config)",
    });
  }
}

writeFileSync(out, JSON.stringify({ seeded: true, drift }, null, 2));
console.log(
  `auth-config-drift: checked ${Object.keys(watch).length} fields, ` +
    `${drift.length} drifted.${drift.length === 0 ? " Clean - silent run." : ""}`
);
for (const d of drift) {
  console.log(
    `  DRIFT ${d.field}: expected ${JSON.stringify(d.expected)} != actual ${JSON.stringify(d.actual)}`
  );
}
