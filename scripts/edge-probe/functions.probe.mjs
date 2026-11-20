/**
 * The six Edge Functions nobody drove over HTTP, DRIVEN — against a live local stack
 * (BA-09, docs/audits/backend-audit-2026-09-06.md).
 *
 * WHY THIS PROBE EXISTS
 * ---------------------
 * scripts/test-edge.sh drives moderate-listing and scripts/test-edge-push.sh drives
 * send-push. The other six functions — admin-metrics, delete-user-account,
 * export-user-data, fetch-link-preview, send-auth-email, moderate-image — carried
 * GDPR paths, the auth-email hook, an SSRF guard and a CSAM quarantine with zero
 * HTTP-level coverage. test-db.sh's own header says why a DB probe cannot stand in:
 * "the schema is right and the CALLER is wrong" is invisible to it.
 *
 * WHAT IS REAL HERE. Every function runs in the real edge runtime through Kong,
 * verifies real GoTrue tokens against the real JWKS, reads and writes through the real
 * PostgREST + Storage APIs into the real schema (including the 20261005–20261008
 * migrations). The ONLY substitutions are the paid vendors: OpenAI omni-moderation
 * and Resend are pinned to deterministic answers by scripts/edge-probe/stub-vendor-api.mjs.
 *
 * TWO PHASES, because one `functions serve` cannot be both: fetch-link-preview and
 * moderate-image are gated at the gateway (verify_jwt = true in their config.toml) and
 * are driven with verification ON, so "no token → 401" is Kong's verdict as in prod;
 * the other four verify the token in-function and are deployed verify_jwt:false, so
 * they are driven with `--no-verify-jwt`, exactly the shape send-push's gate uses.
 *
 * Conventions borrowed from scripts/test-db.sh and the sibling probes on purpose:
 * print a PASS/FAIL token per assertion, and let the runner assert a MINIMUM verdict
 * count. Silence is not success.
 *
 * Run it through scripts/test-edge-functions.sh; it needs env this script does not set.
 */
import { createHash, createHmac } from "node:crypto";

const API_URL = need("SUPABASE_API_URL");
const ANON_KEY = need("SUPABASE_ANON_KEY");
const SERVICE_KEY = need("SUPABASE_SERVICE_ROLE_KEY");
const STUB_HOST_URL = need("STUB_HOST_URL");
const PHASE = need("PROBE_PHASE"); // gateway | nogateway
const HOOK_SECRET_B64 = need("PROBE_HOOK_SECRET_B64");

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`FAIL: ${name} is not set — run this through scripts/test-edge-functions.sh`);
    process.exit(2);
  }
  return v;
}

const PITT = "00000000-0000-4000-8000-000000000001";
const PASSWORD = "FunctionsProbe!Passw0rd1";
const USERS = {
  student: { email: "probe-fn-student@pitt.edu", role: "user" },
  other: { email: "probe-fn-other@pitt.edu", role: "user" },
  uadmin: { email: "probe-fn-uadmin@pitt.edu", role: "university_admin" },
  superadmin: { email: "probe-fn-superadmin@pitt.edu", role: "superadmin" },
  victim: { email: "probe-fn-victim@pitt.edu", role: "user" },
};

let passes = 0;
let failures = 0;
function assert(ok, label, detail = "") {
  if (ok) {
    passes += 1;
    console.log(`PASS ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── thin REST helpers (no SDK, on purpose — see moderate-listing.probe.mjs) ──────
async function rest(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${API_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
      Prefer: method === "POST" ? "return=representation" : "return=minimal",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* surfaced via text */ }
  return { status: res.status, json, text };
}

async function admin(path, { method = "POST", body } = {}) {
  const res = await fetch(`${API_URL}/auth/v1/${path}`, {
    method,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  return { status: res.status, json, text };
}

async function signIn(email) {
  const res = await fetch(`${API_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(json).slice(0, 200)}`);
  return json.access_token;
}

async function fn(slug, { method = "POST", jwt, body, query = "", headers = {}, raw } = {}) {
  const res = await fetch(`${API_URL}/functions/v1/${slug}${query}`, {
    method,
    headers: {
      ...(jwt ? { Authorization: `Bearer ${jwt}`, apikey: ANON_KEY } : {}),
      ...(raw === undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  return { status: res.status, json, text };
}

async function storagePut(bucket, path, bytes, contentType = "image/jpeg") {
  const res = await fetch(`${API_URL}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "content-type": contentType, "x-upsert": "true" },
    body: bytes,
  });
  return { status: res.status, text: await res.text() };
}

async function storageList(bucket, prefix) {
  const res = await fetch(`${API_URL}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ prefix, limit: 100 }),
  });
  const json = await res.json().catch(() => []);
  return Array.isArray(json) ? json : [];
}

async function storageRemove(bucket, paths) {
  if (!paths.length) return;
  await fetch(`${API_URL}/storage/v1/object/${bucket}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ prefixes: paths }),
  });
}

// A 1x1 white JPEG. The stub never looks at bytes; the marker rides in the PATH.
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==",
  "base64",
);

// ── fixtures ─────────────────────────────────────────────────────────────────
const ids = {};
async function ensureUser(key) {
  const u = USERS[key];
  // Idempotent: a previous aborted run may have left the user behind.
  const existing = await admin(`admin/users?page=1&per_page=1000`, { method: "GET" });
  const found = (existing.json?.users ?? []).find((x) => x.email === u.email);
  let id = found?.id;
  if (!id) {
    const created = await admin("admin/users", { body: { email: u.email, password: PASSWORD, email_confirm: true } });
    if (!created.json?.id) throw new Error(`could not create ${u.email}: ${created.text.slice(0, 200)}`);
    id = created.json.id;
  }
  ids[key] = id;
  // The role write goes through the service role, which protect_profile_role() exempts.
  const upd = await rest(`profiles?id=eq.${id}`, {
    method: "PATCH",
    body: { role: u.role, university_id: PITT, full_name: `Probe ${key}`, email: u.email },
  });
  if (upd.status >= 300) throw new Error(`profile update failed for ${key}: ${upd.status} ${upd.text.slice(0, 200)}`);
  return id;
}

async function deleteUserQuietly(id) {
  if (!id) return;
  await admin(`admin/users/${id}`, { method: "DELETE" });
}

// ── standardwebhooks signing (what Supabase Auth does before calling the hook) ──
function signWebhook(body, secretB64, { msgId = "msg_probe_fn", timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const key = Buffer.from(secretB64, "base64");
  const sig = createHmac("sha256", key).update(`${msgId}.${timestamp}.${body}`).digest("base64");
  return { "webhook-id": msgId, "webhook-timestamp": String(timestamp), "webhook-signature": `v1,${sig}` };
}

// ═══ phase: gateway (verify_jwt ON) — fetch-link-preview + moderate-image ═══════
async function phaseGateway() {
  await ensureUser("student");
  const jwt = await signIn(USERS.student.email);

  // fetch-link-preview: the gateway refuses without a token; the guard refuses every
  // private / loopback / non-http / credentialed target with a 400 that names the reason.
  {
    const r = await fn("fetch-link-preview", { body: { url: "http://example.com/" } });
    assert(r.status === 401, "flp/gateway refuses an unauthenticated call", `got ${r.status}`);
  }
  const blocked = [
    ["http://127.0.0.1/", /blocked/i, "loopback IPv4"],
    ["http://169.254.169.254/latest/meta-data/", /blocked/i, "link-local metadata"],
    ["http://10.0.0.1/", /blocked/i, "RFC1918"],
    ["http://[::1]/", /blocked/i, "loopback IPv6"],
    ["http://localhost:8080/", /port|blocked/i, "localhost + non-standard port"],
    ["ftp://example.com/x", /http/i, "non-http scheme"],
    ["http://user:pw@example.com/", /credential/i, "credentials in URL"],
  ];
  for (const [url, re, label] of blocked) {
    const r = await fn("fetch-link-preview", { jwt, body: { url } });
    assert(r.status === 400 && re.test(r.json?.error ?? ""), `flp/ssrf refuses ${label}`, `got ${r.status} ${r.text.slice(0, 120)}`);
  }
  {
    const r = await fn("fetch-link-preview", { jwt, body: {} });
    assert(r.status === 400 && /required/i.test(r.json?.error ?? ""), "flp/validation refuses a body without url", `got ${r.status} ${r.text.slice(0, 120)}`);
  }

  // moderate-image: gateway, then validation, then the quarantine path end to end.
  {
    const r = await fn("moderate-image", { body: { image_urls: ["x"], context: "setup_photo" } });
    assert(r.status === 401, "mi/gateway refuses an unauthenticated call", `got ${r.status}`);
  }
  {
    const r = await fn("moderate-image", { jwt, body: {} });
    assert(r.status === 400 && /image_urls/.test(r.json?.error ?? ""), "mi/validation refuses a body without image_urls", `got ${r.status} ${r.text.slice(0, 120)}`);
  }
  {
    const r = await fn("moderate-image", { jwt, body: { image_urls: ["https://evil.example/x.jpg"], context: "setup_photo" } });
    assert(r.status === 400 && /storage URLs/.test(r.json?.error ?? ""), "mi/ssrf refuses a URL outside this project's public storage", `got ${r.status} ${r.text.slice(0, 120)}`);
  }
  {
    const r = await fn("moderate-image", { jwt, body: { image_urls: [`${API_URL}/storage/v1/object/public/setup-photos/x.jpg`], context: "not_a_surface" } });
    assert(r.status === 400 && /context/.test(r.json?.error ?? ""), "mi/validation refuses an unknown context", `got ${r.status} ${r.text.slice(0, 120)}`);
  }
  {
    const five = Array.from({ length: 5 }, (_, i) => `${API_URL}/storage/v1/object/public/setup-photos/${ids.student}/DCPROBE_CLEAN-${i}.jpg`);
    const r = await fn("moderate-image", { jwt, body: { image_urls: five, context: "setup_photo" } });
    assert(r.status === 400 && /at most 4/.test(r.json?.error ?? ""), "mi/validation refuses more than MAX_IMAGES per call", `got ${r.status} ${r.text.slice(0, 120)}`);
  }

  // The quarantine path. The marker rides in the object PATH, which OpenAI would fetch
  // and the stub reads out of the request body.
  const cleanPath = `${ids.student}/DCPROBE_CLEAN.jpg`;
  const severePath = `${ids.student}/DCPROBE_SEVERE.jpg`;
  const up1 = await storagePut("setup-photos", cleanPath, TINY_JPEG);
  const up2 = await storagePut("setup-photos", severePath, TINY_JPEG);
  assert(up1.status < 300 && up2.status < 300, "mi/fixture two objects uploaded to setup-photos", `${up1.status} ${up1.text.slice(0, 80)} / ${up2.status} ${up2.text.slice(0, 80)}`);
  const publicUrl = (p) => `${API_URL}/storage/v1/object/public/setup-photos/${p}`;

  {
    const r = await fn("moderate-image", { jwt, body: { image_urls: [publicUrl(cleanPath)], context: "setup_photo" } });
    assert(r.status === 200 && r.json?.decision === "approve", "mi/approve a clean image is approved", `got ${r.status} ${r.text.slice(0, 160)}`);
    const still = await storageList("setup-photos", ids.student);
    assert(still.some((o) => o.name === "DCPROBE_CLEAN.jpg"), "mi/approve the approved object stays where it was");
  }
  const before = new Date();
  {
    const r = await fn("moderate-image", { jwt, body: { image_urls: [publicUrl(severePath)], context: "setup_photo", content_id: ids.student } });
    assert(r.status === 200 && r.json?.decision === "reject", "mi/reject a severe image is rejected", `got ${r.status} ${r.text.slice(0, 160)}`);
    assert(r.json?.quarantined === 1, "mi/reject the response reports one object quarantined", `got ${JSON.stringify(r.json)}`);
    const gone = await storageList("setup-photos", ids.student);
    assert(!gone.some((o) => o.name === "DCPROBE_SEVERE.jpg"), "mi/reject the rejected object is no longer in the public bucket");
    // The audit row is the map to where the object went: the quarantine path keeps the
    // source's `<user>/<file>` shape under `<day>/<context>/<bucket>/<stamp>-`, and the
    // Storage list API is one level deep, so list the folder the row names.
    const rows = await rest(`moderation_actions?action=eq.auto_reject_image&content_id=eq.${ids.student}&order=created_at.desc&limit=1&select=quarantine_path,preserve_until,content_type`);
    const row = rows.json?.[0];
    assert(!!row?.quarantine_path && row.quarantine_path.includes("DCPROBE_SEVERE.jpg"), "mi/reject the audit row carries the quarantine path", JSON.stringify(row));
    const qPath = row?.quarantine_path ?? "";
    const qDir = qPath.slice(0, qPath.lastIndexOf("/"));
    const qFile = qPath.slice(qPath.lastIndexOf("/") + 1);
    const day = before.toISOString().slice(0, 10);
    const held = qPath ? await storageList("images-quarantine", qDir) : [];
    assert(qPath.startsWith(`${day}/setup_photo/setup-photos/`) && held.some((o) => o.name === qFile), "mi/reject the rejected object is in images-quarantine at the recorded path", `path=${qPath} saw ${JSON.stringify(held.map((o) => o.name))}`);
    const until = row?.preserve_until ? new Date(row.preserve_until) : null;
    const days = until ? (until.getTime() - before.getTime()) / 86_400_000 : 0;
    assert(days >= 365 && days <= 367, "mi/reject the audit row carries a one-year preservation clock", `preserve_until=${row?.preserve_until} (${days.toFixed(2)} days)`);
    // clean up what this phase created (quarantine objects are service-role only, which is us)
    if (qPath) await storageRemove("images-quarantine", [qPath]);
    await rest(`moderation_actions?action=eq.auto_reject_image&content_id=eq.${ids.student}`, { method: "DELETE" });
  }
  // A2: a HOLD is deleted server-side (not left for the client), recorded, and never
  // quarantined unless it carries sexual/minors (unit-tested in src/test/quarantine.test.ts;
  // that category is severe today, so no stub verdict can produce such a hold).
  {
    const heldPath = `${ids.student}/DCPROBE_MODERATE.jpg`;
    const up = await storagePut("setup-photos", heldPath, TINY_JPEG);
    assert(up.status < 300, "mi/hold fixture uploaded", `${up.status} ${up.text.slice(0, 80)}`);
    const r = await fn("moderate-image", { jwt, body: { image_urls: [publicUrl(heldPath)], context: "setup_photo", content_id: ids.student } });
    assert(r.status === 200 && r.json?.decision === "hold", "mi/hold a moderate image is held", `got ${r.status} ${r.text.slice(0, 160)}`);
    assert(r.json?.quarantined === undefined, "mi/hold nothing is reported quarantined", JSON.stringify(r.json));
    const left = await storageList("setup-photos", ids.student);
    assert(!left.some((o) => o.name === "DCPROBE_MODERATE.jpg"), "mi/hold the server deleted the held object from the public bucket");
    const rows = await rest(`moderation_actions?action=eq.auto_hold_image&content_id=eq.${ids.student}&order=created_at.desc&limit=1&select=quarantine_path,preserve_until,reason`);
    const row = rows.json?.[0];
    assert(!!row && row.quarantine_path === null && row.preserve_until === null && /deleted 1 object/.test(row.reason ?? ""), "mi/hold an auto_hold_image row records the delete with no quarantine path", JSON.stringify(row));
    await rest(`moderation_actions?action=eq.auto_hold_image&content_id=eq.${ids.student}`, { method: "DELETE" });
  }
  await storageRemove("setup-photos", [cleanPath, severePath]);
}

// ═══ phase: nogateway (--no-verify-jwt) — admin-metrics, export, delete, auth email ═══
async function phaseNoGateway() {
  for (const k of ["student", "other", "uadmin", "superadmin", "victim"]) await ensureUser(k);
  const jwt = {
    student: await signIn(USERS.student.email),
    uadmin: await signIn(USERS.uadmin.email),
    superadmin: await signIn(USERS.superadmin.email),
    victim: await signIn(USERS.victim.email),
  };

  // admin-metrics
  {
    const r = await fn("admin-metrics", { method: "GET" });
    assert(r.status === 401, "am/auth refuses a call with no token", `got ${r.status}`);
  }
  {
    const r = await fn("admin-metrics", { method: "GET", jwt: jwt.student });
    assert(r.status === 403, "am/auth refuses a plain student", `got ${r.status} ${r.text.slice(0, 100)}`);
  }
  {
    const r = await fn("admin-metrics", { method: "GET", jwt: jwt.superadmin });
    assert(r.status === 200 && typeof r.json?.metrics?.totalUsers === "number", "am/superadmin gets platform metrics", `got ${r.status} ${r.text.slice(0, 120)}`);
  }
  {
    const r = await fn("admin-metrics", { method: "GET", jwt: jwt.uadmin });
    assert(r.status === 200 && typeof r.json?.metrics?.totalUsers === "number", "am/university_admin gets metrics scoped to their school", `got ${r.status} ${r.text.slice(0, 120)}`);
  }
  {
    const r = await fn("admin-metrics", { method: "GET", jwt: jwt.superadmin, query: "?university=not-a-uuid" });
    assert(r.status === 400, "am/validation refuses a malformed university parameter", `got ${r.status}`);
  }

  // export-user-data: only the caller's rows, ever.
  const mine = await rest("marketplace_listings", { method: "POST", body: { user_id: ids.student, title: "DCPROBEFN mine", price: 1, category: "other", university_id: PITT } });
  const theirs = await rest("marketplace_listings", { method: "POST", body: { user_id: ids.other, title: "DCPROBEFN theirs", price: 1, category: "other", university_id: PITT } });
  assert(mine.status < 300 && theirs.status < 300, "ex/fixture two listings seeded", `${mine.status} ${mine.text.slice(0, 80)} / ${theirs.status} ${theirs.text.slice(0, 80)}`);
  {
    const r = await fn("export-user-data", {});
    assert(r.status === 401, "ex/auth refuses a call with no token", `got ${r.status}`);
  }
  {
    const r = await fn("export-user-data", { jwt: jwt.student, body: {} });
    const titles = (r.json?.marketplace_listings ?? r.json?.listings ?? []).map((l) => l.title);
    assert(r.status === 200 && r.json?.export_format === "dormcheck.user-data.v1" && r.json?.user?.id === ids.student, "ex/self the export is the caller's, in the documented format", `got ${r.status} ${r.text.slice(0, 160)}`);
    assert(titles.includes("DCPROBEFN mine") && !titles.includes("DCPROBEFN theirs"), "ex/scope the export holds the caller's listing and not another student's", `titles=${JSON.stringify(titles)}`);
  }
  await rest(`marketplace_listings?title=like.DCPROBEFN*`, { method: "DELETE" });

  // delete-user-account: confirmation, then the real delete — with a NO ACTION edge that
  // 20261007000000 turned into SET NULL, so the row must survive with a null actor.
  const audit = await rest("admin_audit_log", { method: "POST", body: { actor_id: ids.victim, action: "admin.invite_accepted", target_type: "profile", target_id: ids.victim, university_id: PITT } });
  const auditId = audit.json?.[0]?.id;
  assert(audit.status < 300 && !!auditId, "del/fixture an admin_audit_log row names the victim as actor", `${audit.status} ${audit.text.slice(0, 120)}`);
  // A2: dm-photos is now on the purge list (it was never purged before 20261013000000).
  const dmUp = await storagePut("dm-photos", `${ids.victim}/del-probe-dm.jpg`, TINY_JPEG);
  assert(dmUp.status < 300, "del/fixture a DM photo in the victim's folder", `${dmUp.status} ${dmUp.text.slice(0, 80)}`);
  {
    const r = await fn("delete-user-account", { body: { confirm: "DELETE" } });
    assert(r.status === 401, "del/auth refuses a call with no token", `got ${r.status}`);
  }
  {
    const r = await fn("delete-user-account", { jwt: jwt.victim, body: {} });
    assert(r.status === 400, "del/confirm refuses a call without the typed confirmation", `got ${r.status} ${r.text.slice(0, 100)}`);
  }
  {
    const r = await fn("delete-user-account", { jwt: jwt.victim, body: { confirm: "DELETE" } });
    assert(r.status === 200 && r.json?.ok === true, "del/self the confirmed deletion succeeds", `got ${r.status} ${r.text.slice(0, 160)}`);
    const gone = await admin(`admin/users/${ids.victim}`, { method: "GET" });
    assert(gone.status === 404 || gone.json?.code === 404 || /not found/i.test(gone.text), "del/self the auth user is gone", `got ${gone.status} ${gone.text.slice(0, 100)}`);
    const prof = await rest(`profiles?id=eq.${ids.victim}&select=id`);
    assert(Array.isArray(prof.json) && prof.json.length === 0, "del/self the profile is gone");
    const dmLeft = await storageList("dm-photos", ids.victim);
    assert(!dmLeft.some((o) => o.name === "del-probe-dm.jpg"), "del/storage the victim's DM photo was purged", JSON.stringify(dmLeft.map((o) => o.name)));
    const row = await rest(`admin_audit_log?id=eq.${auditId}&select=id,actor_id`);
    assert(row.json?.[0] && row.json[0].actor_id === null, "del/trail the audit row survives with a null actor (20261007000000)", JSON.stringify(row.json));
    await rest(`admin_audit_log?id=eq.${auditId}`, { method: "DELETE" });
    ids.victim = null;
  }

  // send-auth-email: the signature is the whole gate; a good signature renders and sends.
  const payload = JSON.stringify({
    user: { email: "probe-fn-hook@pitt.edu" },
    email_data: { token: "123456", token_hash: "probe-token-hash", redirect_to: "http://localhost:8080/auth/callback", email_action_type: "signup", site_url: "http://localhost:8080" },
  });
  {
    const r = await fn("send-auth-email", { raw: payload, headers: { "content-type": "application/json" } });
    assert(r.status === 401, "sae/signature refuses an unsigned call", `got ${r.status}`);
  }
  {
    const wrong = signWebhook(payload, Buffer.from("not-the-secret-not-the-secret-00").toString("base64"));
    const r = await fn("send-auth-email", { raw: payload, headers: { "content-type": "application/json", ...wrong } });
    assert(r.status === 401, "sae/signature refuses a call signed with the wrong secret", `got ${r.status}`);
  }
  {
    await fetch(`${STUB_HOST_URL}/__reset`);
    const good = signWebhook(payload, HOOK_SECRET_B64);
    const r = await fn("send-auth-email", { raw: payload, headers: { "content-type": "application/json", ...good } });
    const hits = await (await fetch(`${STUB_HOST_URL}/__hits`)).json();
    const last = hits.emails?.[hits.emails.length - 1];
    assert(r.status === 200, "sae/send a correctly signed hook call is accepted", `got ${r.status} ${r.text.slice(0, 120)}`);
    assert(last?.to === "probe-fn-hook@pitt.edu" && !!last?.subject && last?.hasHtml, "sae/send the email went to the hook's user with a subject and a body", JSON.stringify(last));
  }
}

// ── run ─────────────────────────────────────────────────────────────────────
try {
  if (PHASE === "gateway") await phaseGateway();
  else if (PHASE === "nogateway") await phaseNoGateway();
  else throw new Error(`unknown PROBE_PHASE ${PHASE}`);
} catch (e) {
  failures += 1;
  console.log(`FAIL: probe threw — ${e instanceof Error ? e.stack || e.message : String(e)}`);
} finally {
  for (const k of Object.keys(USERS)) await deleteUserQuietly(ids[k]);
}
console.log(`── ${PHASE}: ${passes} PASS, ${failures} FAIL ──`);
process.exit(failures ? 1 : 0);
